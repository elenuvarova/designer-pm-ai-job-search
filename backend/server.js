import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
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

app.get("/api/health", async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: "ok", db: dbKind });
  } catch (err) {
    console.error("[health] db check failed:", err);
    res.status(500).json({ status: "error" });
  }
});

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from the backend" });
});

app.use("/api/jobs", jobsRouter);
app.use("/api/collect", collectRouter);
app.use("/api/classify", classifyRouter);
app.use("/api/cv", cvRouter);
app.use("/api/jobs", ragRouter);
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
process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException:", err);
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
  });
}

start();
