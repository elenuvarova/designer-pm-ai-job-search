// Backfill job embeddings for semantic search / "find similar" / chat.
// Runs nightly after collect + classify; capped per run to stay within the
// Gemini embedding free quota. New jobs get embedded over subsequent runs.
import "dotenv/config";
import { Op } from "sequelize";
import { pathToFileURL } from "node:url";
import { sequelize } from "../db.js";
import { syncModels, Job } from "../models/index.js";
import { embed, EMBED_MODEL } from "../rag/embed.js";
import { invalidateVectorCache } from "../rag/jobSearch.js";
import { sleep } from "../nlp/normalize.js";

const MAX_PER_RUN = 80;
const EMBED_DELAY_MS = 300;

export async function runEmbedJobs() {
  await syncModels();

  // Candidates are jobs with NO embedding yet. We treat `null` as "not embedded".
  // A job with no usable text gets the `[]` sentinel (written below) which is NOT
  // null, so it never re-enters this IS-NULL query — without that it would burn
  // the MAX_PER_RUN budget every run forever. The IS NULL filter alone excludes
  // both real vectors and the [] sentinel; no extra not-equal guard is needed.
  const jobs = await Job.findAll({
    where: { embedding: { [Op.is]: null } },
    attributes: ["id", "title", "description"],
    // Newest first, undated last (NULLs sort last across both dialects).
    order: [[sequelize.literal("posted_at IS NULL"), "ASC"], ["posted_at", "DESC"]],
    limit: MAX_PER_RUN,
  });
  console.log(`[embed] ${jobs.length} jobs to embed (cap ${MAX_PER_RUN})`);

  let done = 0;
  let sentinels = 0;
  for (const job of jobs) {
    const text = `${job.title || ""}\n${(job.description || "").slice(0, 2000)}`.trim();
    if (!text) {
      // Unembeddable (no text). Write the [] sentinel so it stops re-poisoning
      // the candidate queue. rankByEmbedding/retrieve skip [] on length 0.
      await job.update({ embedding: [], embedding_model: EMBED_MODEL });
      sentinels++;
      continue;
    }
    try {
      const vec = await embed(text);
      await job.update({ embedding: vec, embedding_model: EMBED_MODEL });
      done++;
    } catch (err) {
      console.error(`  embed job ${job.id}: ${err.message}`);
      if (/quota|429|rate/i.test(err.message)) {
        console.log("[embed] quota/rate limit hit — stopping early");
        break;
      }
    }
    await sleep(EMBED_DELAY_MS);
  }

  console.log(`[embed] embedded ${done} jobs${sentinels ? `, ${sentinels} marked unembeddable` : ""}`);
  // New vectors are written — drop the in-process cache so search reflects them
  // immediately instead of waiting out the 5-min TTL.
  if (done > 0 || sentinels > 0) invalidateVectorCache();
  return { embedded: done };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runEmbedJobs();
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[embed] fatal:", err);
    await sequelize.close();
    process.exit(1);
  }
}
