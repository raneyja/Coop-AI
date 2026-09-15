/**
 * Shared helpers for evidence-card ↔ LLM summary alignment across quick actions and slash commands.
 */

export function appendCitationKeysSection(lines: string[], citationKeys: string[]): void {
  if (citationKeys.length === 0) {
    return;
  }
  lines.push("## Citation keys (optional inline only — do not add a **Sources** footer; at most 1-2 labels in the opening)");
  for (const key of citationKeys) {
    lines.push(`- ${key}`);
  }
  lines.push("");
}

export function appendSourcesChecklistSection(lines: string[], checklist: string[]): void {
  if (checklist.length === 0) {
    return;
  }
  lines.push("## Source labels (inline only — no **Sources** footer; full detail lives in the Sources card)");
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
- Do not emit a **Sources** section. The Sources evidence card already lists files.
- You may include at most 1-2 inline \`[Sources: …]\` citations in the opening for the strongest evidence — no more.
- In topic sections (**Architecture**, **Technical decision**, **Direct impact**, **Alternatives considered**, etc.), describe evidence in plain language (file paths, PR numbers, ticket keys, channel names).
- Never cite a \`[Sources: …]\` label when that source is absent from the attached source-label list.`;

/** Writer-facing heading for attached facts. Never “Evidence bundle”. */
export const ATTACHED_FACTS_HEADING = "## What we found";

export function appendEvidenceQualityInstructions(lines: string[]): void {
  lines.push("## Grounding");
  lines.push("- Answer only from attached facts.");
  lines.push("- Distinguish what the sources say from your inference.");
  lines.push("- Call out missing PR, issue, discussion, or documentation when not present.");
  lines.push("- When evidence is thin, use one line per section — do not pad with generic software trade-offs.");
  lines.push("");
}

export function appendNarrativeCitationInstructions(lines: string[]): void {
  lines.push("## Narrative citation rules");
  lines.push("- Do **not** emit a **Sources** footer. At most 1–2 inline \`[Sources: …]\` labels in the opening.");
  lines.push("- Topic sections use plain language (paths, PR numbers, ticket keys).");
  lines.push("- Never cite a source label when that label is absent from the attached source-label list.");
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
    "- The labels below appear in the evidence card or citation keys but are **absent** from the attached source-label list — do **not** cite them anywhere in your response."
  );
  lines.push(
    "- Describe any relevant facts from these sources in plain language without \`[Sources: …]\` pills, or omit them when they do not change your answer."
  );
  for (const key of omitted) {
    lines.push(`- Omit \`${key}\` (it is not on the attached source-label list).`);
  }
  lines.push("");
}

const SOURCE_CITATION_TOKEN_RE = /\[Sources:[^\]]+\]/g;
const SECTION_HEADER_RE = /^\*\*([^*]+)\*\*\s*$/;
const TEMPLATE_SECTION_HEADING_RE = /^\s*\*\*(?:Answer|Summary|Your question)\*\*\s*$/gim;

