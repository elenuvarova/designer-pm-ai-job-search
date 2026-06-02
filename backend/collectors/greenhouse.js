import { stripHtml, dedupeHash, sleep } from "../nlp/normalize.js";
import { isTargetRoleTitle } from "../nlp/role.js";

// Curated European tech companies on Greenhouse ATS — they all hire designers / PMs.
// 404s are handled gracefully — add/remove tokens freely.
const COMPANIES = [
  // Belgium
  { token: "collibra",    name: "Collibra",    country: "BE", city: "Brussels" },
  { token: "showpad",     name: "Showpad",     country: "BE", city: "Ghent" },
  { token: "teamleader",  name: "Teamleader",  country: "BE", city: "Ghent" },
  { token: "datacamp",    name: "DataCamp",    country: "BE", city: "Brussels" },
  { token: "silverfin",   name: "Silverfin",   country: "BE", city: "Ghent" },
  // Netherlands
  { token: "adyen",       name: "Adyen",       country: "NL", city: "Amsterdam" },
  { token: "mollie",      name: "Mollie",      country: "NL", city: "Amsterdam" },
  { token: "catawiki",    name: "Catawiki",    country: "NL", city: "Amsterdam" },
  { token: "backbase",    name: "Backbase",    country: "NL", city: "Amsterdam" },
  { token: "bynder",      name: "Bynder",      country: "NL", city: "Amsterdam" },
  { token: "messagebird", name: "MessageBird", country: "NL", city: "Amsterdam" },
  { token: "picnic",      name: "Picnic",      country: "NL", city: "Amsterdam" },
  { token: "tomtom",      name: "TomTom",      country: "NL", city: "Amsterdam" },
  { token: "booking",     name: "Booking.com", country: "NL", city: "Amsterdam" },
  { token: "wetransfer",  name: "WeTransfer",  country: "NL", city: "Amsterdam" },
  { token: "elastic",     name: "Elastic",     country: "NL", city: "Amsterdam" },
  { token: "miro",        name: "Miro",        country: "NL", city: "Amsterdam" },
  { token: "bol",         name: "bol.com",     country: "NL", city: "Utrecht" },
  { token: "recruitee",   name: "Recruitee",   country: "NL", city: "Amsterdam" },
  // EU remote — strong ML/Data hiring, accessible from Benelux
  { token: "personio",    name: "Personio",    country: null, city: null },
  { token: "contentful",  name: "Contentful",  country: null, city: null },
  { token: "pleo",        name: "Pleo",        country: null, city: null },
  { token: "sumup",       name: "SumUp",       country: null, city: null },
  { token: "typeform",    name: "Typeform",    country: null, city: null },
  { token: "algolia",     name: "Algolia",     country: null, city: null },
  { token: "n26",         name: "N26",         country: null, city: null },
  { token: "klarna",      name: "Klarna",      country: null, city: null },
  { token: "zendesk",     name: "Zendesk",     country: null, city: null },
  { token: "datadog",     name: "Datadog",     country: null, city: null },
  // Added after live verification (all resolve 200, ML/Data roles confirmed)
  { token: "imc",          name: "IMC Trading",  country: "NL", city: "Amsterdam" }, // ML Eng roles in Amsterdam
  { token: "inthepocket",  name: "In The Pocket", country: "BE", city: "Ghent" },    // BE AI product studio
  { token: "databricks",   name: "Databricks",   country: null, city: null },        // Amsterdam office, many AI roles
  { token: "dataiku",      name: "Dataiku",      country: null, city: null },         // NL-listed Data Eng roles
  { token: "getyourguide", name: "GetYourGuide", country: null, city: null },         // pan-EU ML/Data
  { token: "hellofresh",   name: "HelloFresh",   country: null, city: null },         // pan-EU Data/ML
  { token: "helsing",      name: "Helsing",      country: null, city: null },         // EU-only AI research
  { token: "wolt",         name: "Wolt",         country: null, city: null },         // EU ML (lower volume)
  // EU / UK — strong AI/Data hiring, remote-friendly (verified live)
  { token: "celonis",      name: "Celonis",      country: null, city: null },         // process-mining AI, EU offices
  { token: "doctolib",     name: "Doctolib",     country: null, city: null },         // Paris/EU AI/Data
  { token: "gitlab",       name: "GitLab",       country: null, city: null },         // remote, EU-eligible
  { token: "monzo",        name: "Monzo",        country: null, city: null },         // UK-remote ML/DS
  { token: "gocardless",   name: "GoCardless",   country: null, city: null },         // London/Lisbon/Riga Data
  { token: "raisin",       name: "Raisin",       country: null, city: null },         // Berlin AI
  { token: "solarisbank",  name: "Solaris",      country: null, city: null },         // Berlin AI
  // Baltic-HQ tech — surfaces design/product roles in Tallinn / Riga / Vilnius
  { token: "veriff",       name: "Veriff",       country: "EE", city: "Tallinn" },
  { token: "lokalise",     name: "Lokalise",     country: "LV", city: "Riga" },
];

