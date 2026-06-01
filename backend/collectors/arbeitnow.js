import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

const BASE = "https://www.arbeitnow.com/api/job-board-api";
const MAX_PAGES = 8;

// Arbeitnow is an EU job board (DE-heavy). We now keep all of Europe, so the location
// gate is dropped — every design/product role is kept, with best-effort country inference.
function inferCountry(location) {
  if (!location) return null;
  const l = location.toLowerCase();
  if (/netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven/.test(l)) return "NL";
  if (/belgium|belgien|belgique|belgi|brussels|antwerp|ghent/.test(l)) return "BE";
  if (/luxembourg/.test(l)) return "LU";
  if (/germany|deutschland|berlin|munich|münchen|hamburg|cologne|köln|frankfurt/.test(l)) return "DE";
  if (/france|paris|lyon|marseille|toulouse|bordeaux/.test(l)) return "FR";
  if (/spain|españa|madrid|barcelona|valencia/.test(l)) return "ES";
  if (/italy|italia|milan|rome|roma|turin/.test(l)) return "IT";
  if (/austria|österreich|vienna|wien/.test(l)) return "AT";
  if (/poland|polska|warsaw|kraków|krakow/.test(l)) return "PL";
  if (/portugal|lisbon|lisboa|porto/.test(l)) return "PT";
  if (/ireland|dublin/.test(l)) return "IE";
  if (/sweden|stockholm/.test(l)) return "SE";
  if (/denmark|copenhagen|københavn/.test(l)) return "DK";
  if (/switzerland|schweiz|zurich|zürich|geneva/.test(l)) return "CH";
  if (/united kingdom|england|london|manchester|\buk\b/.test(l)) return "GB";
  return null;
}

export async function collectArbeitnow(source) {
  const jobs = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    try {
      const res = await fetch(`${BASE}?page=${page}`);
      if (!res.ok) {
        console.log(`  Arbeitnow page ${page}: HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      const results = data.data || [];
      if (results.length === 0) break;

      for (const job of results) {
        if (!isTargetRoleTitle(job.title, job.tags)) continue;

        const country = inferCountry(job.location);
        jobs.push({
          source_id: source.id,
          source_job_id: job.slug,
          title: job.title,
          company: job.company_name || null,
          country,
          city: null,
          location_raw: job.location || null,
          description: stripHtml(job.description || ""),
          apply_url: job.url || null,
          posted_at: job.created_at ? new Date(job.created_at * 1000) : null,
          raw_json: job,
          dedupe_hash: dedupeHash(job.title, job.company_name, country),
        });
      }

      console.log(`  Arbeitnow page ${page}: ${results.length} total, kept ${jobs.length} so far`);

      if (!data.links?.next) break;
      page++;
      await sleep(300);
    } catch (err) {
      console.error(`  Arbeitnow page ${page}: ${err.message}`);
      break;
    }
  }

  return jobs;
}
