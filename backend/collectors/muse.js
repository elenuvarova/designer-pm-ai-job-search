import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

const BASE = "https://www.themuse.com/api/public/jobs";
const RESULTS_PER_PAGE = 20;

// The Muse location filters across Europe — home region (BE/NL) first, then major hubs.
const LOCATIONS = [
  { label: "Brussels, Belgium", country: "BE", city: "Brussels" },
  { label: "Antwerp, Belgium", country: "BE", city: "Antwerp" },
  { label: "Amsterdam, Netherlands", country: "NL", city: "Amsterdam" },
  { label: "Rotterdam, Netherlands", country: "NL", city: "Rotterdam" },
  { label: "London, United Kingdom", country: "GB", city: "London" },
  { label: "Berlin, Germany", country: "DE", city: "Berlin" },
  { label: "Munich, Germany", country: "DE", city: "Munich" },
  { label: "Paris, France", country: "FR", city: "Paris" },
  { label: "Madrid, Spain", country: "ES", city: "Madrid" },
  { label: "Barcelona, Spain", country: "ES", city: "Barcelona" },
  { label: "Milan, Italy", country: "IT", city: "Milan" },
  { label: "Dublin, Ireland", country: "IE", city: "Dublin" },
  { label: "Lisbon, Portugal", country: "PT", city: "Lisbon" },
  { label: "Stockholm, Sweden", country: "SE", city: "Stockholm" },
  { label: "Vienna, Austria", country: "AT", city: "Vienna" },
  { label: "Warsaw, Poland", country: "PL", city: "Warsaw" },
  // Global remote bucket — captures US/Asia remote roles (which are remote-only here).
  { label: "Flexible / Remote", country: null, city: "Remote" },
];

// Role categories available on The Muse that map to design & product.
const CATEGORIES = ["Design and UX", "Creative", "Product Management"];

export async function collectMuse(source) {
  const apiKey = process.env.THE_MUSE_API_KEY;
  if (!apiKey) {
    console.log("  The Muse: THE_MUSE_API_KEY not set, skipping");
    return [];
  }

  const seen = new Set();
  const jobs = [];

  for (const { label, country, city } of LOCATIONS) {
    for (const category of CATEGORIES) {
      const url =
        `${BASE}?api_key=${apiKey}` +
        `&category=${encodeURIComponent(category)}` +
        `&location=${encodeURIComponent(label)}` +
        `&page=1&count=${RESULTS_PER_PAGE}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.log(`  Muse ${country}/${category}: HTTP ${res.status}`);
          continue;
        }

        const data = await res.json();
        const results = data.results || [];

        for (const job of results) {
          if (seen.has(job.id)) continue;
          if (!isTargetRoleTitle(job.name)) continue; // "Creative" is broad — keep design/product only
          seen.add(job.id);

          jobs.push({
            source_id: source.id,
            source_job_id: String(job.id),
            title: job.name,
            company: job.company?.name || null,
            country,
            city,
            location_raw: label,
            description: stripHtml(job.contents || ""),
            apply_url: job.refs?.landing_page || null,
            posted_at: job.publication_date ? new Date(job.publication_date) : null,
            raw_json: job,
            dedupe_hash: dedupeHash(job.name, job.company?.name, country),
          });
        }

        console.log(`  Muse ${country}/"${category}": ${results.length} results`);
      } catch (err) {
        console.error(`  Muse ${country}/"${category}": ${err.message}`);
      }

      await sleep(300);
    }
  }

  console.log(`  Muse: ${jobs.length} jobs total`);
  return jobs;
}
