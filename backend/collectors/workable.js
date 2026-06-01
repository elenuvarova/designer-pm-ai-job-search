import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Curated companies on Workable ATS (zero-auth widget endpoint).
// GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
// → { name, jobs: [...] }. Many Workable boards resolve with 0 live jobs, so
// this list is short and high-signal; country comes from locations[].countryCode.
const COMPANIES = [
  { slug: "huggingface", name: "Hugging Face", country: null, city: null },
  { slug: "and-digital", name: "AND Digital",  country: null, city: null }, // UK + Amsterdam
  { slug: "mlabs",       name: "MLabs",        country: null, city: null }, // Europe-remote
];

const OUR_COUNTRIES = [
  "NL", "BE", "LU", "GB", "DE", "FR", "ES", "IT", "AT", "PL", "PT", "IE", "SE", "DK",
  "NO", "FI", "CH", "CZ", "RO", "GR", "HU",
];

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

// Prefer the clean ISO countryCode from locations[]; fall back to text detection.
function pickCountry(job) {
  const codes = (job.locations || []).map((l) => (l.countryCode || "").toUpperCase());
  const hit = OUR_COUNTRIES.find((c) => codes.includes(c));
  return hit || detectCountry(`${job.country || ""} ${job.city || ""}`);
}

export async function collectWorkable(source) {
  const jobs = [];

  for (const company of COMPANIES) {
    try {
      const res = await fetch(
        `https://apply.workable.com/api/v1/widget/accounts/${company.slug}?details=true`,
        {
          headers: {
            "User-Agent": "design-product-job-scout/1.0 (personal research tool)",
            Accept: "application/json",
          },
        }
      );

      if (res.status === 404) continue;
      if (!res.ok) {
        console.log(`  Workable/${company.slug}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const all = data.jobs || [];
      let added = 0;

      for (const j of all) {
        if (!isTargetRoleTitle(j.title)) continue;

        const country = pickCountry(j) || company.country;
        const locParts = [j.city, j.country].filter(Boolean);

        jobs.push({
          source_id: source.id,
          source_job_id: j.shortcode,
          title: (j.title || "").slice(0, 300),
          company: company.name,
          country,
          city: j.city || null,
          location_raw: locParts.length ? locParts.join(", ") : j.telecommuting ? "Remote" : null,
          description: stripHtml(j.description || ""),
          apply_url: j.application_url || j.url || null,
          posted_at: j.published_on ? new Date(j.published_on) : null,
          raw_json: { shortcode: j.shortcode, _slug: company.slug },
          dedupe_hash: dedupeHash(j.title, company.name, country || ""),
        });
        added++;
      }

      console.log(`  Workable/${company.slug}: ${added} relevant / ${all.length} total`);
    } catch (err) {
      console.error(`  Workable/${company.slug}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`  Workable: ${jobs.length} relevant jobs total`);
  return jobs;
}
