import { stripHtml, dedupeHash } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";
import { remoteRegionAllowed } from "./geo.js";

// Remotive's native Design and Product categories — 2 calls/day, within its soft limit.
const ENDPOINTS = [
  "https://remotive.com/api/remote-jobs?category=design",
  "https://remotive.com/api/remote-jobs?category=product",
];

export async function collectRemotive(source) {
  const seen = new Set();
  const jobs = [];

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "design-product-job-scout/1.0 (personal research tool)" },
      });

      if (!res.ok) {
        console.log(`  Remotive ${url}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const results = data.jobs || [];

      for (const job of results) {
        if (seen.has(job.id)) continue;
        if (!isTargetRoleTitle(job.title, job.tags)) continue;
        if (!remoteRegionAllowed(job.candidate_required_location)) continue;

        seen.add(job.id);
        jobs.push({
          source_id: source.id,
          source_job_id: String(job.id),
          title: job.title,
          company: job.company_name || null,
          country: null, // remote — no specific country
          city: null,
          location_raw: job.candidate_required_location || "Remote",
          description: stripHtml(job.description || ""),
          apply_url: job.url || null,
          posted_at: job.publication_date ? new Date(job.publication_date) : null,
          raw_json: job,
          dedupe_hash: dedupeHash(job.title, job.company_name, "REMOTE"),
        });
      }

      console.log(`  Remotive: fetched ${results.length} from ${url}`);
    } catch (err) {
      console.error(`  Remotive: ${err.message}`);
    }
  }

  console.log(`  Remotive: ${jobs.length} relevant remote jobs`);
  return jobs;
}
