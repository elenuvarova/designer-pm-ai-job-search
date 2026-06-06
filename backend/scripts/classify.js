// Phase 2 classifier — runs over all unclassified jobs in the DB.
// Rule-based for everything; LLM only for ambiguous language-requirement cases.
import "dotenv/config";
import { Op } from "sequelize";
import { pathToFileURL } from "node:url";
import { sequelize } from "../db.js";
import { syncModels, Job, JobClassification, JobSkill } from "../models/index.js";
import { analyzeLanguageRequirements } from "../nlp/languageReq.js";
import { extractSkills } from "../nlp/skills.js";
import { classifyJob } from "../nlp/classifyJob.js";
import { adjudicateLanguage } from "../llm/provider.js";
import { sleep } from "../nlp/normalize.js";

// Gemini free tier: 15 RPM — 4-second gap keeps us safe
const LLM_DELAY_MS = 4200;

// Jobs with no classification row yet. Done in SQL via a NOT IN subquery rather
// than loading every classification id + every Job into JS and diffing.
// The literal subquery is valid on both SQLite and Postgres.
async function getUnclassified() {
  return Job.findAll({
    attributes: ["id", "title", "company", "country", "description"],
    where: {
      id: { [Op.notIn]: sequelize.literal("(SELECT job_id FROM job_classifications)") },
    },
  });
}

// --all re-classifies every job (wipes existing classifications + skills first). Use after
// the role/skill rules change so stale classifications are recomputed, not skipped.
export async function runClassify({ all = false } = {}) {
  const startedAt = new Date();
  console.log(`\n[classify] started ${startedAt.toISOString()}${all ? " (--all: full re-classify)" : ""}`);

  await syncModels();

  if (all) {
    await JobSkill.destroy({ where: {} });
    await JobClassification.destroy({ where: {} });
    console.log("[classify] cleared existing classifications + skills");
  }

  const jobs = await getUnclassified();
  console.log(`[classify] ${jobs.length} unclassified jobs`);

  if (jobs.length === 0) {
    console.log("[classify] nothing to do");
    return { classified: 0, llm_calls: 0, elapsed_s: 0 };
  }

  const llmQueue = [];
  const classificationRows = [];
  const skillRows = [];

  // Rule-based pass — no API calls. Shared classifyJob() produces the base
  // classification; this script layers persistence-only fields (evidence,
  // classification_method) and queues ambiguous cases for LLM adjudication.
  for (const job of jobs) {
    const desc = job.description || "";
    const title = job.title || "";

    // Note: classifyJob runs analyzeLanguageRequirements internally on `desc`,
    // but we need its evidence/ambiguous_snippets here, so call it once more.
    // (Pure + cheap; keeps the shared fn's contract narrow.)
    const langReq = analyzeLanguageRequirements(desc);
    const { classification } = classifyJob(title, desc);
    const skills = extractSkills(desc);

    const row = {
      job_id: job.id,
      ...classification,
      classification_method: "rule",
      evidence: langReq.evidence,
    };

    classificationRows.push(row);

    for (const { skill, confidence } of skills) {
      skillRows.push({ job_id: job.id, skill, skill_type: "matched", confidence });
    }

    if (langReq.needs_llm && langReq.ambiguous_snippets.length > 0) {
      llmQueue.push({ job_id: job.id, snippets: langReq.ambiguous_snippets });
    }
  }

  console.log(
    `[classify] rule-based done — ${llmQueue.length} jobs queued for LLM adjudication`
  );

  // LLM pass — only for ambiguous language-requirement cases
  let llmCalls = 0;
  for (const { job_id, snippets } of llmQueue) {
    const result = await adjudicateLanguage(snippets);
    llmCalls++;
    if (result) {
      const row = classificationRows.find((r) => r.job_id === job_id);
      if (row) {
        row.required_languages = result.required_languages || row.required_languages;
        row.optional_languages = result.optional_languages || row.optional_languages;
        row.language_blocker = result.language_blocker ?? row.language_blocker;
        row.language_match = result.language_match || row.language_match;
        row.classification_method = "llm";
      }
    }
    await sleep(LLM_DELAY_MS);
  }

  // Bulk insert
  await JobClassification.bulkCreate(classificationRows, { ignoreDuplicates: true });
  if (skillRows.length > 0) {
    await JobSkill.bulkCreate(skillRows, { ignoreDuplicates: true });
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const stats = {
    classified: classificationRows.length,
    skills_extracted: skillRows.length,
    llm_calls: llmCalls,
    elapsed_s: parseFloat(elapsed),
  };

  // Language match breakdown
  const breakdown = classificationRows.reduce((acc, r) => {
    acc[r.language_match] = (acc[r.language_match] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n[classify] done in ${elapsed}s`);
  console.log(`  classified: ${stats.classified} jobs, ${stats.skills_extracted} skill tags`);
  console.log(`  LLM calls: ${llmCalls}`);
  console.log(`  language_match breakdown:`, breakdown);

  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runClassify({ all: process.argv.includes("--all") });
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[classify] fatal:", err);
    await sequelize.close();
    process.exit(1);
  }
}
