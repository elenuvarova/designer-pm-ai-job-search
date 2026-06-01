// Region gate for REMOTE job feeds. EU/UK is the home market (collected fully elsewhere);
// for remote roles we additionally keep the USA and Asia, plus worldwide/anywhere and
// unspecified (= remote-from-anywhere). We drop only roles restricted to a single
// non-target region (Canada / LatAm / Australia / NZ / Africa only).
const DENY_ONLY =
  /\b(canada|latam|latin america|brazil|argentina|mexico|australia|new zealand|africa|nigeria|south africa)[\s-]?only\b/i;

const TARGET =
  /\b(europe|emea|eu|uk|united kingdom|worldwide|global|anywhere|us|usa|united states|america|north america|asia|apac|india|singapore|japan|hong kong|philippines|indonesia|vietnam|malaysia|thailand|netherlands|belgium|germany|france|spain|italy|poland|portugal|ireland|nordics)\b/i;

export function remoteRegionAllowed(location) {
  const loc = (location || "").trim();
  if (!loc) return true;            // unspecified → remote-anywhere, keep
  if (DENY_ONLY.test(loc)) return false;
  if (TARGET.test(loc)) return true;
  return true;                      // remote feeds are broadly remote — default keep
}
