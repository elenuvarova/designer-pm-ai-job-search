import { Router } from "express";
import { Op } from "sequelize";
import { sequelize } from "../db.js";
import { Job, Source, JobClassification, JobSkill } from "../models/index.js";
import { getActiveCvTerms, scoreJobText } from "../rag/cvMatch.js";
import { embed } from "../rag/embed.js";
import { rankByEmbedding } from "../rag/jobSearch.js";

const router = Router();

// Newest-first, but jobs without a posted_at go LAST (not first). Plain
// `posted_at DESC` puts NULLs first on Postgres, which would float undated jobs
// (HN, some boards) to the top. `posted_at IS NULL ASC` keeps dated jobs first.
// Works on both Postgres and SQLite without the NULLS LAST keyword.
const RECENCY_ORDER = [[sequelize.literal("posted_at IS NULL"), "ASC"], ["posted_at", "DESC"]];

// Oldest-dated first, but undated jobs still go LAST (mirror of RECENCY_ORDER).
const OLDEST_ORDER = [[sequelize.literal("posted_at IS NULL"), "ASC"], ["posted_at", "ASC"]];

// Company A–Z with NULL/empty company LAST. The IS NULL OR = '' literal pushes
// blanks to the bottom on both Postgres and SQLite without NULLS LAST.
const COMPANY_ORDER = [
  [sequelize.literal("company IS NULL OR company = ''"), "ASC"],
  ["company", "ASC"],
];

// Title A–Z (title is NOT NULL on the model, so no NULL handling needed).
const TITLE_ORDER = [["title", "ASC"]];

// Whitelist of CV-independent sorts → server-side Sequelize order clauses.
// User input is mapped through this map, never interpolated into SQL.
const SORTS = {
  newest: RECENCY_ORDER,
  oldest: OLDEST_ORDER,
  company: COMPANY_ORDER,
  title: TITLE_ORDER,
};

// BE/NL are the prioritised home region — surface them first, then by recency.
// CASE → 1/0 (not a raw boolean) so NULL countries (remote jobs) sort as 0, not via
// Postgres's DESC-NULLS-FIRST which would otherwise float remote jobs to the top.
// Works identically on Postgres and SQLite.
const HOME_FIRST = [sequelize.literal("CASE WHEN country IN ('BE','NL') THEN 1 ELSE 0 END"), "DESC"];

// Attributes returned for each classification, shared by both sort paths.
const CLASS_ATTRS = [
  "category", "role_family", "seniority", "employment_type", "remote_type",
  "job_post_language", "required_languages", "optional_languages",
  "language_blocker", "language_match", "portfolio_required",
];

// Cap on how many (most-recent) filtered jobs get scored for the match sort —
// keeps the in-memory scoring bounded; older jobs are rarely the top match anyway.
const MAX_SCORED = 600;

