import { Router } from "express";
import { CvDocument } from "../models/index.js";
import { detectLanguage } from "../nlp/language.js";
import { classifyEmployment } from "../nlp/employment.js";
import { analyzeLanguageRequirements } from "../nlp/languageReq.js";
import { classifyRole } from "../nlp/role.js";
import { classifySeniority } from "../nlp/seniority.js";
import { classifyRemote } from "../nlp/remote.js";
import { extractSkills } from "../nlp/skills.js";
import { detectPortfolioRequired } from "../nlp/portfolio.js";
import { stripHtml } from "../nlp/normalize.js";
import { extractTerms, scoreJobText } from "../rag/cvMatch.js";

const router = Router();

// POST /api/analyze — run the same NLP pipeline + CV match/skill-gap on an
// arbitrary pasted job description (no DB write). Lets the user vet ANY posting
// — including LinkedIn/Indeed ones we never collect — by pasting its text.
router.post("/", async (req, res) => {
  try {
    const title = (req.body.title || "").trim();
    // Accept either plain text or pasted HTML.
    const text = stripHtml(String(req.body.text || "")).trim();
    if (text.length < 30) {
      return res.status(400).json({ error: "Paste the job description (a few sentences at least)." });
    }

    const role = classifyRole(title, text);
    const employment = classifyEmployment(title, text);
    const langReq = analyzeLanguageRequirements(text);

    const classification = {
      job_post_language: detectLanguage(text),
      category: role.category,
      role_family: role.role_family,
      role_confidence: role.confidence,
      seniority: classifySeniority(title, text).seniority,
      employment_type: employment.employment_type,
      employment_confidence: employment.confidence,
      remote_type: classifyRemote(title, text),
      portfolio_required: detectPortfolioRequired(text),
      required_languages: langReq.required_languages,
      optional_languages: langReq.optional_languages,
      language_blocker: langReq.language_blocker,
      language_match: langReq.language_match,
    };

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
