// Portfolio-requirement detector — a design-specific signal. Rule-based, no API calls.
// True when the posting asks the candidate to share a portfolio / case studies / work samples.

const PORTFOLIO_RE = [
  /\bportfolio\b/i,
  /\bcase\s*stud(y|ies)\b/i,
  /\b(behance|dribbble)\b/i,
  /\b(link|links?)\s*(to|of)\s*(your\s*)?(work|projects?)\b/i,
  /\bwork\s*samples?\b/i,
  /\bshow(case)?\s*(us\s*)?your\s*work\b/i,
  /\bportfolio\s*(is\s*)?(required|a\s*must|mandatory|essential)\b/i,
  /\bsend\s*(us\s*)?your\s*portfolio\b/i,
];

export function detectPortfolioRequired(description) {
  const text = description || "";
  return PORTFOLIO_RE.some((re) => re.test(text));
}
