// Gazetteer-based skill extractor for Design & Product roles — no API calls.
// Drives per-job skill tags, the Skill-Gap radar, and the CV tool-stack match.

const SKILL_DEFS = [
  // ── Design tools ──
  { skill: "Figma", re: /\bfigma\b/i },
  { skill: "FigJam", re: /\bfigjam\b/i },
  { skill: "Sketch", re: /\bsketch\b/i },
  { skill: "Adobe XD", re: /\b(adobe\s*)?xd\b/i },
  { skill: "Photoshop", re: /\bphotoshop\b/i },
  { skill: "Illustrator", re: /\billustrator\b/i },
  { skill: "InDesign", re: /\bindesign\b/i },
  { skill: "After Effects", re: /\bafter\s*effects\b/i },
  { skill: "Adobe Creative Suite", re: /\b(adobe\s*)?(creative\s*(suite|cloud)|creative\s*cc)\b/i },
  { skill: "Framer", re: /\bframer\b/i },
  { skill: "Webflow", re: /\bwebflow\b/i },
  { skill: "Principle", re: /\bprinciple\b.*\b(prototyp|animat)/i },
  { skill: "ProtoPie", re: /\bprotopie\b/i },
  { skill: "InVision", re: /\binvision\b/i },
  { skill: "Zeplin", re: /\bzeplin\b/i },
  { skill: "Miro", re: /\bmiro\b/i },
  { skill: "Maze", re: /\bmaze\b/i },
  { skill: "Adobe", re: /\badobe\b/i },

  // ── Design craft / methods ──
  { skill: "Prototyping", re: /\bprototyp(e|ing|es)\b/i },
  { skill: "Wireframing", re: /\bwireframe?(s|ing)?\b/i },
  { skill: "Design Systems", re: /\bdesign\s*system(s)?\b/i },
  { skill: "Design Tokens", re: /\bdesign\s*tokens?\b/i },
  { skill: "User Research", re: /\buser\s*research\b|\bux\s*research\b/i },
  { skill: "Usability Testing", re: /\busability\s*test/i },
  { skill: "Interaction Design", re: /\binteraction\s*design\b/i },
  { skill: "Information Architecture", re: /\binformation\s*architecture\b/i },
  { skill: "Accessibility", re: /\baccessibility\b|\bwcag\b|\ba11y\b/i },
  { skill: "Design Thinking", re: /\bdesign\s*thinking\b/i },
  { skill: "Service Design", re: /\bservice\s*design\b/i },
  { skill: "Motion Design", re: /\bmotion\s*(design|graphics)\b/i },
  { skill: "Branding", re: /\bbrand(ing)?\b/i },
  { skill: "Typography", re: /\btypography\b/i },
  { skill: "HTML/CSS", re: /\bhtml\b|\bcss\b/i },

  // ── Product tools ──
  { skill: "Jira", re: /\bjira\b/i },
  { skill: "Confluence", re: /\bconfluence\b/i },
  { skill: "Linear", re: /\blinear\b.*\b(issue|product|roadmap)/i },
  { skill: "Productboard", re: /\bproductboard\b/i },
  { skill: "Aha!", re: /\baha!?\b.*\b(roadmap|product)/i },
  { skill: "Notion", re: /\bnotion\b/i },
  { skill: "Asana", re: /\basana\b/i },
  { skill: "Trello", re: /\btrello\b/i },

  // ── Product analytics ──
  { skill: "Amplitude", re: /\bamplitude\b/i },
  { skill: "Mixpanel", re: /\bmixpanel\b/i },
  { skill: "Pendo", re: /\bpendo\b/i },
  { skill: "Google Analytics", re: /\bgoogle\s*analytics\b|\bga4\b/i },
  { skill: "Hotjar", re: /\bhotjar\b/i },
  { skill: "SQL", re: /\bsql\b/i },

  // ── Product craft / methods ──
  { skill: "Roadmapping", re: /\broadmap(ping|s)?\b/i },
  { skill: "A/B Testing", re: /\ba\/b\s*test|\bexperimentation\b|\bsplit\s*test/i },
  { skill: "Agile", re: /\bagile\b/i },
  { skill: "Scrum", re: /\bscrum\b/i },
  { skill: "Kanban", re: /\bkanban\b/i },
  { skill: "OKRs", re: /\bokrs?\b/i },
  { skill: "User Stories", re: /\buser\s*stor(y|ies)\b/i },
  { skill: "Product Discovery", re: /\bproduct\s*discovery\b/i },
  { skill: "Stakeholder Management", re: /\bstakeholder\s*(management|engagement)\b/i },
  { skill: "Go-to-Market", re: /\bgo[\s-]?to[\s-]?market\b|\bgtm\b/i },
  { skill: "Product Strategy", re: /\bproduct\s*strategy\b/i },
];

export function extractSkills(description) {
  const text = description || "";
  return SKILL_DEFS
    .filter(({ re }) => re.test(text))
    .map(({ skill }) => ({ skill, confidence: 0.9 }));
}
