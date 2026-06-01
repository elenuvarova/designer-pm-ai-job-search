// One-time reset for re-domaining the scout (e.g. switching the role/skill rules, or
// migrating the old ML build to Design & Product). Clears every job-derived row so a
// fresh `collect` + `classify` rebuilds the pool from scratch. Your uploaded CV
// (CvDocument / CvChunk) is preserved.
//
// Usage:  node scripts/reset.js
//
// Note: this also clears tracked applications, since they pointed at the old job pool.
// For a routine refresh (not a domain switch) just run collect + classify — not this.
import "dotenv/config";
import { sequelize } from "../db.js";
import { syncModels, Job, JobClassification, JobSkill, Application } from "../models/index.js";

export async function runReset() {
  await syncModels();

  // Child → parent order so foreign keys are satisfied regardless of cascade settings.
  const skills = await JobSkill.destroy({ where: {} });
  const classifications = await JobClassification.destroy({ where: {} });
  const applications = await Application.destroy({ where: {} });
  const jobs = await Job.destroy({ where: {} });

  console.log(
    `[reset] cleared ${jobs} jobs, ${classifications} classifications, ${skills} skill tags, ${applications} applications`
  );
  console.log("[reset] CV preserved. Next: node scripts/collect.js && node scripts/classify.js");
  return { jobs, classifications, skills, applications };
}

if (process.argv[1].endsWith("reset.js")) {
  try {
    await runReset();
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[reset] fatal:", err);
    await sequelize.close();
    process.exit(1);
  }
}
