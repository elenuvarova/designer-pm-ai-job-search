// Logical backup of the whole database to a single JSON file. Read-only on the source —
// safe to run anytime. Restore with scripts/restore.js (or load the JSON manually).
//   node scripts/backup.js            → backups/backup-<timestamp>.json
//   node scripts/backup.js my.json    → backups/my.json
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sequelize } from "../db.js";
import {
  syncModels, Source, Job, JobClassification, JobSkill, Application, CvDocument, CvChunk,
} from "../models/index.js";

const MODELS = { Source, Job, JobClassification, JobSkill, Application, CvDocument, CvChunk };

export async function runBackup(fileArg) {
  await syncModels();

  const dump = { meta: {}, tables: {} };
  for (const [name, Model] of Object.entries(MODELS)) {
    const rows = await Model.findAll({ raw: true });
    dump.tables[name] = rows;
    console.log(`[backup] ${name}: ${rows.length} rows`);
  }

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  // Timestamp comes from the DB clock (deterministic, no local-clock assumptions).
  const [{ now }] = await sequelize.query("SELECT now() AS now", { type: sequelize.QueryTypes.SELECT });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  dump.meta = { created_at: now, dialect: sequelize.getDialect() };

  const file = path.join(dir, fileArg || `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump));
  const mb = (fs.statSync(file).size / 1e6).toFixed(1);
  console.log(`[backup] wrote ${file} (${mb} MB)`);
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runBackup(process.argv[2]);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[backup] fatal:", err);
    await sequelize.close();
    process.exit(1);
  }
}
