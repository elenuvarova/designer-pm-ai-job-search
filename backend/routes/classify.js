import { Router } from "express";
import { runClassify } from "../scripts/classify.js";
import {
  tryAcquirePipelineLock,
  releasePipelineLock,
  isPipelineRunning,
} from "../scheduler.js";

const router = Router();
let lastResult = null;

// POST /api/classify/run.
// Guarded by the shared pipeline lock so a manual classify can never overlap a
// cron tick or a collect run.
router.post("/run", async (req, res) => {
  if (!tryAcquirePipelineLock())
    return res.status(409).json({ error: "Classification already in progress" });

  res.json({ status: "started" });

  try {
    lastResult = await runClassify();
  } catch (err) {
    console.error("[classify] run failed:", err);
    lastResult = { error: "internal error" };
  } finally {
    releasePipelineLock();
  }
});

// GET /api/classify/status
router.get("/status", (req, res) => {
  res.json({ running: isPipelineRunning(), last: lastResult });
});

export default router;
