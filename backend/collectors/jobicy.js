import { stripHtml, dedupeHash } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Jobicy — remote jobs with a working geo filter. Zero-auth. All jobs are remote, so
// alongside Europe we pull the USA and APAC (Asia) — remote-only by nature. We query by
// geo only (the `industry` taxonomy rejects many slugs with HTTP 400) and keep only
// design/product titles via the shared gate.
// GET /api/v2/remote-jobs?geo=europe&count=50
const URLS = [
  "https://jobicy.com/api/v2/remote-jobs?count=50&geo=europe",
  "https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa",
  "https://jobicy.com/api/v2/remote-jobs?count=50&geo=apac",
];

export async function collectJobicy(source) {
  const jobs = [];
  const seen = new Set();

  for (const url of URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "design-product-job-scout/1.0 (personal research tool)",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        console.log(`  Jobicy ${url}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const items = data.jobs || [];

      for (const j of items) {
        const title = j.jobTitle || "";
        if (seen.has(j.id)) continue;
        if (!isTargetRoleTitle(title)) continue;
        seen.add(j.id);

        jobs.push({
          source_id: source.id,
          source_job_id: String(j.id),
          title: title.slice(0, 300),
          company: j.companyName || null,
          country: null, // remote — no specific country
          city: null,
          location_raw: j.jobGeo || "Remote (Europe)",
          description: stripHtml(j.jobDescription || j.jobExcerpt || ""),
          apply_url: j.url || null,
          posted_at: j.pubDate ? new Date(j.pubDate) : null,
          raw_json: { id: j.id, geo: j.jobGeo },
          dedupe_hash: dedupeHash(title, j.companyName, "REMOTE"),
        });
      }
    } catch (err) {
      console.error(`  Jobicy ${url}: ${err.message}`);
    }
  }

  console.log(`  Jobicy: ${jobs.length} relevant jobs total`);
  return jobs;
}
