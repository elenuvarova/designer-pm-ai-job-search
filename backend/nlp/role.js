// Multilingual role-family classifier for Design & Product roles — rule-based, no API calls.
// Each family carries a top-level `category` (Design | Product) so the UI can offer a
// two-level Category → Discipline filter. Patterns include English + common local-language
// title variants for the larger European markets (NL / FR / DE / ES / IT).

const FAMILIES = [
  // ───────────────────────── Design ─────────────────────────
  {
    category: "Design",
    family: "Product Design",
    patterns: [
      /\bproduct\s*designer\b/i, /\bux\s*\/?\s*ui\s*designer\b/i, /\bui\s*\/?\s*ux\s*designer\b/i,
      /\bux\s*designer\b/i, /\bui\s*designer\b/i, /\buser\s*experience\s*designer\b/i,
      /\buser\s*interface\s*designer\b/i, /\binteraction\s*designer\b/i, /\bweb\s*designer\b/i,
      /\bdigital\s*designer\b/i, /\bapp\s*designer\b/i,
      // local variants
      /\bproduktdesigner(in)?\b/i, /\bdesigner\s*ux\b/i, /\bdiseñador[ae]?\s*(ux|de\s*producto)?\b/i,
      /\bdesigner\s*(de\s*)?produit\b/i, /\bproductontwerper\b/i,
    ],
  },
  {
    category: "Design",
    family: "UX Research",
    patterns: [
      /\bux\s*research(er)?\b/i, /\buser\s*research(er)?\b/i, /\bdesign\s*research(er)?\b/i,
      /\buser\s*experience\s*research(er)?\b/i, /\bnutzerforsch/i,
    ],
  },
  {
    category: "Design",
    family: "Graphic / Visual Design",
    patterns: [
      /\bgraphic\s*designer\b/i, /\bvisual\s*designer\b/i, /\bgrafik(er|designer)(in)?\b/i,
      /\bdiseñador[ae]?\s*gráfic[oa]\b/i, /\bgraphiste\b/i, /\bdesigner\s*gráfic[oa]\b/i,
      /\bgrafisch\s*ontwerper\b/i, /\bdigital\s*design(er)?\b.*\bvisual/i,
    ],
  },
  {
    category: "Design",
    family: "Brand / Art Direction",
    patterns: [
      /\bbrand\s*designer\b/i, /\bart\s*director\b/i, /\bbranding\s*designer\b/i,
      /\bdirecteur\s*artistique\b/i, /\bdirector[ae]?\s*de\s*arte\b/i, /\bcreative\s*director\b/i,
    ],
  },
  {
    category: "Design",
    family: "Motion / 3D / Illustration",
    patterns: [
      /\bmotion\s*(designer|graphics)\b/i, /\b3d\s*(designer|artist)\b/i, /\banimator\b/i,
      /\billustrator\b/i, /\billustrateur\b/i, /\bilustrador[ae]?\b/i, /\bmotion\s*artist\b/i,
    ],
  },
  {
    category: "Design",
    family: "Content Design / UX Writing",
    patterns: [
      /\bcontent\s*designer\b/i, /\bux\s*writer\b/i, /\bcontent\s*strategist\b.*\b(ux|product)\b/i,
      /\bredacteur\s*ux\b/i, /\bux\s*redaktion\b/i,
    ],
  },
  {
    category: "Design",
    family: "Design Systems",
    patterns: [
      /\bdesign\s*system(s)?\s*(designer|engineer|lead|manager)?\b/i, /\bdesign\s*ops\b/i,
      /\bdesign\s*operations\b/i,
    ],
  },
  {
    category: "Design",
    family: "Design Leadership",
    patterns: [
      /\bhead\s*of\s*design\b/i, /\bdesign\s*director\b/i, /\bdirector\s*of\s*design\b/i,
      /\bdesign\s*lead\b/i, /\blead\s*(product\s*|ux\s*|ui\s*)?designer\b/i, /\bdesign\s*manager\b/i,
      /\bvp\s*of\s*design\b/i, /\bprincipal\s*designer\b/i, /\bstaff\s*designer\b/i,
    ],
  },

  // ───────────────────────── Product ─────────────────────────
  {
    category: "Product",
    family: "Product Leadership",
    patterns: [
      /\bhead\s*of\s*product\b/i, /\bdirector\s*of\s*product\b/i, /\bproduct\s*director\b/i,
      /\bvp\s*of\s*product\b/i, /\bgroup\s*product\s*manager\b/i, /\bgroup\s*pm\b/i,
      /\bchief\s*product\s*officer\b/i, /\bcpo\b/i, /\bproduct\s*lead\b/i,
    ],
  },
  {
    category: "Product",
    family: "Growth / Technical Product",
    patterns: [
      /\bgrowth\s*(product\s*manager|pm)\b/i, /\btechnical\s*(product\s*manager|pm)\b/i,
      /\bplatform\s*(product\s*manager|pm)\b/i, /\bgrowth\s*product\b/i,
    ],
  },
  {
    category: "Product",
    family: "Product Owner",
    patterns: [
      /\bproduct\s*owner\b/i, /\bpo\b\s*\(?product\s*owner\)?/i, /\bproprietario\s*di\s*prodotto\b/i,
      /\bproduct\s*eigenaar\b/i,
    ],
  },
  {
    category: "Product",
    family: "Product Management",
    patterns: [
      /\bproduct\s*manager\b/i, /\bsenior\s*product\s*manager\b/i, /\bassociate\s*product\s*manager\b/i,
      /\bapm\b/i, /\bproduct\s*management\b/i,
      // local variants
      /\bproduktmanager(in)?\b/i, /\bchef\s*de\s*produit\b/i, /\bgestor[ae]?\s*de\s*producto\b/i,
      /\bresponsabile\s*di\s*prodotto\b/i, /\bproductmanager\b/i,
    ],
  },
];

