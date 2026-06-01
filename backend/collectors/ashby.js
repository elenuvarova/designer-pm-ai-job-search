import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Curated EU/UK companies on Ashby ATS (zero-auth) — they hire designers / PMs too.
// GET https://api.ashbyhq.com/posting-api/job-board/{slug} → { jobs: [...] }
// Country is resolved per-role from the posting's location; remote roles → null.
const COMPANIES = [
  { slug: "datasnipper.com", name: "DataSnipper",     country: "NL", city: "Amsterdam" }, // slug literally ends ".com"
  { slug: "cradlebio",       name: "Cradle",          country: "NL", city: "Amsterdam" },
  { slug: "synthesia",       name: "Synthesia",       country: null, city: null },
  { slug: "elevenlabs",      name: "ElevenLabs",      country: null, city: null },
  { slug: "hyperexponential", name: "hyperexponential", country: null, city: null },
  { slug: "n8n",             name: "n8n",             country: null, city: null },
  { slug: "causaly",         name: "Causaly",         country: null, city: null },
  { slug: "photoroom",       name: "PhotoRoom",       country: null, city: null },
  { slug: "fundamental",     name: "Fundamental",     country: null, city: null },
  { slug: "poolside",        name: "Poolside",        country: null, city: null },
  { slug: "reedsy",          name: "Reedsy",          country: null, city: null },
  { slug: "dust",            name: "Dust",            country: null, city: null },
  { slug: "nabla",           name: "Nabla",           country: null, city: null },
  { slug: "granola",         name: "Granola",         country: null, city: null },
];

// Map a free-text location to one of the countries we surface; null otherwise.
function detectCountry(text) {
  const t = (text || "").toLowerCase();
  if (/netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven|the hague/.test(t)) return "NL";
  if (/belgium|brussels|ghent|gent|antwerp|leuven/.test(t)) return "BE";
  if (/luxembourg/.test(t)) return "LU";
  if (/united kingdom|england|london|manchester|\buk\b|scotland|cardiff/.test(t)) return "GB";
  if (/germany|deutschland|berlin|munich|münchen|munchen|hamburg|frankfurt/.test(t)) return "DE";
  if (/france|paris|lyon/.test(t)) return "FR";
  if (/spain|españa|madrid|barcelona/.test(t)) return "ES";
  if (/italy|italia|milan|rome/.test(t)) return "IT";
  if (/austria|vienna|wien/.test(t)) return "AT";
  if (/poland|warsaw|krak/.test(t)) return "PL";
  return null;
}

export async function collectAshby(source) {
  const jobs = [];

  for (const company of COMPANIES) {
    try {
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`,
        {
          headers: {
            "User-Agent": "design-product-job-scout/1.0 (personal research tool)",
            Accept: "application/json",
          },
        }
      );

      if (res.status === 404) continue;
      if (!res.ok) {
        console.log(`  Ashby/${company.slug}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const all = data.jobs || [];
      let added = 0;

      for (const j of all) {
        if (j.isListed === false) continue;
        if (!isTargetRoleTitle(j.title)) continue;

        const addr = j.address?.postalAddress || {};
        const locText = [
          j.location,
          ...(j.secondaryLocations || []).map((s) => s.location),
          addr.addressCountry,
          addr.addressLocality,
        ]
          .filter(Boolean)
          .join(", ");

        const remote =
          j.workplaceType === "Remote" || j.isRemote === true || /remote/i.test(j.location || "");
        const country = detectCountry(locText) || company.country;

        jobs.push({
          source_id: source.id,
          source_job_id: `${company.slug}/${j.id}`,
          title: (j.title || "").slice(0, 300),
          company: company.name,
          country,
          city: addr.addressLocality || null,
          location_raw: j.location || (remote ? "Remote" : null) || company.city || null,
          description: stripHtml(j.descriptionPlain || j.descriptionHtml || ""),
          apply_url: j.applyUrl || j.jobUrl || null,
          posted_at: j.publishedAt ? new Date(j.publishedAt) : null,
          raw_json: { id: j.id, _slug: company.slug },
          dedupe_hash: dedupeHash(j.title, company.name, country || ""),
        });
        added++;
      }

      console.log(`  Ashby/${company.slug}: ${added} relevant / ${all.length} total`);
    } catch (err) {
      console.error(`  Ashby/${company.slug}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`  Ashby: ${jobs.length} relevant jobs total`);
  return jobs;
}
