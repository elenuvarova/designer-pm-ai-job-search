import { CvDocument, CvChunk } from "../models/index.js";

// Shared CV ↔ job term-overlap scoring. Pure text matching, no API calls — safe
// to run on every feed load. Used by /api/cv/scores and the /api/jobs match sort.

// Generic English/HR stop-words that carry no discriminative signal.
const STOP_WORDS = new Set([
  "the","and","for","are","was","were","will","with","this","that","have",
  "from","they","their","our","you","your","but","not","all","can","her",
  "his","who","how","when","what","which","more","also","been","has","had",
  "its","about","into","than","then","them","some","such","other","these",
  "those","very","just","over","both","each","much","work","team","role",
  "based","using","experience","years","strong","good","great","high",
  "excellent","understanding","knowledge","skills","ability","looking",
  "seeking","join","help","build","like","make","take","working","minimum",
  "required","requirements","responsibilities","opportunity","position",
  "candidate","ideal","preferred","able","across","within","between",
  "under","well","including","following","related","relevant","similar",
  "company","new","use","used","get","day","time","way","level","highly",
  "field","areas","area","etc","please","apply","send","email","contact",
  "offer","benefits","salary","bonus","vacation","holiday","insurance",
  "pension","remote","office","hybrid","flexible","hours","week","month",
  "full","part","contract","permanent","fixed","term","open","end",
  "doing","come",
]);

// Keep all Unicode letters/digits (so accented FR/NL/DE terms survive — e.g.
// "modèle", "données", "intelligenz"), drop punctuation, split, filter.
export function extractTerms(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP_WORDS.has(t))
  );
}

// Fraction of the CV's significant terms that appear in the job text (0–100).
// For a single fixed CV this also yields the correct *ranking* across jobs
// (the denominator is constant), which is what the match sort relies on.
export function scoreJobText(cvTerms, jobText) {
  if (!cvTerms || !cvTerms.size) return 0;
  const jobTerms = extractTerms(jobText);
  let hits = 0;
  for (const t of cvTerms) if (jobTerms.has(t)) hits++;
  return Math.round((hits / cvTerms.size) * 100);
}

// In-process cache of the active CV's term Set. getActiveCvTerms runs on every
// match-sort feed load and every chat turn; without this it re-reads the CV doc
// + all chunks and rebuilds the Set each time. Keyed by the active doc id with a
// 5-min TTL so it self-corrects if a new CV is ingested (id changes → miss).
// ingestCv (cvIngest.js, not owned here) destroys+creates CV rows; if it gains a
// hook it should call invalidateCvTermsCache() for instant freshness. TODO:
// add that call in cvIngest.js. Until then the 5-min TTL bounds staleness.
const CV_TERMS_TTL_MS = 5 * 60 * 1000;
let _cvTermsCache = null; // { docId, terms, ts }

export function invalidateCvTermsCache() {
  _cvTermsCache = null;
}

// The active (latest) CV's term Set, or null if no CV/chunks exist.
export async function getActiveCvTerms() {
  const doc = await CvDocument.findOne({ order: [["created_at", "DESC"]], attributes: ["id"] });
  if (!doc) return null;

  const fresh =
    _cvTermsCache &&
    _cvTermsCache.docId === doc.id &&
    Date.now() - _cvTermsCache.ts < CV_TERMS_TTL_MS;
  if (fresh) return _cvTermsCache.terms;

  const chunks = await CvChunk.findAll({
    where: { cv_document_id: doc.id },
    attributes: ["chunk_text"],
  });
  if (!chunks.length) return null;
  const terms = extractTerms(chunks.map((c) => c.chunk_text).join(" "));
  _cvTermsCache = { docId: doc.id, terms, ts: Date.now() };
  return terms;
}
