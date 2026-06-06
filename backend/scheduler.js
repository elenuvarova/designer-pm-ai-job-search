// Daily in-process pipeline: collect new jobs → classify → embed.
//
// Replaces the old GitHub Actions cron (.github/workflows/collect.yml), which
// wrote to a since-retired external DB. Running here means it targets whatever
// DB the container is configured with (the Coolify-internal Postgres in prod)
// and survives redeploys without any external scheduler.
//
// Enabled only when ENABLE_SCHEDULER=1 (set as a Coolify env var in prod) so
// local dev never fires it. Schedule overridable via COLLECT_CRON.
import cron from "node-cron";
import { runCollect } from "./scripts/collect.js";
import { runClassify } from "./scripts/classify.js";
import { runEmbedJobs } from "./scripts/embedJobs.js";

// Single module-level lock shared across the whole pipeline. A cron tick and a
// manual POST (/api/collect/run, /api/classify/run) must never run collection or
// classification concurrently — they touch the same rows and the in-app dedup
// assumes one writer. Every entry point acquires this one lock.
let running = false;

export function isPipelineRunning() {
  return running;
}

// Try to take the lock. Returns true if acquired, false if already held.
export function tryAcquirePipelineLock() {
  if (running) return false;
  running = true;
  return true;
}

export function releasePipelineLock() {
  running = false;
}

// Run collect → classify → embed in sequence. Guarded so an overlapping tick
// (or a manual trigger) can't run the pipeline twice at once. Embedding is
// best-effort: a failure there should not abort the run or crash the server.
export async function runPipeline(trigger = "manual") {
  if (!tryAcquirePipelineLock()) {
    console.log(`[scheduler] pipeline already running — skipping ${trigger} trigger`);
    return { skipped: true };
  }
  const t0 = Date.now();
  console.log(`[scheduler] pipeline start (${trigger})`);
  try {
    await runCollect();
    await runClassify();
    try {
      await runEmbedJobs();
    } catch (err) {
      console.error("[scheduler] embed step failed (non-fatal):", err);
    }
    console.log(`[scheduler] pipeline done in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { ok: true };
  } catch (err) {
    console.error("[scheduler] pipeline failed:", err);
    return { error: String(err) };
  } finally {
    releasePipelineLock();
  }
}

export function startScheduler() {
  if (process.env.ENABLE_SCHEDULER !== "1") {
    console.log("[scheduler] disabled (set ENABLE_SCHEDULER=1 to run the daily collect)");
    return;
  }
  // Daily at 04:17 UTC (~06:17 Amsterdam) — matches the retired GitHub cron.
  const schedule = process.env.COLLECT_CRON || "17 4 * * *";
  if (!cron.validate(schedule)) {
    console.error(`[scheduler] invalid COLLECT_CRON "${schedule}" — scheduler NOT started`);
    return;
  }
  cron.schedule(schedule, () => runPipeline("cron"), { timezone: "UTC" });
  console.log(`[scheduler] enabled — daily collect at "${schedule}" (UTC)`);
}
