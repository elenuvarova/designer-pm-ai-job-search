import { Router } from "express";
import { CvDocument } from "../models/index.js";
import { extractSkills } from "../nlp/skills.js";
import { stripHtml } from "../nlp/normalize.js";
import { classifyJob } from "../nlp/classifyJob.js";
import { extractTerms, scoreJobText } from "../rag/cvMatch.js";

const router = Router();

// Cap pasted body length before the NLP pipeline. A 20k-char excerpt is more
// than enough signal for classification/term-overlap and bounds CPU/memory.
const MAX_TEXT = 20000;

// POST /api/analyze — run the same NLP pipeline + CV match/skill-gap on an
// arbitrary pasted job description (no DB write). Lets the user vet ANY posting
// — including LinkedIn/Indeed ones we never collect — by pasting its text.
router.post("/", async (req, res) => {
  try {
    const title = (req.body.title || "").trim();
    // Accept either plain text or pasted HTML. Cap length before the pipeline.
    const text = stripHtml(String(req.body.text || "")).trim().slice(0, MAX_TEXT);
    if (text.length < 30) {
      return res.status(400).json({ error: "Paste the job description (a few sentences at least)." });
    }

    const { classification } = classifyJob(title, text);

    const jobSkills = [...new Set(extractSkills(`${title} ${text}`).map((s) => s.skill))];

    // CV match + skill gap (only if a CV is on file)
    const cv = { has_cv: false, cv_match: null, matched: [], missing: jobSkills };
    const doc = await CvDocument.findOne({
      order: [["created_at", "DESC"]],
      attributes: ["raw_text"],
    });
    if (doc?.raw_text) {
      cv.has_cv = true;
      const cvTerms = extractTerms(doc.raw_text);
      cv.cv_match = scoreJobText(cvTerms, `${title} ${text.slice(0, 3000)}`);
      const cvSkills = new Set(extractSkills(doc.raw_text).map((s) => s.skill));
      cv.matched = jobSkills.filter((s) => cvSkills.has(s));
      cv.missing = jobSkills.filter((s) => !cvSkills.has(s));
    }

    res.json({ classification, skills: jobSkills, cv });
  } catch (err) {
    console.error("[analyze] failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
