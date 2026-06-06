// Gemini gemini-embedding-001 — free, multilingual EN/NL/FR/DE.
// (text-embedding-004 was shut down 2026-01-14; this is its stable replacement.)
// outputDimensionality pinned to 768 to match the stored CvChunk vectors and cosineSim.
// NOTE: vectors from the old model live in a different space — re-upload the CV after this change.
const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";

// The model that produces every vector in this app, and the dimension we pin.
// Stored alongside vectors (jobs.embedding_model / cv_chunks.embedding_model) so
// vectors from a different model/space can be detected rather than mis-compared.
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIM = 768;

export async function embed(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(`${EMBED_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: text.slice(0, 2048) }] },
      outputDimensionality: 768,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embed HTTP ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.embedding.values; // float[768]
}

const BATCH_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

// Embed many texts in one (or a few) API calls instead of N sequential ones.
// Returns float[768][] aligned to the input. Throws on a failed batch.
export async function embedBatch(texts, { batchSize = 100 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const res = await fetch(`${BATCH_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: slice.map((t) => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: (t || "").slice(0, 2048) }] },
          outputDimensionality: 768,
        })),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini batch embed HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const e of data.embeddings || []) out.push(e.values);
  }
  return out;
}

export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
