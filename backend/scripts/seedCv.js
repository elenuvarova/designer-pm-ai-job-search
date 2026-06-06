// Seed the single employee's CV directly into the database, without the upload
// UI. Reads a local PDF/DOCX, extracts + chunks + batch-embeds it, and replaces
// any existing CV.
//
// Usage (run locally; uses whatever DATABASE_URL is set, else local SQLite):
//   cd backend
//   node scripts/seedCv.js /path/to/employee-cv.pdf
//
// PRIVACY: pass a path to a CV kept OUTSIDE the repo. Do NOT commit the CV — this
// repo is public.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { sequelize } from "../db.js";
import { syncModels } from "../models/index.js";
import { ingestCv, PDF_MIME, DOCX_MIME } from "../rag/cvIngest.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/seedCv.js <path-to-cv.pdf|.docx>");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const ext = path.extname(file).toLowerCase();
const mimetype = ext === ".pdf" ? PDF_MIME : ext === ".docx" ? DOCX_MIME : null;
if (!mimetype) {
  console.error("Only .pdf or .docx files are supported.");
  process.exit(1);
}

try {
  await syncModels();
  const buffer = fs.readFileSync(file);
  const result = await ingestCv({ buffer, mimetype, label: path.basename(file) });
  console.log("Seeded CV →", result);
  await sequelize.close();
  process.exit(0);
} catch (err) {
  console.error("seedCv failed:", err.message);
  await sequelize.close();
  process.exit(1);
}