function parseCountry(locationName, fallback) {
  if (!locationName) return fallback;
  const l = locationName.toLowerCase();
  if (/netherlands|amsterdam|rotterdam|utrecht|eindhoven|delft|the hague/.test(l)) return "NL";
  if (/belgium|brussels|ghent|antwerp|leuven|bruges|liège/.test(l)) return "BE";
  if (/luxembourg/.test(l)) return "LU";
  if (/germany|deutschland|berlin|munich|münchen|hamburg|cologne|köln|frankfurt/.test(l)) return "DE";
  if (/france|paris|lyon|marseille|toulouse|bordeaux/.test(l)) return "FR";
  if (/spain|españa|madrid|barcelona|valencia/.test(l)) return "ES";
  if (/italy|italia|milan|milano|rome|roma|turin/.test(l)) return "IT";
  if (/austria|österreich|vienna|wien/.test(l)) return "AT";
  if (/poland|polska|warsaw|kraków|krakow/.test(l)) return "PL";
  if (/portugal|lisbon|lisboa|porto/.test(l)) return "PT";
  if (/ireland|dublin/.test(l)) return "IE";
  if (/sweden|stockholm/.test(l)) return "SE";
  if (/denmark|copenhagen|københavn/.test(l)) return "DK";
  if (/switzerland|schweiz|zurich|zürich|geneva/.test(l)) return "CH";
  if (/united kingdom|england|london|manchester|\buk\b/.test(l)) return "GB";
  return fallback;
}

export async function collectGreenhouse(source) {
  const jobs = [];

  for (const company of COMPANIES) {
    try {
      const url = `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs?content=true`;
      const res = await fetch(url, {
        headers: { "User-Agent": "design-product-job-scout/1.0 (personal research tool)" },
      });

      if (res.status === 404) {
        // Company not on Greenhouse — silent skip
        continue;
      }
      if (!res.ok) {
        console.log(`  Greenhouse/${company.token}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const allJobs = data.jobs || [];
      let added = 0;

      for (const job of allJobs) {
        if (!isTargetRoleTitle(job.title)) continue;

        const locationName = job.location?.name || null;
        const country = parseCountry(locationName, company.country);
        const city = locationName?.split(",")[0]?.trim() || company.city;

        jobs.push({
          source_id: source.id,
          source_job_id: `${company.token}/${job.id}`,
          title: job.title,
          company: company.name,
          country,
          city,
          location_raw: locationName || company.city || null,
          description: stripHtml(job.content || ""),
          apply_url: job.absolute_url || null,
          posted_at: job.updated_at ? new Date(job.updated_at) : null,
          raw_json: { id: job.id, _token: company.token },
          dedupe_hash: dedupeHash(job.title, company.name, country || ""),
        });
        added++;
      }

      console.log(`  Greenhouse/${company.token}: ${added} relevant / ${allJobs.length} total`);
    } catch (err) {
      console.error(`  Greenhouse/${company.token}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log(`  Greenhouse: ${jobs.length} relevant jobs total`);
  return jobs;
}
