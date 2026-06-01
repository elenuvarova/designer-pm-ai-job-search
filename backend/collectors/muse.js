import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// The Muse is a US-centric board and its `location` query filter is unreliable (it returns
// the same mostly-US jobs regardless of the location passed). So we query by CATEGORY only
// and trust each job's REAL `locations[]` — keeping only postings that are genuinely in
// Europe. US/elsewhere-onsite jobs are dropped (US/Asia remote is covered by the remote feeds).
const BASE = "https://www.themuse.com/api/public/jobs";
const CATEGORIES = ["Design and UX", "Product Management"];
const MAX_PAGES = 5;

// Map a Muse location name ("City, Country" / "City, ST") to a European country code, else null.
const EUROPE = [
  [/belgi|brussels|antwerp|ghent|gent|leuven|bruges/i, "BE"],
  [/netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven|the hague|hague/i, "NL"],
  [/luxembourg/i, "LU"],
  [/united kingdom|england|scotland|wales|london|manchester|\buk\b|edinburgh|bristol|cambridge/i, "GB"],
  [/germany|deutschland|berlin|munich|münchen|munchen|hamburg|cologne|köln|frankfurt|stuttgart/i, "DE"],
  [/france|paris|lyon|marseille|toulouse|bordeaux|nantes|lille/i, "FR"],
  [/spain|españa|espana|madrid|barcelona|valencia|málaga|malaga|seville/i, "ES"],
  [/italy|italia|milan|milano|rome|roma|turin|torino|bologna/i, "IT"],
  [/austria|österreich|osterreich|vienna|wien/i, "AT"],
  [/poland|polska|warsaw|warszawa|kraków|krakow|wrocław|wroclaw/i, "PL"],
  [/portugal|lisbon|lisboa|porto/i, "PT"],
  [/ireland|dublin|cork/i, "IE"],
  [/sweden|stockholm|gothenburg|göteborg/i, "SE"],
  [/denmark|copenhagen|københavn|kobenhavn/i, "DK"],
  [/norway|oslo/i, "NO"],
  [/finland|helsinki/i, "FI"],
  [/switzerland|schweiz|suisse|zurich|zürich|geneva|genève|geneve|basel|bern/i, "CH"],
  [/czech|prague|praha|brno/i, "CZ"],
  [/romania|bucharest|bucurești|cluj/i, "RO"],
  [/greece|athens|thessaloniki/i, "GR"],
  [/hungary|budapest/i, "HU"],
];

function europeanCountry(locName) {
  for (const [re, code] of EUROPE) if (re.test(locName || "")) return code;
  return null;
}

export async function collectMuse(source) {
  const apiKey = process.env.THE_MUSE_API_KEY;
  if (!apiKey) {
    console.log("  The Muse: THE_MUSE_API_KEY not set, skipping");
    return [];
  }

  const seen = new Set();
  const jobs = [];
  let scanned = 0;

  for (const category of CATEGORIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `${BASE}?api_key=${apiKey}` +
        `&category=${encodeURIComponent(category)}` +
        `&page=${page}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.log(`  Muse ${category} p${page}: HTTP ${res.status}`);
          break;
        }
        const data = await res.json();
        const results = data.results || [];
        if (results.length === 0) break;
        scanned += results.length;

        for (const job of results) {
          if (seen.has(job.id)) continue;
          if (!isTargetRoleTitle(job.name)) continue;

          // Trust the job's REAL location — keep only European postings.
          const locNames = (job.locations || []).map((l) => l.name).filter(Boolean);
          let country = null, locName = null;
          for (const ln of locNames) {
            const c = europeanCountry(ln);
            if (c) { country = c; locName = ln; break; }
          }
          if (!country) continue; // not in Europe → drop (Muse is US-centric)

          seen.add(job.id);
          jobs.push({
            source_id: source.id,
            source_job_id: String(job.id),
            title: job.name,
            company: job.company?.name || null,
            country,
            city: locName.split(",")[0].trim() || null,
            location_raw: locName,
            description: stripHtml(job.contents || ""),
            apply_url: job.refs?.landing_page || null,
            posted_at: job.publication_date ? new Date(job.publication_date) : null,
            raw_json: { id: job.id },
            dedupe_hash: dedupeHash(job.name, job.company?.name, country),
          });
        }

        await sleep(300);
      } catch (err) {
        console.error(`  Muse ${category} p${page}: ${err.message}`);
        break;
      }
    }
  }

  console.log(`  Muse: ${jobs.length} European design/product jobs (from ${scanned} scanned)`);
  return jobs;
}
