import { Op } from "sequelize";
import { Job } from "../models/index.js";
import { cosineSim, EMBED_DIM } from "./embed.js";

// Brute-force cosine ranking of all embedded jobs against a query vector.
// Fine for a single-user corpus (hundreds–low thousands of jobs).
// Returns [{ id, score }] sorted by similarity desc.

// ── In-process vector cache ──────────────────────────────────────────────
// rankByEmbedding is called on every semantic/chat/similar request. Pulling
// id+embedding for ALL jobs on each call is wasteful, so cache the array.
// Staleness window: up to CACHE_TTL_MS (5 min) — a job embedded by the nightly
// run may not appear in search until the cache expires OR is invalidated.
// runEmbedJobs() calls invalidateVectorCache() on success so new vectors show
// up immediately after a backfill; the TTL is the safety net for any other path.
const CACHE_TTL_MS = 5 * 60 * 1000;
let _vectorCache = null; // [{ id, embedding }]
let _loadedAt = 0;

export function invalidateVectorCache() {
  _vectorCache = null;
  _loadedAt = 0;
}

async function loadVectors() {
  const fresh = _vectorCache && Date.now() - _loadedAt < CACHE_TTL_MS;
  if (fresh) return _vectorCache;
  const rows = await Job.findAll({
    where: { embedding: { [Op.ne]: null } },
    attributes: ["id", "embedding"],
  });
  // Store plain objects so the cache holds no Sequelize instances.
  _vectorCache = rows.map((r) => ({ id: r.id, embedding: r.embedding }));
  _loadedAt = Date.now();
  return _vectorCache;
}

export async function rankByEmbedding(queryVec, { excludeId = null, limit = 25 } = {}) {
  if (!Array.isArray(queryVec) || !queryVec.length) return [];

  const rows = await loadVectors();

  let skipped = 0;
  const scored = [];
  for (const r of rows) {
    if (excludeId != null && r.id === excludeId) continue;
    const emb = r.embedding;
    // Skip null, the [] unembeddable sentinel, and any vector whose dimension
    // does not match the query (e.g. left over from a different embedding model).
    if (!Array.isArray(emb) || emb.length !== queryVec.length) {
      if (Array.isArray(emb) && emb.length !== 0) skipped++; // count only real mismatches
      continue;
    }
    scored.push({ id: r.id, score: cosineSim(queryVec, emb) });
  }

  if (skipped > 0) {
    console.warn(
      `[jobSearch] skipped ${skipped} job vector(s) on dimension mismatch ` +
        `(expected ${queryVec.length}, model dim ${EMBED_DIM}) — likely a stale embedding space`
    );
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
