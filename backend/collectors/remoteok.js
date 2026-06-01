import { stripHtml, dedupeHash } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";
import { remoteRegionAllowed } from "./geo.js";

export async function collectRemoteok(source) {
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: {
        "User-Agent": "design-product-job-scout/1.0 (personal research tool)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.log(`  RemoteOK: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    // First element is a legal notice, not a job — skip it
    const items = Array.isArray(data) ? data.slice(1) : [];

    const jobs = [];
    for (const job of items) {
      if (!job.id) continue;
      if (!isTargetRoleTitle(job.position || "", job.tags)) continue;
      if (!remoteRegionAllowed(job.location)) continue;

      jobs.push({
        source_id: source.id,
        source_job_id: String(job.id),
        title: job.position || "Unknown",
        company: job.company || null,
        country: null,
        city: null,
        location_raw: job.location || "Remote",
        description: stripHtml(job.description || ""),
        apply_url: job.apply_url || job.url || `https://remoteok.com/l/${job.slug}`,
        posted_at: job.date ? new Date(job.date) : null,
        raw_json: job,
        dedupe_hash: dedupeHash(job.position || "", job.company, "REMOTE"),
      });
    }

    console.log(`  RemoteOK: ${jobs.length} relevant jobs from ${items.length} total`);
    return jobs;
  } catch (err) {
    console.error(`  RemoteOK: ${err.message}`);
    return [];
  }
}