// GET /api/jobs
// Filters: country, source, q (title search), language_match (CSV ok), employment_type,
//          remote_type, category, role_family, seniority, blocker (bool),
//          portfolio_required (bool), min_salary (int), home_first (1 = BE/NL first)
// Pagination: page (1-based), limit (default 50, max 100)
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const jobWhere = {};
    if (req.query.country) jobWhere.country = req.query.country.toUpperCase();
    if (req.query.q) jobWhere.title = { [Op.like]: `%${req.query.q}%` };
    // min_salary: keep jobs whose stated pay reaches the floor (drops salary-less jobs,
    // which is acceptable since the filter is opt-in).
    const minSalary = parseInt(req.query.min_salary) || 0;
    if (minSalary > 0) {
      jobWhere[Op.or] = [
        { salary_max: { [Op.gte]: minSalary } },
        { salary_min: { [Op.gte]: minSalary } },
      ];
    }

    const sourceWhere = {};
    if (req.query.source) sourceWhere.key = req.query.source;

    const classWhere = {};
    if (req.query.language_match) {
      // CSV-aware: "good,maybe,unknown" → IN (...), single value → equality.
      const vals = req.query.language_match.split(",").map((v) => v.trim()).filter(Boolean);
      classWhere.language_match = vals.length > 1 ? { [Op.in]: vals } : vals[0];
    }
    if (req.query.employment_type) classWhere.employment_type = req.query.employment_type;
    if (req.query.remote_type) classWhere.remote_type = req.query.remote_type;
    if (req.query.category) classWhere.category = req.query.category;
    if (req.query.role_family) classWhere.role_family = req.query.role_family;
    if (req.query.seniority) classWhere.seniority = req.query.seniority;
    if (req.query.portfolio_required === "true") classWhere.portfolio_required = true;
    if (req.query.blocker !== undefined) {
      classWhere.language_blocker = req.query.blocker === "true";
    }

    const hasClassFilter = Object.keys(classWhere).length > 0;

    // Resolve the requested CV-independent sort against the whitelist (default newest).
    const sortKey = SORTS[req.query.sort] ? req.query.sort : "newest";
    const baseOrder = SORTS[sortKey];

    // Surface BE/NL first unless the user picked a specific country (then it's moot).
    // Home-region-first only applies to the date sorts; for company/title it would
    // override the alphabetical intent, so keep those purely alphabetical.
    const homeFirst = req.query.home_first === "1" && !req.query.country;
    const homeApplies = homeFirst && (sortKey === "newest" || sortKey === "oldest");
    const order = homeApplies ? [HOME_FIRST, ...baseOrder] : baseOrder;

    const sourceInclude = (attrs) => ({ model: Source, where: sourceWhere, attributes: attrs });
    const classInclude = (attrs) => ({
      model: JobClassification,
      required: hasClassFilter,
      where: hasClassFilter ? classWhere : undefined,
      attributes: attrs,
    });

    // ── Match sort: score the most-recent filtered jobs against the active CV,
    // order by score, paginate in memory. Falls back to newest if no CV. ──
    const wantMatch = req.query.sort === "match";
    const minMatch = Math.max(0, parseInt(req.query.min_match) || 0);
    const cvTerms = wantMatch ? await getActiveCvTerms() : null;

    if (wantMatch && cvTerms) {
      const candidates = await Job.findAll({
        where: jobWhere,
        include: [sourceInclude([]), classInclude([])],
        attributes: ["id", "title", "description", "posted_at", "country"],
        order: order,
        limit: MAX_SCORED,
        subQuery: false,
      });

      const isHome = (c) => (c === "BE" || c === "NL" ? 1 : 0);
      let scored = candidates.map((j) => ({
        id: j.id,
        score: scoreJobText(cvTerms, `${j.title || ""} ${(j.description || "").slice(0, 3000)}`),
        posted_at: j.posted_at,
        country: j.country,
      }));
      if (minMatch > 0) scored = scored.filter((s) => s.score >= minMatch);
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          (homeFirst ? isHome(b.country) - isHome(a.country) : 0) ||
          new Date(b.posted_at || 0) - new Date(a.posted_at || 0)
      );

      const total = scored.length;
      const pageSlice = scored.slice(offset, offset + limit);
      const ids = pageSlice.map((s) => s.id);

      const rows = ids.length
        ? await Job.findAll({
            where: { id: ids },
            include: [
              { model: Source, attributes: ["key", "label", "attribution_html"] },
              { model: JobClassification, attributes: CLASS_ATTRS },
            ],
          })
        : [];

      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      const scoreById = Object.fromEntries(pageSlice.map((s) => [s.id, s.score]));
      const jobs = ids
        .filter((id) => byId[id])
        .map((id) => {
          const j = byId[id].toJSON();
          j.cv_match = scoreById[id];
          return j;
        });

      return res.json({
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        jobs,
        sort: "match",
        // total counts only the scored window; flag when the cap was hit so the
        // UI can say "ranked the most recent N" rather than implying it ranked all.
        capped: candidates.length >= MAX_SCORED,
      });
    }

    // ── Default: newest first ──
    const { count, rows } = await Job.findAndCountAll({
      where: jobWhere,
      include: [
        sourceInclude(["key", "label", "attribution_html"]),
        classInclude(CLASS_ATTRS),
      ],
      order,
      limit,
      offset,
      distinct: true,
    });

    res.json({
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit),
      jobs: rows,
    });
  } catch (err) {
    console.error("[jobs] list failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /api/jobs/:id/similar — nearest jobs by embedding cosine.
router.get("/:id/similar", async (req, res) => {
  try {
    const job = await Job.findByPk(req.params.id, {
      attributes: ["id", "title", "description", "embedding"],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const vec = Array.isArray(job.embedding)
      ? job.embedding
      : await embed(`${job.title || ""}\n${(job.description || "").slice(0, 2000)}`);

    const ranked = await rankByEmbedding(vec, { excludeId: job.id, limit: 8 });
    const ids = ranked.map((r) => r.id);
    if (!ids.length) return res.json({ jobs: [] });

    const rows = await Job.findAll({
      where: { id: ids },
      attributes: ["id", "title", "company", "country", "location_raw"],
      include: [{ model: JobClassification, attributes: ["role_family", "language_match"] }],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    res.json({ jobs: ids.map((id) => byId[id]).filter(Boolean) });
  } catch (err) {
    console.error("[jobs] similar failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// GET /api/jobs/:id — full detail with skills
router.get("/:id", async (req, res) => {
  try {
    const job = await Job.findByPk(req.params.id, {
      include: [
        { model: Source, attributes: ["key", "label", "attribution_html"] },
        { model: JobClassification, required: false },
        { model: JobSkill, required: false },
      ],
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    console.error("[jobs] detail failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
