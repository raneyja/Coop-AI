/** Top-level section titles (H1). Subsection topic titles beneath these render as H2. */
export const COOP_MAIN_SECTIONS = new Set([
  "summary",
  "answer",
  "documentation gaps",
  "open questions",
  "key unknowns",
  "ownership & maintenance",
  "integration & operations",
  "recommended next steps",
  "architecture",
  "key subsystems",
  "entry points",
  "risks & unknowns",
  "suggested next steps",
  "business context",
  "technical decision",
  "alternatives considered",
  "trade-offs",
  "known limitations",
  "domain experts",
  "sources",
  "true experts",
  "availability",
  "risks",
  "escalation path",
  "knowledge transfer",
  "recommended next step",
  "direct impact",
  "transitive dependents",
  "apis & integrations",
  "operational risk",
  "testing surfaces"
]);

export function isCoopMainSection(text: string): boolean {
  return COOP_MAIN_SECTIONS.has(text.trim().toLowerCase());
}
