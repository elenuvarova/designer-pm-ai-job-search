import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Curated European companies on SmartRecruiters ATS — reaches enterprises/telcos
// the Greenhouse/Lever lists miss. The postings list carries no description or
// apply URL, so each kept posting needs one detail call. Slugs are case-sensitive;
// totalFound === 0 means the slug is wrong/empty → skip.
const COMPANIES = [
  { slug: "kpn",        name: "KPN",       country: "NL", city: "Amsterdam" },
  { slug: "Wehkamp",    name: "Wehkamp",   country: "NL", city: "Zwolle" },
  { slug: "Vitol",      name: "Vitol",     country: "NL", city: "Rotterdam" },
  { slug: "DataChef",   name: "DataChef",  country: "NL", city: "Nootdorp" },
  { slug: "Wavestone1", name: "Wavestone", country: "LU", city: "Luxembourg" }, // global board — Benelux-filtered below
  { slug: "ARHS",       name: "ARHS Group", country: "LU", city: "Luxembourg" }, // LU — Data Engineers
  { slug: "WAES",       name: "WAES",      country: "NL", city: "Eindhoven" },
  { slug: "Coolblue",   name: "Coolblue",  country: "NL", city: "Rotterdam" },  // large board — Benelux-filtered below
];

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const MAX_LIST_PAGES = 3;   // up to 300 postings scanned per company
const MAX_DETAILS = 25;     // cap detail calls per company (after filtering)

// European country codes we keep (EU/EEA + UK + CH). location.country is a lowercase
// ISO code; boards like Wavestone span many countries, so we keep only European ones.
const EUROPE = new Set([
  "BE", "NL", "LU", "GB", "DE", "FR", "ES", "IT", "AT", "PL", "PT", "IE", "SE", "DK",
  "NO", "FI", "CH", "CZ", "RO", "GR", "HU", "BG", "HR", "SK", "SI", "EE", "LV", "LT",
  "IS", "MT", "CY",
]);

function europeCountry(location) {
  const c = (location?.country || "").toUpperCase();
  return EUROPE.has(c) ? c : null;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "design-product-job-scout/1.0 (personal research tool)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function detailDescription(detail) {
  const s = detail.jobAd?.sections || {};
  const parts = [
    s.jobDescription?.text,
    s.qualifications?.text,
    s.additionalInformation?.text,
  ].filter(Boolean);
  return stripHtml(parts.join(" "));
}

export async function collectSmartRecruiters(source) {
  const jobs = [];

  for (const company of COMPANIES) {
    try {
      // 1) Scan postings (paged) and keep European design/product titles.
      const kept = [];
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const data = await getJson(
          `${API}/${company.slug}/postings?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
        );
        if (page === 0 && !data.totalFound) break; // wrong/empty slug
        const content = data.content || [];
        for (const c of content) {
          const country = europeCountry(c.location);
          if (!country) continue;
          if (!isTargetRoleTitle(c.name)) continue;
          kept.push({ posting: c, country });
        }
        if (content.length < PAGE_SIZE) break; // last page
        await sleep(300);
      }

      // 2) Fetch detail (description + apply URL) for each kept posting.
      let added = 0;
      for (const { posting, country } of kept.slice(0, MAX_DETAILS)) {
        try {
          const detail = await getJson(`${API}/${company.slug}/postings/${posting.id}`);
          jobs.push({
            source_id: source.id,
            source_job_id: `${company.slug}/${posting.id}`,
            title: (posting.name || "").slice(0, 300),
            company: company.name,
            country,
            city: posting.location?.city || company.city,
            location_raw:
              posting.location?.city
                ? `${posting.location.city}, ${country}`
                : company.city || null,
            description: detailDescription(detail),
            apply_url: detail.applyUrl || detail.postingUrl || null,
            posted_at: posting.releasedDate ? new Date(posting.releasedDate) : null,
            raw_json: { id: posting.id, _slug: company.slug },
            dedupe_hash: dedupeHash(posting.name, company.name, country),
          });
          added++;
        } catch (err) {
          console.error(`  SmartRecruiters/${company.slug}/${posting.id}: ${err.message}`);
        }
        await sleep(300);
      }

      console.log(`  SmartRecruiters/${company.slug}: ${added} relevant (Europe)`);
    } catch (err) {
      console.error(`  SmartRecruiters/${company.slug}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`  SmartRecruiters: ${jobs.length} relevant jobs total`);
  return jobs;
}
