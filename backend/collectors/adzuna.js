import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";
import { classifyRemote } from "../nlp/remote.js";

// European Adzuna endpoints — every role type (onsite/hybrid/remote). BE/NL are surfaced
// first in the API by country. Adzuna has no Luxembourg endpoint, so LU comes from EURES.
const EUROPE = [
  { endpoint: "be", country: "BE", currency: "EUR" },
  { endpoint: "nl", country: "NL", currency: "EUR" },
  { endpoint: "gb", country: "GB", currency: "GBP" },
  { endpoint: "de", country: "DE", currency: "EUR" },
  { endpoint: "fr", country: "FR", currency: "EUR" },
  { endpoint: "es", country: "ES", currency: "EUR" },
  { endpoint: "it", country: "IT", currency: "EUR" },
  { endpoint: "at", country: "AT", currency: "EUR" },
  { endpoint: "pl", country: "PL", currency: "PLN" },
];

// USA + Asia — REMOTE roles only (the user wants these regions for remote work, not
// relocation). Each posting must read as remote to be kept.
const REMOTE_ONLY = [
  { endpoint: "us", country: "US", currency: "USD" },
  { endpoint: "in", country: "IN", currency: "INR" },
  { endpoint: "sg", country: "SG", currency: "SGD" },
];

const QUERIES = ["product designer", "ux designer", "graphic designer", "product manager"];
const RESULTS_PER_PAGE = 50;
const BASE = "https://api.adzuna.com/v1/api/jobs";

const REMOTE_HINT =
  /\bremote\b|work.?from.?home|home.?office|fully.?remote|remote.?first|distributed\s+team/i;

function parseCity(location) {
  const area = location?.area || [];
  return area[3] || area[2] || null;
}

function isRemote(job, title, desc) {
  const text = `${title} ${job.location?.display_name || ""} ${desc}`;
  return REMOTE_HINT.test(text) || classifyRemote(title, desc) === "remote";
}

export async function collectAdzuna(source) {
  const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = process.env;
  if (!appId || !appKey) {
    console.log("  Adzuna: ADZUNA_APP_ID/KEY not set, skipping");
    return [];
  }

  const configs = [
    ...EUROPE.map((c) => ({ ...c, remoteOnly: false })),
    ...REMOTE_ONLY.map((c) => ({ ...c, remoteOnly: true })),
  ];

  const jobs = [];
  let apiCalls = 0;

  for (const { endpoint, country, currency, remoteOnly } of configs) {
    for (const query of QUERIES) {
      const url =
        `${BASE}/${endpoint}/search/1` +
        `?app_id=${appId}&app_key=${appKey}` +
        `&results_per_page=${RESULTS_PER_PAGE}` +
        `&what=${encodeURIComponent(query)}` +
        `&content-type=application/json`;

      try {
        const res = await fetch(url);
        apiCalls++;

        if (!res.ok) {
          console.log(`  Adzuna ${country}/"${query}": HTTP ${res.status}`);
          continue;
        }

        const data = await res.json();
        const results = data.results || [];
        let kept = 0;

        for (const job of results) {
          // Adzuna's `what=` search is fuzzy and returns adjacent roles (e.g. a Java
          // engineer for "product manager"). Gate on the title like every other source.
          if (!isTargetRoleTitle(job.title)) continue;
          const desc = stripHtml(job.description || "");
          // USA/Asia: keep remote roles only.
          if (remoteOnly && !isRemote(job, job.title || "", desc)) continue;

          jobs.push({
            source_id: source.id,
            source_job_id: String(job.id),
            title: job.title,
            company: job.company?.display_name || null,
            country,
            city: parseCity(job.location),
            location_raw: job.location?.display_name || null,
            description: desc,
            apply_url: job.redirect_url || null,
            posted_at: job.created ? new Date(job.created) : null,
            salary_min: job.salary_min ?? null,
            salary_max: job.salary_max ?? null,
            salary_currency: job.salary_min || job.salary_max ? currency : null,
            raw_json: job,
            dedupe_hash: dedupeHash(job.title, job.company?.display_name, country),
          });
          kept++;
        }

        const tier = remoteOnly ? "remote-only" : "all";
        console.log(`  Adzuna ${country}/"${query}": kept ${kept}/${results.length} (${tier})`);
      } catch (err) {
        console.error(`  Adzuna ${country}/"${query}": ${err.message}`);
      }

      await sleep(400);
    }
  }

  console.log(`  Adzuna: ${apiCalls} API calls, ${jobs.length} jobs`);
  return jobs;
}
