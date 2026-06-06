import { dedupeHash } from "../nlp/normalize.js";
import { mentionsTargetRole } from "../nlp/role.js";

const ALGOLIA = "https://hn.algolia.com/api/v1";

const EUROPE_PATTERNS = [
  /\b(europe|eu\b|emea|worldwide|global|anywhere)\b/i,
  /\b(amsterdam|netherlands|berlin|london|paris|brussels|belgium|zurich|remote)\b/i,
  /\b(nl|be|de|fr|uk|ch|es|pt|lu|se|no|dk|fi|at|pl|cz)\b/,
];

const US_ONLY = [
  /usa.?only/i, /us.?only/i,
  /onsite.{0,20}(new york|san francisco|seattle|austin|chicago)/i,
];

function isEuropeOk(text) {
  if (US_ONLY.some((p) => p.test(text))) return false;
  return EUROPE_PATTERNS.some((p) => p.test(text));
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s<>"]+/);
  return m ? m[0].replace(/[.,;)>]+$/, "") : null;
}

function cleanComment(html) {
  return (html || "")
    .replace(/<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseComment(text) {
  // HN format: "CompanyName | Location | Remote | Role Description"
  const firstLine = text.split("\n")[0] || "";
  const segments = firstLine.split("|").map((s) => s.trim());

  const company = (segments[0] || "")
    .replace(/\(.+?\)/g, "")
    .trim()
    .slice(0, 100) || "Unknown";

  // Pick the segment most likely to be a role title
  const roleSeg = segments.slice(1).find((s) => mentionsTargetRole(s));
  const title = (roleSeg || firstLine).slice(0, 150);

  return { company, title };
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "design-product-job-scout/1.0 (personal research tool)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

async function getLatestThreadId() {
  // Search by date (newest first) restricted to the whoishiring account, then take the
  // most recent "Who is hiring?" thread — excluding the sibling "Who wants to be hired?".
  // (Relevance search would happily match a years-old "...hiring right now?" thread.)
  const data = await get(
    `${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`
  );
  const hit = (data.hits || []).find(
    (h) =>
      /who is hiring/i.test(h.title || "") &&
      !/wants to be hired/i.test(h.title || "")
  );
  return hit?.objectID || null;
}

export async function collectHnHiring(source) {
  const jobs = [];

  try {
    const storyId = await getLatestThreadId();
    if (!storyId) {
      console.log("  HN Hiring: latest thread not found");
      return [];
    }

    console.log(`  HN Hiring: story ${storyId}`);

    // Fetch top-level comments via Algolia (200 per page, up to 1 000 total)
    const allComments = [];
    for (let page = 0; page < 5; page++) {
      const data = await get(
        `${ALGOLIA}/search_by_date?tags=comment,story_${storyId}&hitsPerPage=200&page=${page}`
      );
      const hits = data.hits || [];
      // Keep only direct replies to the story (top-level job posts)
      const topLevel = hits.filter((h) => String(h.parent_id) === String(storyId));
      allComments.push(...topLevel);
      if (hits.length < 200) break; // last page
    }

    console.log(`  HN Hiring: ${allComments.length} top-level comments`);

    for (const comment of allComments) {
      const text = cleanComment(comment.comment_text || "");
      if (text.length < 50) continue;
      if (!mentionsTargetRole(text)) continue;
      if (!isEuropeOk(text)) continue;

      const { company, title } = parseComment(text);
      const applyUrl =
        extractUrl(text) || `https://news.ycombinator.com/item?id=${comment.objectID}`;

      jobs.push({
        source_id: source.id,
        source_job_id: comment.objectID,
        title,
        company,
        country: null,
        city: null,
        location_raw: "Remote / See description",
        description: text.slice(0, 5000),
        apply_url: applyUrl,
        posted_at: comment.created_at ? new Date(comment.created_at) : null,
        raw_json: { objectID: comment.objectID, author: comment.author },
        // HN jobs store country:null and are remote, so use the "REMOTE" region
        // constant (like greenhouse/remoteok) for cross-source dedup — not the
        // per-comment objectID, which would make every row unique and defeat it.
        dedupe_hash: dedupeHash(title, company, "REMOTE"),
      });
    }

    console.log(`  HN Hiring: ${jobs.length} Europe-relevant design/product jobs`);
  } catch (err) {
    console.error(`  HN Hiring: ${err.message}`);
  }

  return jobs;
}
