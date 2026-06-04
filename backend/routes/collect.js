import { Router } from "express";
import { runCollect } from "../scripts/collect.js";

const router = Router();

let running = false;
let lastResult = null;

// POST /api/collect/run — trigger a collection run
router.post("/run", async (req, res) => {
  if (running) {
    return res.status(409).json({ error: "Collection already in progress" });
  }

  running = true;
  res.json({ status: "started" });

  try {
    lastResult = await runCollect();
  } catch (err) {
    console.error("[collect] run failed:", err);
    lastResult = { error: "internal error" };
  } finally {
    running = false;
  }
});

// GET /api/collect/status
router.get("/status", (req, res) => {
  res.json({
    running,
    last: lastResult,
  });
});

export default router;
