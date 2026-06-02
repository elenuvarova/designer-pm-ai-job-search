import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// EURES — the EU public job-mobility portal. Zero-auth JSON search API.
// It is the project's broadest free EU source — native coverage across every EU/EEA
// country, including markets the company boards never see.
const SEARCH_URL =
  "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search?lang=en&app=0.27.0";
const DETAIL_URL = "https://europa.eu/eures/portal/jv-se/jv-details";

// Two tiers: prioritise the home region, then sweep the rest of Europe. Each tier is a
// separate query so BE/NL volume is never crowded out by the larger markets.
// Geographic tiers — each searched separately so small markets (Baltics, Nordics,
// Portugal…) get their own BEST_MATCH top-100 instead of being crowded out by DE/FR/ES
// when the whole continent is queried at once.
const TIERS = [
  ["home", ["be", "nl"]],
  ["western", ["lu", "de", "fr", "es", "it", "at", "pt", "ie", "ch"]],
  ["nordics", ["se", "dk", "fi", "no", "is"]],
  ["central-east", ["pl", "cz", "sk", "hu", "ro", "bg", "hr", "si", "gr"]],
  ["baltics", ["ee", "lv", "lt"]],
];

// One pass per keyword. `EVERYWHERE` matches description text too, so each pass is broad
// — BEST_MATCH ranks the most relevant first and the title gate drops the noise.
const KEYWORDS = [
  "product designer",
  "ux designer",
  "graphic designer",
  "product manager",
];

const MAX_PAGES = 2; // up to 2 × 50 = 100 ranked hits per keyword per tier
const RESULTS_PER_PAGE = 50;

const COUNTRY_NAMES = {
  BE: "Belgium", NL: "Netherlands", LU: "Luxembourg", DE: "Germany", FR: "France",
  ES: "Spain", IT: "Italy", AT: "Austria", PL: "Poland", PT: "Portugal", IE: "Ireland",
  SE: "Sweden", DK: "Denmark", FI: "Finland", CZ: "Czechia", RO: "Romania", GR: "Greece",
  HU: "Hungary", BG: "Bulgaria", HR: "Croatia", SK: "Slovakia", SI: "Slovenia",
  EE: "Estonia", LV: "Latvia", LT: "Lithuania", IS: "Iceland", NO: "Norway", CH: "Switzerland",
};

// locationMap keys are uppercase country codes, e.g. { LU: [null] }.
function pickCountry(locationMap) {
  const codes = Object.keys(locationMap || {}).map((c) => c.toUpperCase());
  // Prefer the home region if a posting spans multiple countries.
  return ["BE", "NL"].find((c) => codes.includes(c)) || codes[0] || null;
}

// employer.name is frequently the French placeholder "non renseigné" (= not provided).
function cleanCompany(employer) {
  const name = (employer?.name || "").trim();
  if (!name || /^non renseign/i.test(name)) return null;
  return name.slice(0, 200);
}

async function search(keyword, page, locationCodes) {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "design-product-job-scout/1.0 (personal research tool)",
    },
    body: JSON.stringify({
      resultsPerPage: RESULTS_PER_PAGE,
      page,
      sortSearch: "BEST_MATCH",
      keywords: [{ keyword, specificSearchCode: "EVERYWHERE" }],
      locationCodes,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function collectEures(source) {
  const jobs = [];
  const seen = new Set(); // dedupe by EURES id across keyword/tier passes

  for (const [tierName, locationCodes] of TIERS) {
    for (const keyword of KEYWORDS) {
      let kept = 0;

      for (let page = 1; page <= MAX_PAGES; page++) {
        try {
          const data = await search(keyword, page, locationCodes);
          const jvs = data.jvs || [];
          if (jvs.length === 0) break;

          for (const jv of jvs) {
            if (!jv.id || seen.has(jv.id)) continue;
            if (!isTargetRoleTitle(jv.title)) continue;
            seen.add(jv.id);

            const country = pickCountry(jv.locationMap);
            const company = cleanCompany(jv.employer);

            jobs.push({
              source_id: source.id,
              source_job_id: jv.id,
              title: (jv.title || "").slice(0, 300),
              company,
              country,
              city: null,
              location_raw: COUNTRY_NAMES[country] || country || null,
              description: stripHtml(jv.description || ""),
              apply_url: `${DETAIL_URL}/${encodeURIComponent(jv.id)}?lang=en`,
              posted_at: jv.creationDate ? new Date(jv.creationDate) : null,
              raw_json: { id: jv.id, _keyword: keyword },
              dedupe_hash: dedupeHash(jv.title, company || "", country || ""),
            });
            kept++;
          }

          if (jvs.length < RESULTS_PER_PAGE) break; // last page
          await sleep(400);
        } catch (err) {
          console.error(`  EURES/${tierName}/"${keyword}" p${page}: ${err.message}`);
          break;
        }
      }

      console.log(`  EURES/${tierName}/"${keyword}": kept ${kept}`);
      await sleep(400);
    }
  }

  console.log(`  EURES: ${jobs.length} relevant design/product jobs total`);
  return jobs;
}
