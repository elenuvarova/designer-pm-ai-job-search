import { createHash } from "crypto";

export function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeHash(title, company, country) {
  // Keep unicode letters/numbers (\p{L}\p{N}) so Cyrillic/accented titles don't
  // collapse to an empty string and collide. Lowercase first; ASCII output is
  // unchanged from the old /[^a-z0-9]/ behaviour.
  const n = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const str = [n(title), n(company), (country || "").toUpperCase()].join("|");
  return createHash("sha1").update(str).digest("hex");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
