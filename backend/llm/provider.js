// Thin LLM provider abstraction — Gemini primary, Groq fallback.
// Only used for language-requirement adjudication on ambiguous snippets.
// Passes structured features, not full job text, to minimize token spend.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a language-requirement classifier for job postings across Europe.

Given one or more sentences from a job description that mention a language (Dutch, French, German, or Luxembourgish), determine:
1. Whether each language is REQUIRED or OPTIONAL for the candidate.
2. The overall language_match status.

language_match values:
- "good"    — English only or no non-English requirement
- "maybe"   — non-English language present but optional/nice-to-have
- "risk"    — non-English language appears required, but phrasing is weak or ambiguous
- "blocker" — explicit fluent/native/C1/required/obligatoire/vereist for NL/FR/DE/LU
- "unknown" — cannot determine from the snippet

Return ONLY valid JSON, no markdown:
{
  "required_languages": ["dutch"],
  "optional_languages": [],
  "language_blocker": true,
  "language_match": "blocker",
  "confidence": 0.85
}`;

async function callGemini(snippets) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const prompt = `Classify the language requirements from these job-description snippets:\n\n${snippets.join("\n")}`;

  const res = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

async function callGroq(snippets) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const prompt = `Classify the language requirements from these job-description snippets:\n\n${snippets.join("\n")}`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

export async function adjudicateLanguage(snippets) {
  try {
    return await callGemini(snippets);
  } catch (err) {
    console.warn(`  LLM Gemini failed (${err.message}), trying Groq…`);
    try {
      return await callGroq(snippets);
    } catch (err2) {
      console.warn(`  LLM Groq also failed (${err2.message}), using rule-based result`);
      return null;
    }
  }
}
