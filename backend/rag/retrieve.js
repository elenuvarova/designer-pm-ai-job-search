import { CvChunk } from "../models/index.js";
import { cosineSim, EMBED_DIM } from "./embed.js";

export async function retrieveTopChunks(cvDocumentId, queryEmbedding, k = 5) {
  const chunks = await CvChunk.findAll({
    where: { cv_document_id: cvDocumentId },
    attributes: ["chunk_text", "embedding"],
  });

  let skipped = 0;
  const scored = [];
  for (const c of chunks) {
    const emb = c.embedding;
    // Skip empty/missing vectors and any whose dimension does not match the
    // query (a chunk left over from a different embedding model/space).
    if (!Array.isArray(emb) || !emb.length || emb.length !== queryEmbedding.length) {
      if (Array.isArray(emb) && emb.length && emb.length !== queryEmbedding.length) skipped++;
      continue;
    }
    scored.push({ text: c.chunk_text, score: cosineSim(queryEmbedding, emb) });
  }

  if (skipped > 0) {
    console.warn(
      `[retrieve] skipped ${skipped} CV chunk vector(s) on dimension mismatch ` +
        `(expected ${queryEmbedding.length}, model dim ${EMBED_DIM}) — likely a stale embedding space`
    );
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((c) => c.text);
}
