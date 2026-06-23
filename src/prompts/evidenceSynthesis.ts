/**
 * Shared helpers for evidence-card ↔ LLM summary alignment across quick actions and slash commands.
 */

export function appendCitationKeysSection(lines: string[], citationKeys: string[]): void {
  if (citationKeys.length === 0) {
    return;
  }
  lines.push("## Citation keys (use exactly in prose and **Sources**)");
  for (const key of citationKeys) {
    lines.push(`- ${key}`);
  }
  lines.push("");
}

export function appendSourcesChecklistSection(lines: string[], checklist: string[]): void {
  if (checklist.length === 0) {
    return;
  }
  lines.push("## Required **Sources** bullets (include every line below in your **Sources** section)");
  for (const item of checklist) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

export function buildSourcesChecklistFromKeys(
  citationKeys: string[],
  extraLines: string[] = []
): string[] {
  const lines = citationKeys.map(
    (label) => `${label} — summarize what this source contributed to your answer`
  );
  return [...lines, ...extraLines];
}

export const EVIDENCE_QUALITY_RULES = `Evidence quality rules:
- In **Summary**, state overall evidence strength using one of: strong, medium, weak, or limited.
- Distinguish provenance (what a source directly shows) from rationale (your inference or synthesis).
- Name missing evidence explicitly when the bundle lacks PRs, issues, discussions, or documentation.
- When evidence is limited or weak, keep each section to one short line; omit sections with nothing to say (always keep **Summary** and **Sources**).
- Never list hypothetical trade-offs or rejected alternatives (e.g. performance vs simplicity, libraries vs custom) unless a source explicitly discusses them.
- Do not repeat the same \`[Sources: …]\` label in every sentence — cite where it supports a claim.
- Keep strength and confidence aligned with the Sources card sections the user sees.`;

export function appendEvidenceQualityInstructions(lines: string[]): void {
  lines.push("## Evidence quality");
  lines.push("- Lead **Summary** with what can be responsibly concluded from the attached bundle.");
  lines.push("- State evidence strength (strong / medium / weak / limited) and lower confidence when evidence is thin.");
  lines.push("- Call out missing PR, issue, discussion, or documentation when not present in the bundle.");
  lines.push("- Match each \`[Sources: …]\` citation key to that source's contribution in your **Sources** bullets.");
  lines.push("- Distinguish provenance (direct source facts) from rationale (your synthesis).");
  lines.push("- When evidence is thin, use one line per section — do not pad with generic software trade-offs.");
  lines.push("- Do not over-cite the same source ID; spread citations across sections as needed.");
  lines.push("");
}

export const EVIDENCE_ENRICHMENT_RULES = `Evidence enrichment rules:
- When \`targetLabel\` is present, use it for precise target identification in **Summary** instead of inferring scope from the file path alone.
- When \`introducingDiffSummary\` is present, use its summary (and change stats) in **Technical decision** or **Business context** to explain what the introducing change actually did.
- When \`evolution\` includes \`commitCountSinceIntroduction\`, mention file activity since introduction in **Summary** (e.g. commit count, last modifier).
- When \`rationaleRanking\` is present, call out the primary \`rationale\` source in **Summary** and weight narrative sections by rationale vs provenance vs background roles.
- When \`pathEvolution\` is present (ownership), note recent commit activity and the last modifier when assessing who to contact today.`;

export function appendEvidenceEnrichmentInstructions(lines: string[]): void {
  lines.push("## Evidence enrichment");
  lines.push("- When the bundle includes a precise `targetLabel`, cite that label in **Summary**.");
  lines.push("- When `introducingDiffSummary` is present, use its summary to describe what the introducing commit changed.");
  lines.push(
    "- When `evolution.commitCountSinceIntroduction` is present, mention file activity since introduction in **Summary**."
  );
  lines.push(
    "- When `rationaleRanking` is present, name the primary rationale source in **Summary** and weight sections by rationale vs provenance roles."
  );
  lines.push(
    "- When `pathEvolution` is present, mention recent path activity and last modifier when assessing current ownership."
  );
  lines.push("");
}

/** Slim evidence rules for general chat (static system prompt). */
export const GENERAL_CHAT_EVIDENCE_RULES = `Evidence rules (when a context bundle or integration blocks are attached):
- Cite concrete file paths and source identifiers from the attachment — do not invent paths, URLs, ticket keys, or PR numbers.
- State evidence strength using one of: strong, medium, weak, or limited when drawing conclusions from attached evidence.
- When integration blocks show <empty>, say clearly that the search found nothing — do not speculate about tickets, messages, or pages that are not attached.
- Weight sources by reliability for decisions: pull requests and commit history > Jira tickets > Confluence/docs > Slack/Teams discussions. Prefer the higher-trust source when they conflict.
- Never invent ticket IDs, PR numbers, people, or quotes not present in the evidence.`;

export const EVIDENCE_CITATION_RULES = `Citation rules:
- Include at least one \`[Sources: …]\` citation in **Summary** and the primary analysis section for this use case.
- Every factual claim in other sections should cite the matching \`[Sources: …]\` label when possible.
- In **Sources**, include one bullet for every line in the required checklist (attached). Do not omit checklist items. Do not add bullets for failed fetches, warnings, or integrations that returned no results.
- Format each **Sources** bullet as: \`[Sources: …] — one sentence on what that source contributed\`.
- Align quality and confidence statements with each source's contribution and the Sources card the user sees.
- Do not cite evidence that is not in the attached bundle.
Never invent URLs, ticket IDs, PR numbers, people, or quotes not present in the evidence.`;
