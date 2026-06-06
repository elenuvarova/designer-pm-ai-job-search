import { Router } from "express";
import { runCollect } from "../scripts/collect.js";
import {
  tryAcquirePipelineLock,
  releasePipelineLock,
  isPipelineRunning,
} from "../scheduler.js";

const router = Router();

let lastResult = null;

// POST /api/collect/run — trigger a collection run.
// Guarded by the shared pipeline lock so a manual run can never overlap a cron
// tick or a classify run.
router.post("/run", async (req, res) => {
  if (!tryAcquirePipelineLock()) {
    return res.status(409).json({ error: "Collection already in progress" });
  }

  res.json({ status: "started" });

  try {
    lastResult = await runCollect();
  } catch (err) {
    console.error("[collect] run failed:", err);
    lastResult = { error: "internal error" };
  } finally {
    releasePipelineLock();
  }
});

// GET /api/collect/status
router.get("/status", (req, res) => {
  res.json({
    running: isPipelineRunning(),
    last: lastResult,
  });
});

export default router;
