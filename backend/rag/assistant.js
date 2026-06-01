import { adjudicateLanguage } from "../llm/provider.js";

// Build context string from job data
function jobContext(job) {
  const c = job.JobClassification;
  const skills = (job.JobSkills || []).map((s) => s.skill).join(", ");
  return [
    `Title: ${job.title}`,
    `Company: ${job.company || "Unknown"}`,
    `Location: ${job.location_raw || job.country || "Europe"}`,
    c?.role_family ? `Role family: ${c.role_family}` : null,
    c?.seniority && c.seniority !== "unknown" ? `Seniority: ${c.seniority}` : null,
    c?.employment_type && c.employment_type !== "unclear"
      ? `Employment: ${c.employment_type.replace("_", "-")}`
      : null,
    c?.language_match ? `Language match: ${c.language_match}` : null,
    skills ? `Detected skills: ${skills}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const PROMPTS = {
  "tailor-cv": (job, chunks, desc) => `
You are an expert CV consultant. A candidate wants to tailor their CV for a specific job. Use British English.

JOB INFORMATION:
${jobContext(job)}

JOB DESCRIPTION (excerpt):
${desc}

CANDIDATE'S CV — MOST RELEVANT SECTIONS:
${chunks.join("\n\n---\n\n")}

---

Write 4–6 specific, actionable recommendations for tailoring this candidate's CV to this role. For each recommendation:
• State exactly what to change or emphasise
• Explain why it matters for this specific role

Reference actual content from both the CV and job description. Avoid generic advice.
`.trim(),

  "cover-letter": (job, chunks, desc) => `
Write a professional cover letter for this job application. British English. 260–320 words.

JOB: ${job.title} at ${job.company || "the company"}
${jobContext(job)}

JOB DESCRIPTION:
${desc}

CANDIDATE'S BACKGROUND (relevant excerpts):
${chunks.join("\n\n---\n\n")}

---

Structure:
- Opening: a specific, engaging hook about this role (never start with "I am writing to apply")
- Body: two concise paragraphs — most relevant experience, then key skills match
- Closing: confident call to action

Tone: professional, direct, confident. No filler phrases. No lists.
`.trim(),

  "interview-prep": (job, chunks, desc) => `
You are an interview coach. Generate 7 likely interview questions for this role with concise coaching guidance for each answer.

JOB: ${job.title} at ${job.company || "the company"}
${jobContext(job)}

JOB DESCRIPTION:
${desc}

CANDIDATE'S BACKGROUND:
${chunks.join("\n\n---\n\n")}

---

Include:
1. Two technical questions specific to the role's stack or domain
2. Two behavioural questions (suggest STAR format)
3. One situational / problem-solving question
4. One about motivation and fit
5. One wildcard

For each question: state the question, then give 2–3 sentences of specific coaching guidance referencing the candidate's background. Use British English.
`.trim(),
};

export async function runAssistant(action, job, chunks, description) {
  const desc = (description || "").slice(0, 3000);
  const promptText = PROMPTS[action]?.(job, chunks, desc);
  if (!promptText) throw new Error(`Unknown RAG action: ${action}`);

  // Re-use the LLM provider (Gemini primary, Groq fallback)
  // adjudicateLanguage calls Gemini with a JSON schema — we need plain text here
  // so we call the providers directly
  const result = await callLlmPlainText(promptText);
  return result;
}

async function callGeminiText(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGroqText(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callLlmPlainText(prompt) {
  try {
    return await callGeminiText(prompt);
  } catch (err) {
    console.warn(`RAG Gemini failed (${err.message}), trying Groq…`);
    return await callGroqText(prompt);
  }
}

// Generic plain-text generation (Gemini → Groq), reused beyond the CV actions.
export async function generateText(prompt) {
  return callLlmPlainText(prompt);
}