// Title/tag keywords for the fast collector-side relevance gate. Broad on purpose:
// a single keyword in the title (or a source tag) is enough to keep the posting; the
// full classifier (classifyRole) refines it later. This is the SINGLE source of truth
// for "is this a design or product role" across every collector.
const TARGET_TITLE_RE = [
  /\bdesigner\b/i, /\bdesign\b/i, /\bux\b/i, /\bui\b/i, /\buser\s*experience\b/i,
  /\buser\s*interface\b/i, /\binteraction\b/i, /\bvisual\b/i, /\bgraphic\b/i, /\bbrand\b/i,
  /\bmotion\b/i, /\billustrat/i, /\bart\s*director\b/i, /\bcreative\b/i, /\bproduct\s*manager\b/i,
  /\bproduct\s*owner\b/i, /\bproduct\s*management\b/i, /\bproduct\s*lead\b/i, /\bhead\s*of\s*product\b/i,
  /\bproduct\s*designer\b/i, /\bresearcher\b/i, /\bcontent\s*designer\b/i, /\bux\s*writer\b/i,
  /\bpm\b/i, /\bcpo\b/i, /\bapm\b/i,
  // local-language stems
  /\bdesigner?\b/i, /\bgrafik/i, /\bgraphiste\b/i, /\bdiseñ/i, /\bontwerper\b/i, /\bproduktmanager/i,
  /\bchef\s*de\s*produit\b/i, /\bgestor[ae]?\s*de\s*producto\b/i,
];

// Negative guard: titles that contain a target keyword but clearly are not our roles.
// e.g. "Sales Manager", "Engineering Manager" should not match via a stray "manager".
const NEGATIVE_TITLE_RE = [
  /\bsoftware\s*engineer\b/i, /\bdata\s*(scientist|engineer|analyst)\b/i, /\bmachine\s*learning\b/i,
  /\bsales\b/i, /\baccount\s*manager\b/i, /\bproject\s*manager\b/i, /\bengineering\s*manager\b/i,
  /\bfrontend\s*(developer|engineer)\b/i, /\bbackend\s*(developer|engineer)\b/i,
];

export function classifyRole(title, description) {
  const text = `${title} ${(description || "").slice(0, 500)}`;

  for (const { category, family, patterns } of FAMILIES) {
    const hits = patterns.filter((p) => p.test(text));
    if (hits.length > 0) {
      const titleHit = patterns.some((p) => p.test(title));
      return {
        category,
        role_family: family,
        confidence: titleHit ? 0.92 : 0.72,
        evidence: hits.map((p) => p.toString()),
      };
    }
  }

  return { category: "Other", role_family: "Other / Unclear", confidence: 0.3, evidence: [] };
}

// Fast title/tag gate for collectors with a clean title field — keep only design/
// product roles, drop obvious non-matches via the negative guard.
export function isTargetRoleTitle(title, tags = []) {
  const hay = `${title || ""} ${(Array.isArray(tags) ? tags.join(" ") : tags || "")}`;
  if (!hay.trim()) return false;
  if (NEGATIVE_TITLE_RE.some((re) => re.test(title || ""))) return false;
  return TARGET_TITLE_RE.some((re) => re.test(hay));
}

// Unambiguous role phrases for FREE-TEXT contexts (e.g. an HN comment that lists several
// roles). Stricter than TARGET_TITLE_RE — no bare "design"/"ui"/"pm" — to avoid matching
// every post that happens to mention "system design". No negative guard: a post listing
// both "software engineer" and "product designer" should still be kept.
const STRONG_ROLE_RE = [
  /\b(product|ux|ui|visual|graphic|brand|motion|interaction|web|content|service)\s*designer\b/i,
  /\bdesigner\b/i, /\bdesign\s*(lead|manager|director|systems?)\b/i, /\bhead\s*of\s*design\b/i,
  /\b(ux|user|design)\s*research(er)?\b/i, /\bart\s*director\b/i, /\billustrator\b/i,
  /\bux\s*writer\b/i, /\bcontent\s*designer\b/i,
  /\bproduct\s*manager\b/i, /\bproduct\s*owner\b/i, /\bproduct\s*management\b/i,
  /\bproduct\s*lead\b/i, /\bhead\s*of\s*product\b/i, /\bgroup\s*pm\b/i,
];

export function mentionsTargetRole(text) {
  return STRONG_ROLE_RE.some((re) => re.test(text || ""));
}
