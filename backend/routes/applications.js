import { Router } from "express";
import { Application, Job, Source, JobClassification } from "../models/index.js";

const router = Router();
const VALID_STATUSES = ["saved", "need_cv", "applied", "interview", "offer", "rejected", "archived"];

// GET /api/applications — list all, optionally filter by job_id
router.get("/", async (req, res) => {
  try {
    const where = req.query.job_id ? { job_id: req.query.job_id } : {};
    const apps = await Application.findAll({
      where,
      include: [
        {
          model: Job,
          attributes: ["id", "title", "company", "country", "location_raw", "apply_url", "posted_at"],
          include: [
            { model: Source, attributes: ["key", "label"] },
            { model: JobClassification, required: false,
              attributes: ["role_family", "seniority", "language_match", "employment_type", "remote_type"] },
          ],
        },
      ],
      order: [["updated_at", "DESC"]],
    });
    res.json(apps);
  } catch (err) {
    console.error("[applications] list failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/applications — save/upsert (one application per job)
router.post("/", async (req, res) => {
  const { job_id, status = "saved" } = req.body;
  if (!job_id) return res.status(400).json({ error: "job_id required" });

  try {
    const [app, created] = await Application.findOrCreate({
      where: { job_id },
      defaults: { status },
    });
    res.status(created ? 201 : 200).json({ ...app.toJSON(), created });
  } catch (err) {
    console.error("[applications] create failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/applications/:id
router.patch("/:id", async (req, res) => {
  const { status, notes, applied_at, follow_up_at } = req.body;
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Use: ${VALID_STATUSES.join(", ")}` });
  }
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) return res.status(404).json({ error: "Not found" });
    await app.update({
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
      // Use !== undefined (not truthiness) so an explicit null/"" CLEARS the date.
      // Normalise empty string to null so the column is cleared, not set to "".
      ...(applied_at !== undefined && { applied_at: applied_at || null }),
      ...(follow_up_at !== undefined && { follow_up_at: follow_up_at || null }),
      // Auto-stamp applied_at when moving to "applied" and it isn't being set
      // explicitly in this request and isn't already set.
      ...(status === "applied" && applied_at === undefined && !app.applied_at && {
        applied_at: new Date(),
      }),
    });
    res.json(app);
  } catch (err) {
    console.error("[applications] update failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /api/applications/:id
router.delete("/:id", async (req, res) => {
  try {
    await Application.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[applications] delete failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