/** Drop leftover report-template titles so the lead reads as Cursor-style prose. */
export function stripTemplateSectionHeadings(content: string): string {
  return content.replace(TEMPLATE_SECTION_HEADING_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

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
  lines.push("- When the bundle includes a precise `targetLabel`, cite that label in the opening.");
  lines.push("- When `introducingDiffSummary` is present, use its summary to describe what the introducing commit changed.");
  lines.push(
    "- When `evolution.commitCountSinceIntroduction` is present, mention file activity since introduction in the opening."
  );
  lines.push(
    "- When `evolution.recentCommits` or `focusCommit` is present for a full-file trace, lead the opening / **Technical decision** with that recent decision story; treat `originalCommit` as birth/background unless this is a line selection."
  );
  lines.push(
    "- When `rationaleRanking` is present, name the primary rationale source in the opening and weight sections by rationale vs provenance roles."
  );
  lines.push(
    "- When `pathEvolution` is present, mention recent path activity and last modifier when assessing current ownership."
  );
  lines.push("");
}

/** One canonical rule for empty, missing, and failed evidence. */
export const EMPTY_EVIDENCE_HONESTY_RULE = `Empty-evidence honesty:
- A search that came back empty proves only that nothing matched this turn. It does not prove the event, decision, code, ticket, or discussion never existed.
- A missing, disconnected, skipped, timed-out, or failed source is unavailable. State that plainly; never cite it or infer facts from it.
- Never invent tickets, messages, pages, paths, URLs, people, or decisions to fill a gap.
- Empty tools in teammate English with the topic (e.g. “No mention in Slack of peel-auth / COOP-101”). “No Jira ticket matching COOP-101 in what came back.”
- An attached Jira ticket body or Confluence/docs page excerpt is documented decision evidence. Use it. Do not say there is no documented decision while those bodies are attached. Empty Slack is only “no mention in Slack.”`;

/** Slim evidence rules for general chat (static system prompt). */
export const GENERAL_CHAT_EVIDENCE_RULES = `Evidence rules (when sources or integration blocks are attached):
- Cite concrete file paths and source identifiers from the attachment — do not invent paths, URLs, ticket keys, or PR numbers.
${EMPTY_EVIDENCE_HONESTY_RULE}
- Integration and code-host blocks (Jira, Slack, Teams, Confluence, Notion, Google Docs, PRs/issues, related files) are partial results, not a full inventory. Never answer "how many" / "list all" / totals from those results alone — say this isn’t a full count and what would be needed for one.
- When \`<repo_inventory>\` is attached, it is the only valid source for repository totals (file count, lines of code, size). Use its numbers verbatim only if the user asked for totals or an overview; if a total is missing there, say it is unavailable rather than estimating one. Do not volunteer a file/line census for greetings, pings, or unrelated questions.
- Weight sources by reliability for decisions: pull requests and commit history > Jira tickets > Confluence/docs > Slack/Teams discussions. Prefer the higher-trust source when they conflict.
- Never invent ticket IDs, PR numbers, people, or quotes not present in the evidence.`;

/**
 * Agent hunt honesty — empty index search ≠ symbol missing from the repo.
 * Without this, synthesis invents restatements of the ask or false absences.
 */
export const AGENT_REPO_HUNT_RULES = `When <agent_search> or <agent_files> are attached:
- Prefer <agent_files> bodies. Cite real paths and line ranges from those blocks (citation fences with numeric startLine:endLine:path).
- If the user named a symbol (requireAuth, parse_token), only discuss files whose attached bodies contain that symbol or its snake_case/camelCase alias. Never substitute a nearby auth UI form or AuthRoot component.
- If <agent_search> has zero usable hits, or includes skipNote / exhaustedQueries: say “I couldn’t find {symbol} in this repo.” Do not claim the symbol is absent from the repository (index miss ≠ missing code).
- Never tell the user to clone the repo, open a local copy, or search on disk. Indexed remote is the workspace. If the write/reject path is not in attached bodies, say what you did read and that those files did not contain the API check — do not send them to a clone.
- If an attached body has validate() or ValidationError, cite it only when it rejects the field the user asked about. A validate() for a different field is a miss — keep hunting; do not narrate “must be elsewhere in this snippet.” Do not cite OpenAPI/swagger, a read_only serializer class, seed JSON, or a view that only checks permissions.
- Never open by restating or paraphrasing the user's ask when agent evidence is empty — answer with the miss, then a different symbol spelling to try.
- Do not dump the question text under a heading as if it were the answer. Do not use a **Your question** heading.`;

export const EVIDENCE_CITATION_RULES = `Citation rules:
${NARRATIVE_CITATION_RULES}
- The Sources evidence card lists every file, page, and integration hit — do not repeat those lists in the answer.
- Align quality and confidence statements with the Sources card the user sees.
- Do not cite evidence that is not in the attached bundle.
Never invent URLs, ticket IDs, PR numbers, people, or quotes not present in the evidence.`;

/** Shared rule: evidence lives on the Sources card, not a prose footer. */
export const SOURCES_FOOTER_OUTPUT_RULE = `Do not emit a **Sources** section. The Sources evidence card already lists files, pages, and hits. Cite paths, ticket keys, and PR numbers inline in plain language. At most 1–2 inline \`[Sources: …]\` labels in the opening if they help.`;

/** Legacy template title — never emit. Parsers still accept leftover model output. */
export const USER_FOCUS_SECTION_TITLE = "Your question";

/**
 * When the user typed focus text before/after a slash command (or a custom prompt-library
 * template), require the opening prose to answer that ask. Shared by every
 * quick-action synthesis builder.
 */
export function appendUserFocusInstructions(lines: string[], userFocus?: string): void {
  const focus = userFocus?.trim();
  if (!focus) {
    return;
  }
  lines.push("## User focus (required)");
  lines.push(focus);
  lines.push("");
  lines.push(
    "- The user added a specific ask on top of this action (text before and/or after the slash command). Treat it as the primary deliverable — not optional color on a generic overview."
  );
  lines.push(
    "- Answer that ask in the opening 1–3 sentences with concrete paths, flows, or evidence from the bundle. Do not add a **Your question**, **Answer**, or **Summary** heading."
  );
  lines.push(
    "- Keep at most 2–3 topic headings after the lead, weighted toward the focus. Do not ship a template overview that ignores the ask."
  );
  lines.push("");
  lines.push("## Section quality gates (strict pass / fail)");
  lines.push(
    "Opening prose — PASS: cites ≥1 concrete repo path or symbol from attached `<repo_entry_files>` / focus-search hits and explains the ask using that evidence. FAIL: generic SaaS narrative (form→API→DB) with no path/symbol; invents endpoints, tables, or services not in evidence; restates, paraphrases, or truncates the user's question instead of answering it; buries the ask under later sections."
  );
  lines.push(
    "**Architecture** / **Key subsystems** (when present) — PASS: weight toward subsystems named in focus evidence; name real paths. FAIL: restating docker-compose service names as if they were the focus answer."
  );
  lines.push(
    "**Risks & unknowns** — PASS: only evidence-tied gaps relevant to the focus (missing files, thin docs). FAIL: padding with generic testing/config advice unrelated to the ask."
  );
  lines.push(
    "If focus-search evidence is thin or missing: say so in the opening sentences — do not invent the happy-path workflow."
  );
  lines.push("");
}

/** Shared truncation marker appended after a `.slice(0, shown)` list so the model knows rows were omitted. */
export function truncationNote(total: number, shown: number): string {
  return total > shown ? `\n- …and ${total - shown} more (omitted)` : "";
}
