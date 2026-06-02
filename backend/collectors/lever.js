import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Curated Benelux-connected companies on Lever ATS.
// ?mode=json returns a JSON array; 404 = company not on Lever.
// Every slug below was probed live and returns HTTP 200 (a JSON postings array).
// 404 boards waste a request + 300ms each, so dead slugs are pruned rather than kept.
const COMPANIES = [
  // Benelux-HQ
  { slug: "deliverect",     name: "Deliverect",     country: "BE", city: "Ghent" },
  { slug: "talkwalker",     name: "Talkwalker",     country: "LU", city: "Luxembourg" },
  // EU remote / offices accessible from Benelux
  { slug: "aircall",        name: "Aircall",        country: null, city: null },
  { slug: "contentsquare",  name: "Contentsquare",  country: null, city: null },
  { slug: "qonto",          name: "Qonto",          country: null, city: null },
  { slug: "doctrine",       name: "Doctrine",       country: null, city: null },
  { slug: "pennylane",      name: "Pennylane",      country: null, city: null },
  { slug: "swile",          name: "Swile",          country: null, city: null },
  // AI labs / EU (verified live; country resolved per-role below)
  { slug: "mistral",        name: "Mistral AI",     country: null, city: null }, // incl. Luxembourg + Amsterdam roles
  { slug: "veepee",         name: "Veepee",         country: null, city: null },
  { slug: "pnlfin",         name: "Finom",          country: "NL", city: "Amsterdam" }, // EU-hosted Lever board (api.eu.lever.co)
  { slug: "pipedrive",      name: "Pipedrive",      country: "EE", city: "Tallinn" }, // Estonian; design/product roles (some remote)
];

function parseCountry(location, fallback) {
  if (!location) return fallback;
  const t = location.toLowerCase();
  if (/netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague/.test(t)) return "NL";
  if (/belgium|brussels|ghent|gent|antwerp|leuven/.test(t)) return "BE";
  if (/luxembourg/.test(t)) return "LU";
  if (/united kingdom|england|london|manchester|\buk\b|scotland|cardiff/.test(t)) return "GB";
  if (/germany|berlin|munich|münchen|munchen|hamburg|frankfurt/.test(t)) return "DE";
  if (/france|paris|lyon/.test(t)) return "FR";
  if (/spain|madrid|barcelona/.test(t)) return "ES";
  if (/italy|milan|rome/.test(t)) return "IT";
  if (/austria|vienna|wien/.test(t)) return "AT";
  if (/poland|warsaw|krak/.test(t)) return "PL";
  return fallback;
}

// Lever has two API hosts: US (api.lever.co) and EU (api.eu.lever.co). A board
// lives on exactly one; the other returns 404. Try US first, then fall back to EU.
async function fetchPostings(slug) {
  const headers = { "User-Agent": "design-product-job-scout/1.0 (personal research tool)" };
  for (const host of ["api.lever.co", "api.eu.lever.co"]) {
    const res = await fetch(`https://${host}/v0/postings/${slug}?mode=json`, { headers });
    if (res.ok) return res.json();
    if (res.status !== 404) console.log(`  Lever/${slug}@${host}: HTTP ${res.status}`);
  }
  return null; // not found on either host
}

export async function collectLever(source) {
  const jobs = [];

  for (const company of COMPANIES) {
    try {
      const postings = await fetchPostings(company.slug);
      if (!Array.isArray(postings)) continue;

      let added = 0;
      for (const p of postings) {
        if (!isTargetRoleTitle(p.text || "")) continue;

        const location = p.categories?.location || null;
        const country = parseCountry(location, company.country);
        const city = location?.split(",")[0]?.trim() || company.city;

        // Combine description + lists for full text
        const listsText = (p.lists || [])
          .map((l) => `${l.text || ""}\n${l.content || ""}`)
          .join("\n");
        const desc = stripHtml(`${p.description || ""} ${listsText} ${p.additional || ""}`);

        jobs.push({
          source_id: source.id,
          source_job_id: p.id,
          title: p.text,
          company: company.name,
          country,
          city,
          location_raw: location || company.city || null,
          description: desc,
          apply_url: p.applyUrl || p.hostedUrl || null,
          // createdAt is Unix ms from Lever
          posted_at: p.createdAt ? new Date(p.createdAt) : null,
          raw_json: { id: p.id, _slug: company.slug },
          dedupe_hash: dedupeHash(p.text, company.name, country || ""),
        });
        added++;
      }

      console.log(`  Lever/${company.slug}: ${added} relevant / ${postings.length} total`);
    } catch (err) {
      console.error(`  Lever/${company.slug}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`  Lever: ${jobs.length} relevant jobs total`);
  return jobs;
}
