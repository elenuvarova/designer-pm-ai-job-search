// Load a backup JSON (from scripts/backup.js) into the database that DATABASE_URL points
// at. Use this to seed the design project's NEW database from the backup we took.
//   node scripts/restore.js backups/backup-XXXX.json
//
// SAFETY: prints the target host and refuses unless you pass --yes, so you never load into
// the wrong database by accident.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sequelize } from "../db.js";
import {
  syncModels, Source, Job, JobClassification, JobSkill, Application, CvDocument, CvChunk,
} from "../models/index.js";

// FK-safe insertion order (parents before children).
const ORDER = [
  ["Source", Source], ["Job", Job], ["JobClassification", JobClassification],
  ["JobSkill", JobSkill], ["Application", Application],
  ["CvDocument", CvDocument], ["CvChunk", CvChunk],
];

export async function runRestore(fileArg, { confirm = false } = {}) {
  if (!fileArg) throw new Error("Usage: node scripts/restore.js <backup.json> --yes");

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.isAbsolute(fileArg) ? fileArg : path.join(dir, fileArg);
  const dump = JSON.parse(fs.readFileSync(file, "utf8"));

  const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return "(local sqlite)"; } })();
  console.log(`[restore] target DB host : ${host}`);
  console.log(`[restore] source backup  : ${file} (created ${dump.meta?.created_at || "?"})`);
  for (const [name] of ORDER) console.log(`  ${name}: ${dump.tables?.[name]?.length || 0} rows`);

  if (!confirm) {
    console.log("\n[restore] DRY RUN — re-run with --yes to actually load into the target above.");
    return { dryRun: true };
  }

  await syncModels();
  for (const [name, Model] of ORDER) {
    const rows = dump.tables?.[name] || [];
    if (!rows.length) continue;
    await Model.bulkCreate(rows, { ignoreDuplicates: true });
    console.log(`[restore] loaded ${name}: ${rows.length}`);
  }
  // bulkCreate with explicit ids does NOT advance Postgres sequences — fix them, or the
  // next plain insert collides on id. (No-op on SQLite, which has no such sequences.)
  if (sequelize.getDialect() === "postgres") {
    for (const [, Model] of ORDER) {
      const table = Model.getTableName();
      await sequelize.query(
        `SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM "${table}"),1))`,
        { bind: [table] }
      );
    }
    console.log("[restore] sequences synced");
  }
  console.log("[restore] done");
  return { loaded: true };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runRestore(process.argv[2], { confirm: process.argv.includes("--yes") });
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[restore] fatal:", err);
    await sequelize.close();
    process.exit(1);
  }
}
