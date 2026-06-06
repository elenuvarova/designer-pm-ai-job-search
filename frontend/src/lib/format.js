// Shared display formatters. Single source of truth — do not re-define these
// per page (the copies used to drift).

// Concise relative time: "today", "yesterday", "3d ago", "2w ago", "5mo ago".
export function relativeTime(iso) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7)  return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export const CURRENCY = { EUR: "€", GBP: "£", PLN: "zł" };

export function formatSalary(min, max, currency) {
  if (!min && !max) return null;
  const sym = CURRENCY[currency] || "";
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : Math.round(n));
  if (min && max) return `${sym}${k(min)}–${k(max)}`;
  return `${sym}${k(min || max)}${min && !max ? "+" : ""}`;
}
