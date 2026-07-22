/**
 * Shared helpers for evidence-card ↔ LLM summary alignment across quick actions and slash commands.
 */

export function appendCitationKeysSection(lines: string[], citationKeys: string[]): void {
  if (citationKeys.length === 0) {
    return;
  }
  lines.push("## Citation keys (use exactly in **Sources**; at most 1-2 may appear inline in **Summary**)");
  for (const key of citationKeys) {
    lines.push(`- ${key}`);
  }
  lines.push("");
}

export function appendSourcesChecklistSection(lines: string[], checklist: string[]): void {
  if (checklist.length === 0) {
    return;
  }
  lines.push("## Required **Sources** bullets (prioritize up to 3 in your **Sources** section — full detail lives in the Sources card)");
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
  for (const extra of extraLines) {
    const matchedKey = citationKeys.find((key) => extra.startsWith(key));
    if (matchedKey) {
      const idx = lines.findIndex((line) => line.startsWith(matchedKey));
      if (idx >= 0) {
        lines[idx] = extra;
        continue;
      }
    }
    lines.push(extra);
  }
  return lines;
}

export const NARRATIVE_CITATION_RULES = `Narrative citation rules:
- Reserve \`[Sources: …]\` labels for the **Sources** footer only.
- In **Summary**, you may include at most 1-2 inline \`[Sources: …]\` citations for the strongest evidence — no more.
- In all other narrative sections (**Architecture**, **Technical decision**, **Direct impact**, **Alternatives considered**, etc.), do **not** use \`[Sources: …]\` labels — describe evidence in plain language (file paths, PR numbers, ticket keys, channel names).
- Never cite a \`[Sources: …]\` label in narrative when that source is absent from the required **Sources** checklist.`;

export function appendEvidenceQualityInstructions(lines: string[]): void {
  lines.push("## Evidence quality");
  lines.push("- Lead **Summary** with what can be responsibly concluded from the attached bundle.");
  lines.push("- State evidence strength (strong / medium / weak / limited) and lower confidence when evidence is thin.");
  lines.push("- Call out missing PR, issue, discussion, or documentation when not present in the bundle.");
  lines.push("- Distinguish provenance (direct source facts) from rationale (your synthesis).");
  lines.push("- When evidence is thin, use one line per section — do not pad with generic software trade-offs.");
  lines.push("");
}

export function appendNarrativeCitationInstructions(lines: string[]): void {
  lines.push("## Narrative citation rules");
  lines.push("- Do **not** use \`[Sources: …]\` labels in narrative sections — reserve them for the **Sources** footer.");
  lines.push("- **Summary** may include at most 1-2 inline \`[Sources: …]\` citations; all other sections use plain language.");
  lines.push("- Never cite a source label in narrative when that label is absent from the required **Sources** checklist.");
  lines.push("");
}

export function sourcesChecklistIncludes(checklist: string[], citationKey: string): boolean {
  return checklist.some((item) => item.startsWith(citationKey));
}

export function supplementaryKeysOmittedFromChecklist(
  citationKeys: string[],
  checklist: string[]
): string[] {
  return citationKeys.filter((key) => !sourcesChecklistIncludes(checklist, key));
}

/** Warn when narrative sections must not cite supplementary card sources omitted from the checklist. */
export function appendSupplementarySourceCitationGuardrails(
  lines: string[],
  checklist: string[],
  supplementaryCitationKeys: string[]
): void {
  const omitted = [
    ...new Set([
      ...supplementaryCitationKeys,
      ...supplementaryKeysOmittedFromChecklist(supplementaryCitationKeys, checklist)
    ])
  ].filter((key) => !sourcesChecklistIncludes(checklist, key));

  if (omitted.length === 0) {
    return;
  }
  lines.push("## Citation guardrails");
  lines.push(
    "- The labels below appear in the evidence card or citation keys but are **absent** from the required **Sources** checklist — do **not** cite them anywhere in your response (including **Summary**)."
  );
  lines.push(
    "- Describe any relevant facts from these sources in plain language without \`[Sources: …]\` pills, or omit them when they do not change your answer."
  );
  for (const key of omitted) {
    lines.push(`- Omit \`${key}\` everywhere outside the **Sources** checklist (it is not a required checklist item).`);
  }
  lines.push("");
}

