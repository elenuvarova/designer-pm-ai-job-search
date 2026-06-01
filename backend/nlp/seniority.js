// Grade / seniority classifier — rule-based, design & product titles.
const PATTERNS = [
  { level: "intern", re: /\b(intern|internship|stage|stagiaire|praktikum|werkstudent|trainee)\b/i },
  { level: "junior", re: /\b(junior|jr\.?|entry[\s-]?level|0[-–]2\s*year|graduate|associate)\b/i },
  { level: "senior", re: /\b(senior|sr\.?|principal|staff|expert|lead\s+designer|experienced)\b/i },
  // NB: bare "manager" is intentionally excluded — "Product Manager" is a role, not a
  // grade. Only people-management titles (design/engineering/group manager) count as lead.
  { level: "lead", re: /\b(lead|team\s+lead|design\s+lead|product\s+lead|head\s+of|director|vp\s+of|chief|(design|engineering|group)\s+manager|group\s+(product\s+)?manager)\b/i },
];

const MID_RE = /\b(medior|mid[-\s]?level|mid[-\s]?senior|intermediate|(\d+)[\+\-–]\s*years?\s*(of\s*)?experience)\b/i;

export function classifySeniority(title, description) {
  const text = `${title} ${(description || "").slice(0, 300)}`;

  // lead and senior first (highest specificity)
  for (const { level, re } of PATTERNS.slice().reverse()) {
    if (re.test(text)) return { seniority: level, evidence: re.toString() };
  }

  if (MID_RE.test(text)) return { seniority: "mid", evidence: MID_RE.toString() };

  return { seniority: "unknown", evidence: null };
}
