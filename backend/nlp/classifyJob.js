// Shared rule-based job classification. The single source of truth for the
// rule-based classification object, previously duplicated in routes/analyze.js
// and scripts/classify.js. Pure function: no DB, no API calls.
//
// Returns the base rule-based result. Callers that need persistence, evidence,
// classification_method, or LLM adjudication (scripts/classify.js) layer that
// on top of this object.
import { detectLanguage } from "./language.js";
import { classifyEmployment } from "./employment.js";
import { analyzeLanguageRequirements } from "./languageReq.js";
import { classifyRole } from "./role.js";
import { classifySeniority } from "./seniority.js";
import { classifyRemote } from "./remote.js";
import { detectPortfolioRequired } from "./portfolio.js";

// classifyJob(title, text) → base rule-based classification object.
// Also returns the raw sub-results under `_raw` so callers can reach extra
// fields (evidence, ambiguous snippets, confidences) without re-running the
// underlying NLP modules.
export function classifyJob(title, text) {
  const t = title || "";
  const body = text || "";

  const role = classifyRole(t, body);
  const employment = classifyEmployment(t, body);
  const seniority = classifySeniority(t, body);
  const langReq = analyzeLanguageRequirements(body);

  const classification = {
    job_post_language: detectLanguage(body),
    category: role.category,
    role_family: role.role_family,
    role_confidence: role.confidence,
    seniority: seniority.seniority,
    employment_type: employment.employment_type,
    employment_confidence: employment.confidence,
    remote_type: classifyRemote(t, body),
    portfolio_required: detectPortfolioRequired(body),
    required_languages: langReq.required_languages,
    optional_languages: langReq.optional_languages,
    language_blocker: langReq.language_blocker,
    language_match: langReq.language_match,
  };

  return { classification, _raw: { role, employment, seniority, langReq } };
}
