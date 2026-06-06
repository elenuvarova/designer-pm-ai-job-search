import { Router } from "express";
import { Job, Source, JobClassification } from "../models/index.js";
import { embed } from "../rag/embed.js";
import { rankByEmbedding } from "../rag/jobSearch.js";
import { generateText } from "../rag/assistant.js";
import { getActiveCvTerms, scoreJobText } from "../rag/cvMatch.js";

const router = Router();

const CHAT_SYSTEM = `You are a job-search assistant for a single user, answering over a fixed set of vacancies provided below. Use British English.
Rules:
- Answer using ONLY the jobs listed. Never invent jobs, companies, or facts not present.
- Reference jobs by their title and company so they can be matched (the UI links them).
- For "fit"/"match" questions, use the "CV match" percentages. For language questions, note that language "blocker"/"risk" means a local language (Dutch/French/German) is likely required; "good" means English is enough.
- Be concise and specific. If none of the provided jobs fit the question, say so plainly.`;

const CLASS_ATTRS = [
  "role_family", "seniority", "employment_type", "remote_type",
  "job_post_language", "required_languages", "optional_languages",
  "language_blocker", "language_match",
];

// POST /api/search/semantic { q } — natural-language search ranked by meaning.
router.post("/semantic", async (req, res) => {
  try {
    const q = String(req.body.q || "").trim();
    if (q.length < 3) return res.status(400).json({ error: "Enter a search query." });

    const vec = await embed(q);
    const ranked = await rankByEmbedding(vec, { limit: 30 });
    if (!ranked.length) {
      return res.json({ jobs: [], note: "No embedded jobs yet — the embedding backfill runs nightly." });
    }

    const ids = ranked.map((r) => r.id);
    const rows = await Job.findAll({
      where: { id: ids },
      include: [
        { model: Source, attributes: ["key", "label", "attribution_html"] },
        { model: JobClassification, attributes: CLASS_ATTRS },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const jobs = ids.map((id) => byId[id]).filter(Boolean);

    res.json({ jobs });
  } catch (err) {
    console.error("[search] semantic failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/search/chat { message, history? } — RAG over the job corpus.
router.post("/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    if (message.length < 2) return res.status(400).json({ error: "Ask a question." });
    // Keep the last 4 turns, and clamp each turn's content so a pasted wall of
    // text in history can't blow up the prompt (and token cost) unbounded.
    const history = (Array.isArray(req.body.history) ? req.body.history.slice(-4) : []).map((h) => ({
      role: h.role,
      content: String(h.content || "").slice(0, 500),
    }));

    const vec = await embed(message);
    const ranked = await rankByEmbedding(vec, { limit: 12 });
    if (!ranked.length) {
      return res.json({
        answer:
          "No jobs are indexed for search yet — the embedding backfill runs nightly after collection. Try again once it has run.",
        jobs: [],
      });
    }

    const ids = ranked.map((r) => r.id);
    const rows = await Job.findAll({
      where: { id: ids },
      attributes: ["id", "title", "company", "country", "location_raw", "description"],
      include: [
        {
          model: JobClassification,
          attributes: [
            "role_family", "seniority", "employment_type", "remote_type",
            "language_match", "required_languages",
          ],
        },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const jobs = ids.map((id) => byId[id]).filter(Boolean);

    const cvTerms = await getActiveCvTerms();
    const context = jobs
      .map((j) => {
        const c = j.JobClassification || {};
        const match = cvTerms
          ? `${scoreJobText(cvTerms, `${j.title} ${(j.description || "").slice(0, 3000)}`)}% CV match`
          : "no CV on file";
        const reqL = (c.required_languages || []).join(", ") || "none";
        const snippet = (j.description || "").replace(/\s+/g, " ").slice(0, 200);
        return `[${j.id}] ${j.title} — ${j.company || "?"} (${j.country || j.location_raw || "?"}) · role: ${c.role_family || "?"} · ${c.seniority || "?"} · ${c.employment_type || "?"} · ${c.remote_type || "?"} · language: ${c.language_match || "?"} (required: ${reqL}) · ${match}\n  ${snippet}`;
      })
      .join("\n\n");

    const histText = history
      .map((h) => `${h.role === "assistant" ? "Assistant" : "You"}: ${h.content}`)
      .join("\n");

    const prompt = `${CHAT_SYSTEM}\n\n${histText ? `CONVERSATION SO FAR:\n${histText}\n\n` : ""}QUESTION: ${message}\n\nAVAILABLE JOBS:\n${context}`;
    const answer = await generateText(prompt);

    const refs = jobs.slice(0, 8).map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      country: j.country,
    }));

    res.json({ answer, jobs: refs });
  } catch (err) {
    console.error("[search] chat failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
