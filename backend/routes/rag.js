import { Router } from "express";
import { Job, JobClassification, JobSkill, CvDocument } from "../models/index.js";
import { embed } from "../rag/embed.js";
import { retrieveTopChunks } from "../rag/retrieve.js";
import { runAssistant, generateText } from "../rag/assistant.js";
import { extractSkills } from "../nlp/skills.js";

const router = Router();
const ACTIONS = ["tailor-cv", "cover-letter", "interview-prep"];

// In-memory cache keyed by company name — briefs are company-level and repeat
// across jobs, so this avoids re-spending LLM quota. Resets on restart ($0).
// Entries store {value, ts}; anything older than BRIEF_TTL_MS is treated as a
// miss (and regenerated) so the cache can't grow unbounded or serve stale facts.
const briefCache = new Map();
const BRIEF_TTL_MS = 24 * 60 * 60 * 1000;

function companyBriefPrompt(job) {
  return `
You are a concise company researcher helping a candidate prepare for a job interview. Use British English.

Company: ${job.company}
Role being considered: ${job.title}
Location: ${job.location_raw || job.country || "—"}

Write a tight, scannable briefing for the candidate, using these sections with short bullets:
1. **What they do** — 1–2 sentences on the product and business model.
2. **Scale & stage** — startup / scale-up / enterprise, plus any widely-known facts.
3. **For a design / product candidate** — design maturity, product culture, tools or ways of working relevant to this role.
4. **Smart questions to ask** — 3 questions that show genuine research.
5. **Watch-outs** — one thing to verify or a possible red flag.

Keep it under 250 words. If you are not certain about a specific fact, say so plainly rather than inventing it. Do NOT fabricate funding amounts, headcounts, valuations, or recent news.
`.trim();
}

// POST /api/jobs/:jobId/company-brief — LLM "before you interview" one-pager.
// Defined before the generic /:jobId/:action route; needs no CV.
router.post("/:jobId/company-brief", async (req, res) => {
  try {
    const job = await Job.findByPk(req.params.jobId, {
      attributes: ["company", "title", "country", "location_raw"],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!job.company) return res.status(400).json({ error: "No company name for this job" });

    const key = job.company.toLowerCase();
    const hit = briefCache.get(key);
    if (hit && Date.now() - hit.ts < BRIEF_TTL_MS) {
      return res.json({ result: hit.value, cached: true });
    }

    const brief = await generateText(companyBriefPrompt(job));
    briefCache.set(key, { value: brief, ts: Date.now() });
    res.json({ result: brief });
  } catch (err) {
    console.error("[rag] company-brief error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/jobs/:jobId/apply-kit — one combined "ready to apply" bundle:
// skill gap + tailored-CV notes + cover letter + interview prep, as Markdown.
// The 3 LLM pieces share one CV retrieval and run in parallel.
router.post("/:jobId/apply-kit", async (req, res) => {
  try {
    const job = await Job.findByPk(req.params.jobId, {
      include: [
        { model: JobClassification, required: false },
        { model: JobSkill, required: false },
      ],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const cv = await CvDocument.findOne({
      order: [["created_at", "DESC"]],
      attributes: ["id", "raw_text"],
    });
    if (!cv) return res.status(400).json({ error: "No CV uploaded yet. Upload a CV first." });

    // Shared retrieval (one embed call for all three actions).
    const skills = (job.JobSkills || []).map((s) => s.skill).join(" ");
    const query = `${job.title} ${job.JobClassification?.role_family || ""} ${skills}`.trim();
    const queryEmbedding = await embed(query);
    const chunks = await retrieveTopChunks(cv.id, queryEmbedding, 5);

    const [tailor, cover, interview] = await Promise.all([
      runAssistant("tailor-cv", job, chunks, job.description),
      runAssistant("cover-letter", job, chunks, job.description),
      runAssistant("interview-prep", job, chunks, job.description),
    ]);

    // Skill gap (rule-based, no LLM).
    const jobSkills = [
      ...new Set(extractSkills(`${job.title} ${job.description || ""}`).map((s) => s.skill)),
    ];
    const cvSkills = new Set(extractSkills(cv.raw_text || "").map((s) => s.skill));
    const matched = jobSkills.filter((s) => cvSkills.has(s));
    const missing = jobSkills.filter((s) => !cvSkills.has(s));

    const md = [
      `# Apply kit — ${job.title}${job.company ? ` @ ${job.company}` : ""}`,
      "",
      "## Skill match",
      `**You have:** ${matched.join(", ") || "—"}`,
      "",
      `**Gaps to address:** ${missing.join(", ") || "—"}`,
      "",
      "## Tailored-CV recommendations",
      tailor,
      "",
      "## Cover letter",
      cover,
      "",
      "## Interview prep",
      interview,
      "",
    ].join("\n");

    res.json({ result: md });
  } catch (err) {
    console.error("[rag] apply-kit error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/jobs/:id/:action
// action = tailor-cv | cover-letter | interview-prep
router.post("/:jobId/:action", async (req, res) => {
  const { jobId, action } = req.params;
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ error: `Unknown action. Use: ${ACTIONS.join(", ")}` });
  }

  try {
    // Load job with classification and skills
    const job = await Job.findByPk(jobId, {
      include: [
        { model: JobClassification, required: false },
        { model: JobSkill, required: false },
      ],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });

    // Load latest CV
    const cv = await CvDocument.findOne({ order: [["created_at", "DESC"]] });
    if (!cv) return res.status(400).json({ error: "No CV uploaded yet. Upload a CV first." });

    // Build retrieval query from job data
    const skills = (job.JobSkills || []).map((s) => s.skill).join(" ");
    const query = `${job.title} ${job.JobClassification?.role_family || ""} ${skills}`.trim();

    // Embed query + retrieve top CV chunks
    const queryEmbedding = await embed(query);
    const chunks = await retrieveTopChunks(cv.id, queryEmbedding, 5);

    // Run assistant
    const result = await runAssistant(action, job, chunks, job.description);

    res.json({ action, result });
  } catch (err) {
    console.error(`[rag] ${action} error:`, err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
