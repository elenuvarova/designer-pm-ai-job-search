import { Router } from "express";
import multer from "multer";
import { CvDocument, Job } from "../models/index.js";
import { ingestCv, PDF_MIME, DOCX_MIME } from "../rag/cvIngest.js";
import { scoreJobText, getActiveCvTerms } from "../rag/cvMatch.js";
import { extractSkills } from "../nlp/skills.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === PDF_MIME || file.mimetype === DOCX_MIME);
  },
});

// GET /api/cv — get current (latest) CV document
router.get("/", async (_req, res) => {
  try {
    const doc = await CvDocument.findOne({ order: [["created_at", "DESC"]] });
    res.json(doc || null);
  } catch (err) {
    console.error("[cv] get current failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/cv/upload — upload PDF or DOCX, chunk + embed, store
router.post("/upload", upload.single("cv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file or unsupported type (PDF/DOCX only)" });

  try {
    const result = await ingestCv({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      label: req.file.originalname,
    });
    res.json(result);
  } catch (err) {
    console.error("[cv] upload failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /api/cv/scores?job_ids=1,2,3
// Returns term-overlap score (0-100) between the active CV and each job.
// No external API calls — pure text matching, safe to call on every page load.
router.get("/scores", async (req, res) => {
  const { job_ids } = req.query;
  if (!job_ids) return res.json({ scores: {} });

  const ids = String(job_ids).split(",").map(Number).filter(Boolean);
  if (!ids.length) return res.json({ scores: {} });

  try {
    const cvTerms = await getActiveCvTerms();
    if (!cvTerms) return res.json({ scores: {} });

    const jobs = await Job.findAll({
      where: { id: ids },
      attributes: ["id", "title", "description"],
    });

    const scores = {};
    for (const job of jobs) {
      scores[job.id] = scoreJobText(
        cvTerms,
        `${job.title || ""} ${(job.description || "").slice(0, 3000)}`
      );
    }

    res.json({ scores });
  } catch (err) {
    console.error("[cv] scores failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /api/cv/skill-gap/:jobId
// Diffs the gazetteer skills found in a job against those found in the active CV.
router.get("/skill-gap/:jobId", async (req, res) => {
  try {
    const job = await Job.findByPk(req.params.jobId, {
      attributes: ["id", "title", "description"],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const jobSkills = [
      ...new Set(extractSkills(`${job.title} ${job.description || ""}`).map((s) => s.skill)),
    ];

    const doc = await CvDocument.findOne({
      order: [["created_at", "DESC"]],
      attributes: ["raw_text"],
    });
    if (!doc) {
      return res.json({ has_cv: false, job_skills: jobSkills, matched: [], missing: jobSkills });
    }

    const cvSkills = new Set(extractSkills(doc.raw_text || "").map((s) => s.skill));
    const matched = jobSkills.filter((s) => cvSkills.has(s));
    const missing = jobSkills.filter((s) => !cvSkills.has(s));

    res.json({ has_cv: true, job_skills: jobSkills, matched, missing });
  } catch (err) {
    console.error("[cv] skill-gap failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /api/cv/:id
router.delete("/:id", async (req, res) => {
  try {
    await CvDocument.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[cv] delete failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
