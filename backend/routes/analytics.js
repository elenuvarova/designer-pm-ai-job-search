import { Router } from "express";
import { sequelize } from "../db.js";
import { JobSkill, Job } from "../models/index.js";

const router = Router();

// GET /api/analytics/skills?country=BE
router.get("/skills", async (req, res) => {
  try {
    const countryWhere = req.query.country
      ? { country: req.query.country.toUpperCase() }
      : {};

    const rows = await JobSkill.findAll({
      attributes: [
        "skill",
        [sequelize.fn("COUNT", sequelize.col("JobSkill.skill")), "count"],
      ],
      include: [{ model: Job, where: countryWhere, attributes: [] }],
      group: ["JobSkill.skill"],
      order: [[sequelize.literal("count"), "DESC"]],
      limit: 25,
      raw: true,
    });

    const total = await Job.count({ where: countryWhere });
    const result = rows.map((r) => ({
      skill: r.skill,
      count: parseInt(r.count, 10),
      pct: total > 0 ? Math.round((parseInt(r.count, 10) / total) * 100) : 0,
    }));

    res.json({ skills: result, total_jobs: total });
  } catch (err) {
    console.error("[analytics] skills failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
