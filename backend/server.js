import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { sequelize, dbKind } from "./db.js";
import { syncModels } from "./models/index.js";
import jobsRouter from "./routes/jobs.js";
import collectRouter from "./routes/collect.js";
import classifyRouter from "./routes/classify.js";
import cvRouter from "./routes/cv.js";
import ragRouter from "./routes/rag.js";
import applicationsRouter from "./routes/applications.js";
import analyticsRouter from "./routes/analytics.js";
import analyzeRouter from "./routes/analyze.js";
import searchRouter from "./routes/search.js";
import { startScheduler } from "./scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Behind Coolify/Traefik: trust the first proxy so secure cookies / HSTS / client IP work.
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The React app ships inline styles (Vite + inline component styles), so
        // style-src needs 'unsafe-inline'. Scripts stay locked to 'self'.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Tell browsers to stick to HTTPS (Traefik terminates TLS in front of us).
    hsts: { maxAge: 15552000, includeSubDomains: true },
  })
);
app.use(compression());

app.use(express.json({ limit: "1mb" })); // room for pasted JDs / chat payloads

// Rate limiting. The app is public (no auth gate), so these limiters are the
// primary protection against abuse and LLM-quota drain. Mounted after
// express.json so they only meter parsed requests; app.set("trust proxy", 1)
// above makes keying on the client IP behind Coolify/Traefik correct.

// Strict limiter for the expensive surfaces: LLM-backed generation (RAG
// company-brief / apply-kit live under /api/jobs, plus /api/search and
// /api/analyze) and file uploads (/api/cv). 10 requests/min per IP.
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});

// Very tight limiter for the collection trigger: it kicks off a heavy fan-out
// across every source, so 2 requests/min per IP is plenty.
const collectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});

// Scope the strict limiter to the expensive surfaces ONLY — never the read feed.
// The LLM-backed RAG routes (company-brief, apply-kit, tailor/cover/prep) live
// under /api/jobs via ragRouter, so the limiter is attached at THAT mount below
// (app.use("/api/jobs", strictLimiter, ragRouter)) — not on /api/jobs broadly,
// which would throttle normal feed browsing (list, detail, similar) at 10/min.
app.use("/api/rag", strictLimiter); // reserved mount (future LLM routes)
app.use("/api/search", strictLimiter); // semantic search + grounded chat (LLM)
app.use("/api/analyze", strictLimiter); // paste-a-JD NLP pipeline
app.use("/api/cv/upload", strictLimiter); // CV upload: pdf/docx parse + batch embed
app.use("/api/collect", collectLimiter); // heavy source fan-out

app.get("/api/health", async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: "ok", db: dbKind });
  } catch (err) {
    console.error("[health] db check failed:", err);
    res.status(500).json({ status: "error" });
  }
});

app.use("/api/jobs", jobsRouter);
app.use("/api/collect", collectRouter);
app.use("/api/classify", classifyRouter);
app.use("/api/cv", cvRouter);
// ragRouter holds the LLM endpoints (company-brief, apply-kit, tailor/cover/prep).
// jobsRouter (mounted above) handles all GET feed reads first, so strictLimiter
// here only meters the RAG POSTs that fall through to this mount.
app.use("/api/jobs", strictLimiter, ragRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/analyze", analyzeRouter);
app.use("/api/search", searchRouter);

if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(__dirname, "public");
  // Vite emits content-hashed asset filenames, so they're safe to cache for a year.
  app.use(express.static(publicDir, { maxAge: "1y", index: false }));
  // SPA fallback: serve index.html for any non-/api route. Never cache it so new
  // deploys (with new asset hashes) are picked up immediately.
  app.get("*", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// Log async failures instead of crashing the process; one bad third-party fan-out
// (collector, LLM call) should not take the whole server down.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});
// An uncaught exception leaves the process in an undefined state. Log it and
// exit so Coolify restarts a clean process rather than serving from a corrupt one.
process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err);
  process.exit(1);
});

async function start() {
  try {
    await syncModels();
  } catch (err) {
    console.error("Database init failed:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`db: ${dbKind}`);
    console.log(`Server listening on port ${PORT}`);
    startScheduler();
  });
}

start();