const SOURCE_CITATION_TOKEN_RE = /\[Sources:[^\]]+\]/g;
const SECTION_HEADER_RE = /^\*\*([^*]+)\*\*\s*$/;

export function extractCitationKeysFromSourcesSection(content: string): string[] {
  const match = content.match(/\*\*Sources\*\*/i);
  if (!match || match.index === undefined) {
    return [];
  }
  const keys: string[] = [];
  for (const token of content.slice(match.index).matchAll(SOURCE_CITATION_TOKEN_RE)) {
    if (!keys.includes(token[0])) {
      keys.push(token[0]);
    }
  }
  return keys;
}

function citationAllowedInNarrative(citation: string, allowedKeys: string[]): boolean {
  return allowedKeys.some((key) => sourcesChecklistIncludes([`${key} — x`], citation));
}

/** Post-process: remove narrative `[Sources: …]` pills absent from the allowed checklist. */
export function stripDisallowedNarrativeSourceCitations(
  content: string,
  options?: { allowedCitationKeys?: string[]; maxSummaryCitations?: number }
): string {
  const allowedKeys =
    options?.allowedCitationKeys?.length
      ? options.allowedCitationKeys
      : extractCitationKeysFromSourcesSection(content);
  if (allowedKeys.length === 0) {
    return content;
  }

  const maxSummaryCitations = options?.maxSummaryCitations ?? 2;
  const lines = content.split("\n");
  const out: string[] = [];
  let currentSection: string | undefined;
  let summaryCitationCount = 0;

  for (const line of lines) {
    const headerMatch = line.match(SECTION_HEADER_RE);
    if (headerMatch) {
      currentSection = headerMatch[1].trim().toLowerCase();
      out.push(line);
      continue;
    }

    if (currentSection === "sources" || !SOURCE_CITATION_TOKEN_RE.test(line)) {
      out.push(line);
      continue;
    }

    const isSummary = currentSection === "summary";
    let processed = line.replace(SOURCE_CITATION_TOKEN_RE, (citation) => {
      if (!citationAllowedInNarrative(citation, allowedKeys)) {
        return "";
      }
      if (isSummary) {
        summaryCitationCount += 1;
        if (summaryCitationCount > maxSummaryCitations) {
          return "";
        }
      } else {
        return "";
      }
      return citation;
    });
    processed = processed.replace(/ {2,}/g, " ").replace(/ ([.,;:])/g, "$1").trimEnd();
    out.push(processed);
  }

  return out.join("\n");
}

/**
 * Enrichment guidance is only useful when the bundle actually carries an enriched
 * field (targetLabel/introducingDiffSummary/evolution/rationaleRanking/pathEvolution),
 * so callers thread a `hasEnrichment` flag to keep the prompt lean otherwise.
 */
export function appendEvidenceEnrichmentInstructions(lines: string[], hasEnrichment: boolean): void {
  if (!hasEnrichment) {
    return;
  }
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
${NARRATIVE_CITATION_RULES}
- Format each **Sources** bullet as: \`[Sources: …] — one sentence on what that source contributed\` (plain text labels — not links).
- The Sources evidence card lists every file, page, and integration hit — do not repeat full lists in **Sources** bullets.
- Align quality and confidence statements with each source's contribution and the Sources card the user sees.
- Do not cite evidence that is not in the attached bundle.
Never invent URLs, ticket IDs, PR numbers, people, or quotes not present in the evidence.`;

/** Shared **Sources** footer contract for quick-action system prompts. */
export const SOURCES_FOOTER_OUTPUT_RULE = `Include **at most 3 bullets** — one sentence each on what the highest-priority sources contributed (commits, PRs, Jira, Slack/Teams, then scans/dependencies; group multiple doc pages into one bullet). Use plain \`[Sources: …]\` text labels. Full detail is in the Sources evidence card.`;

/** Shared truncation marker appended after a `.slice(0, shown)` list so the model knows rows were omitted. */
export function truncationNote(total: number, shown: number): string {
  return total > shown ? `\n- …and ${total - shown} more (omitted)` : "";
}
