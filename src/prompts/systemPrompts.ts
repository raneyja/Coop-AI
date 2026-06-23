import type { UseCase } from "../api/types";
import type { IntegrationChatProvider } from "../chat/types";
import { DECISION_HISTORIAN_SYSTEM } from "./decisionSynthesis";
import { OWNERSHIP_INTELLIGENCE_SYSTEM } from "./ownershipSynthesis";
import { REPO_SUMMARY_EVIDENCE_SYSTEM } from "./repoSummarySynthesis";
import { BLAST_RADIUS_EVIDENCE_SYSTEM } from "./blastRadiusSynthesis";
import { KNOWLEDGE_GAPS_EVIDENCE_SYSTEM } from "./knowledgeGapsSynthesis";
import { INTEGRATION_EVIDENCE_SYSTEM } from "./integrationSynthesis";
import { GENERAL_CHAT_EVIDENCE_RULES } from "./evidenceSynthesis";
import { USER_IMAGE_ATTACHMENTS_SYSTEM_RULE } from "./userImageAttachments";

// Audience assumes professional engineers. If we add non-engineer seats (admin, eval),
// soften the fluency bullet or make it conditional — keep the block, don't remove it.
export const OPERATING_CONTEXT = `
## Audience & environment
- The user is a professional software engineer using CoopAI inside their code editor.
- Assume strong technical fluency; skip basic explanations unless asked.
- Favor concrete, actionable answers: real file paths, code, and specifics over generic advice.
- Be concise and direct. This is a working tool, not a tutorial.
- Do not open with filler ("Great question", "Certainly", or restating the request).
- Omit sections with no evidence — never pad with generic advice.
`;

export const CURSOR_STYLE_OUTPUT_CONTRACT = `
## Typography (not markdown)
CoopAI renders chat like Cursor: bold headings, body text, and italics — not markdown documents.
- Do NOT use: # headings, tables, blockquotes, horizontal rules, images, HTML, or README-style markdown layout.
- Main section titles (H1): **Title text** alone on its own line (blank line before). Examples: **Summary**, **Answer**, **Documentation gaps**, **Architecture**.
- Subsection titles (H2): same **Title** pattern nested under a main section — one short topic phrase per line, never a bullet.
- Inline emphasis: **bold** for key terms and field labels; *italics* for uncertainty, caveats, inferred vs confirmed claims, and brief asides.
- Lists: \`-\` bullets or \`1.\` numbered lists only — not nested markdown outlines.
- Code: inline \`backticks\` for identifiers; fenced blocks for multi-line code with a language tag.
- Cite repo code: \`\`\`startLine:endLine:filepath\` fence format.
- File paths in backticks: \`src/foo.ts\` or \`src/foo.ts:42\`.
- Links: [label](url) only when a real URL is in evidence; otherwise name the source in plain text.

## Uniform response template (all chat — quick actions included)
1. **Summary** or **Answer** — direct 1-2 sentence lead (always first).
2. Main sections from the use-case structure below — each **Title** on its own line with a blank line before it.
3. Under each main section: optional one-line lead, then either bullets or numbered items.
4. Multi-item audits (gaps, risks, alternatives, owners): one **subsection title** per item, then 2-4 bullets beneath — never a flat peer list.

## Response style
- Put a blank line before every main and subsection title.
- Field labels (**Open question:**, **What to check:**, **Risk:**, **Owner:**) are always bullets inside a subsection — never section titles and never top-level bullets without a subsection title above.
- Complete sentences. No fabricated URLs or paths.
- Prefer 4-8 topical sections over 15+ peer-level bullets.

## Grouping
- One theme per subsection. Category labels (e.g. **Dependency configuration**) are subsection titles, not bullets.
- Never alternate **Open question:** and **What to check:** as peer bullets without the subsection title directly above them.
`;

const USE_CASE_STRUCTURE: Partial<Record<Exclude<UseCase, "inline_completion">, string>> = {
  comprehension: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each; omit empty sections):

**Summary**
1-2 sentence overview of the repo or relevant subsystem.

**Architecture**
How major pieces connect; boundaries and data flow.

**Key subsystems**
One bullet per subsystem with supporting file paths.

**Entry points**
Where execution starts (CLI, HTTP handlers, extension activation, jobs, etc.).

**Risks & unknowns**
Concrete risks tied to paths or missing evidence.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. Name each skipped path and suggest fixes. **Never** include this section when all @ files are in scope or to confirm in-scope files.

**Suggested next steps**
Numbered list of 2-4 onboarding or investigation actions.

**Sources**
Include one bullet for every item in the required checklist attached to the user message. Format: \`[Sources: …] — one sentence on what that source contributed\`. Include Confluence/Jira/scan items when present in the bundle.`,

  decision_archaeology: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each):

**Summary**
Direct answer in 1-2 sentences. State evidence strength (strong / medium / weak / limited) when thin.

**Business context**
Why this code exists. One short paragraph or omit on follow-ups that did not ask for context.

**Technical decision**
What was chosen and why. Omit on follow-ups that did not ask for this when already covered.

**Alternatives considered**
One line or short bullets from evidence only. If unknown, write "Unknown — not recorded in attached sources." and omit speculative lists.

**Trade-offs**
One line from evidence only. If undocumented, write "Not documented in attached sources." Never invent generic trade-offs.

**Known limitations**
Future work or caveats from evidence. Omit if none.

**Domain experts**
Who to ask; cite sources. Omit if none named in evidence.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. **Never** include when all @ files are in scope.

**Sources**
Include one bullet for every item in the required checklist attached to the user message. Format: \`[Sources: …] — one sentence on what that source contributed\`. Omit integrations that failed or returned no results — those are not listed in the checklist.

Follow-up turns: keep this structure but stay compact — often 4-8 sentences total when evidence is limited. Omit empty sections except **Summary** and **Sources**.`,

  ownership: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each):

**Summary**
Who to contact first and why, in 1-2 sentences.

**True experts**
Bullets per person: tier (primary / secondary / backup), evidence (commits, reviews). Do not cite numeric ownership scores or points.

**Availability**
Current reachability or response expectations from evidence.

**Risks**
Single points of failure, stale ownership, bus factor.

**Escalation path**
Who to ask if primary experts are unavailable.

**Knowledge transfer**
Who should learn this area next.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. Name each skipped path and suggest fixes. **Never** include this section when all @ files are in scope or to confirm in-scope files.

**Recommended next step**
One concrete outreach or review action.

**Sources**
Include one bullet for every item in the required checklist attached to the user message. Format: \`[Sources: …] — one sentence on what that source contributed\`.`,

  blast_radius: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each). Keep the whole answer concise — the Sources card already lists files.

**Summary**
2-3 sentences max. **Open with the ranked Top risk surfaces from the evidence bundle** (up to 5, in order). Then state total **code** dependent count (exclude docs) and graph source (scip/zoekt/heuristic) when known. When dependency evidence is empty, say impact is **not found in the index** — never claim zero impact.

**Direct impact**
Exactly the **Top risk surfaces** list (up to 5, same order) — one short line each. **Never** add paths outside that ranked set; no "Additional impacted files" section.

**Transitive dependents**
One short paragraph, or **None identified**. No file dump.

**APIs & integrations**
Only when public API or integration evidence exists. One short paragraph. Omit if no evidence.

**Operational risk**
Only CI, deploy, or runtime evidence from the bundle. Omit if no evidence. Do not speculate about PR oversight.

**Testing surfaces**
Name test files or suites to run (from evidence). Bullet list, max 6 items.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. **Never** include when all @ files are in scope.

**Sources**
One short bullet per checklist item — one sentence each on what the source contributed. Never repeat file paths already shown in the Sources card.`,

  knowledge_gaps: `
## Required response structure
Group each gap as a subsection with nested bullets — never a flat peer list of titles and field lines.

**Summary**
1-2 sentences on documentation and ownership health for the active file or area. Never use **Answer** for this use case.

**Documentation gaps**
When \`<knowledge_gap_scan>\` is missing or contains \`<empty>\`: write one sentence that structured scan evidence is unavailable — **do not** invent gap subsections from code inspection.

When \`<knowledge_gap_scan>\` contains \`<gap>\` entries: add one subsection per scan gap using the two-bullet pattern below (title from gap type/message).

When \`<confluence_pages count="N">\` has \`count\` > 0, the first subsection in this section must be exactly:

**Confluence pages reviewed**

List exactly N bullets — one per \`<page>\` title, in the same order as the XML:

- **{exact <page> title}:** one sentence on whether it documents the active file/area and what it covers or omits

Do not use **Documentation coverage**, "Relevant pages include", or any synonym. Do not summarize pages you skip. If count is 7, list 7 titled bullets.

For scan-backed or Confluence-backed gaps only, use this shape (blank line between gaps):

**{Gap title from evidence}**

- **Open question:** one concrete uncertainty about this area
- **What to check:** doc, code path, ticket, or person that would resolve it

Rules:
- Subsection title on its own line (**Title**). Never bullet the title.
- Exactly two bullets under each title: **Open question:** then **What to check:**
- Never put those field lines as top-level bullets without the subsection title directly above.

**Ownership & maintenance**
Same subsection + two-bullet pattern (omit if none).

**Integration & operations**
Same subsection + two-bullet pattern for config, deploy, and ops unknowns (omit if none). Never bundle multiple open questions under one **Operational unknowns** header.

Forbidden section names (never use these): **Documentation coverage**, **Operational unknowns**, **Answer**.

**Recommended next steps**
Numbered list of 2-4 concrete actions.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. **Never** include when all @ files are in scope.

**Sources**
Include one bullet per checklist item — one sentence each. Each \`[Sources: …]\` label at most once. Include Confluence scan and job-scan items when present.`,

  chat: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each; omit empty sections):

**Answer**
Direct 1-2 sentence answer first.

Then add focused topic sections as needed. Under each section: optional one-line lead, then bullets or a numbered list — not one long undifferentiated list.

For multi-item answers (risks, options, gaps): use a **subsection title** per item with bullets beneath.`,

  integration: `
## Required response structure
Use these sections in order (**Title** on its own line; blank line before each):

**Answer**
Direct 1-2 sentence answer from the attached integration search results.

**Key findings**
Bullets citing specific messages, tickets, or pages by title/key.

**Gaps**
What the integration search did not cover or returned empty.

**Out-of-scope @ attachments**
Include only when the user message ## @ attachments section lists out-of-repo paths. **Never** include when all @ files are in scope.

**Sources**
Include one bullet for every item in the required checklist attached to the user message. Format: \`[Sources: …] — one sentence on what that source contributed\`.`
};

function withOutputContract(
  prompt: string,
  useCase: Exclude<UseCase, "inline_completion">
): string {
  const structure = USE_CASE_STRUCTURE[useCase] ?? "";
  return `${prompt}\n\n${OPERATING_CONTEXT}\n\n${USER_IMAGE_ATTACHMENTS_SYSTEM_RULE}\n\n${CURSOR_STYLE_OUTPUT_CONTRACT}${structure}`;
}

export const COMPREHENSION_SYSTEM = withOutputContract(REPO_SUMMARY_EVIDENCE_SYSTEM, "comprehension");

export const DECISION_ARCHAEOLOGY_SYSTEM = withOutputContract(DECISION_HISTORIAN_SYSTEM, "decision_archaeology");

export const OWNERSHIP_SYSTEM = withOutputContract(OWNERSHIP_INTELLIGENCE_SYSTEM, "ownership");

export const BLAST_RADIUS_SYSTEM = withOutputContract(BLAST_RADIUS_EVIDENCE_SYSTEM, "blast_radius");

export const KNOWLEDGE_GAPS_SYSTEM = withOutputContract(KNOWLEDGE_GAPS_EVIDENCE_SYSTEM, "knowledge_gaps");

export const INTEGRATION_SYSTEM = withOutputContract(INTEGRATION_EVIDENCE_SYSTEM, "integration");

export const GENERAL_CHAT_SYSTEM = withOutputContract(`You are CoopAI, an enterprise code intelligence assistant.
Answer clearly using supplied repository and organizational context. Cite concrete paths when evidence is attached; do not fabricate external links, ticket keys, or PR numbers.
When drawing conclusions from attached evidence, state strength (strong / medium / weak / limited) and distinguish provenance from inference.
When integration blocks show <empty>, say clearly that the search found nothing — do not invent tickets, messages, or pages.
For decision questions, weight pull requests and commit history above Slack/Teams chat when sources conflict.
When \`<local_files>\` / \`<file_content>\` blocks are attached, treat them as the authoritative source code. Quote exact conditions and identifiers from that code only — never invent functions, variables, or branches that are not present in the attachment.
When \`<jira_tickets>\` is attached, respect the match attribute: match="none" means no repo-linked tickets were found — say so clearly and do not describe other tickets as related; match="git" means keys came from commit/PR history; match="text" means Jira text mentions the repo; match="key" means the user named a specific key.

${GENERAL_CHAT_EVIDENCE_RULES}`, "chat");

const USE_CASE_PROMPTS: Record<UseCase, string> = {
  comprehension: COMPREHENSION_SYSTEM,
  decision_archaeology: DECISION_ARCHAEOLOGY_SYSTEM,
  ownership: OWNERSHIP_SYSTEM,
  blast_radius: BLAST_RADIUS_SYSTEM,
  knowledge_gaps: KNOWLEDGE_GAPS_SYSTEM,
  integration: INTEGRATION_SYSTEM,
  chat: GENERAL_CHAT_SYSTEM,
  inline_completion: `You are a code completion engine. The user is typing code.

TASK: Complete the current line or the next 2-3 lines of code.

RULES:
- Match indentation and style of surrounding code
- Complete ONE logical statement (not multiple unrelated blocks)
- If uncertain, return JUST the most likely completion
- Never explain, never add comments, just code
- Respect language syntax and conventions
- If completion would be trivial (only a semicolon), return empty
- Return ONLY the completion text. No markdown fences, no explanations.`
};

export function systemPromptForUseCase(useCase: UseCase): string {
  return USE_CASE_PROMPTS[useCase] ?? GENERAL_CHAT_SYSTEM;
}

export function useCaseFromQuickAction(quickAction: string | undefined): UseCase {
  switch (quickAction) {
    case "understand-repo":
      return "comprehension";
    case "trace-decision":
      return "decision_archaeology";
    case "find-owner":
      return "ownership";
    case "blast-radius":
      return "blast_radius";
    case "knowledge-gaps":
      return "knowledge_gaps";
    default:
      return "chat";
  }
}

export function resolveChatUseCase(
  quickAction: string | undefined,
  integrationProvider?: IntegrationChatProvider
): UseCase {
  if (integrationProvider) {
    return "integration";
  }
  return useCaseFromQuickAction(quickAction);
}

type ManifestSnippet = { path: string; content: string; lineRange?: [number, number] };
type MentionFileSnippet = ManifestSnippet & { repoId: string };

/** Build the user turn when local file bytes are already loaded (extension-side). */
export function formatChatMessageWithLocalFiles(options: {
  message: string;
  files: ManifestSnippet[];
  file?: string;
  selectedLines?: [number, number];
  owner?: string;
  repo?: string;
  branch?: string;
}): string {
  const lines: string[] = ["<attached_context>"];
  if (options.owner && options.repo) {
    lines.push(`repo: ${options.owner}/${options.repo}`);
  }
  if (options.branch) {
    lines.push(`branch: ${options.branch}`);
  }
  if (options.file) {
    const range =
      options.selectedLines && options.selectedLines.length === 2
        ? ` lines="${options.selectedLines[0]}-${options.selectedLines[1]}"`
        : "";
    lines.push(`<file path="${options.file}"${range} />`);
  }
  lines.push("<local_files>");
  lines.push("The file_content blocks below are authoritative source code from the user's workspace.");
  lines.push("Answer ONLY from this code. Quote exact conditions; do not invent identifiers.");
  for (const file of options.files) {
    const range =
      file.lineRange && file.lineRange.length === 2
        ? ` lines="${file.lineRange[0]}-${file.lineRange[1]}"`
        : "";
    lines.push(`<file_content path="${file.path}"${range}>`);
    lines.push(file.content);
    lines.push("</file_content>");
  }
  lines.push("</local_files>", "</attached_context>", "", options.message.trim());
  return lines.join("\n");
}

/** Build the user turn when @-mentioned files are resolved (cross-repo). */
export function formatChatMessageWithMentionFiles(options: {
  message: string;
  files: MentionFileSnippet[];
  owner?: string;
  repo?: string;
  branch?: string;
}): string {
  const lines: string[] = ["<attached_context>"];
  if (options.owner && options.repo) {
    lines.push(`repo: ${options.owner}/${options.repo}`);
  }
  if (options.branch) {
    lines.push(`branch: ${options.branch}`);
  }
  lines.push("<mentioned_files>");
  lines.push(
    "The file_content blocks below are user @-attachments. Use only in-scope paths listed in the message ## @ attachments section; do not treat out-of-scope paths as part of the primary analysis."
  );
  for (const file of options.files) {
    const range =
      file.lineRange && file.lineRange.length === 2
        ? ` lines="${file.lineRange[0]}-${file.lineRange[1]}"`
        : "";
    lines.push(`<file_content path="${file.path}" repo="${file.repoId}"${range}>`);
    lines.push(file.content);
    lines.push("</file_content>");
  }
  lines.push("</mentioned_files>", "</attached_context>", "", options.message.trim());
  return lines.join("\n");
}

export function buildUserMessageWithContext(
  message: string,
  context?: {
    owner?: string;
    repo?: string;
    branch?: string;
    file?: string;
    selectedLines?: [number, number];
    languageId?: string;
    contextBundle?: unknown;
  }
): string {
  const repoSummarySnippets = extractRepoSummaryEntryFiles(context?.contextBundle);
  const localSnippets = extractLocalFileSnippets(context?.contextBundle);
  const jiraTickets = extractJiraSearchTickets(context?.contextBundle);
  const slackMessages = extractSlackSearchMessages(context?.contextBundle);
  const teamsMessages = extractTeamsSearchMessages(context?.contextBundle);
  const codeHostActivity = extractCodeHostSearch(context?.contextBundle);
  const confluencePages = extractConfluenceSearch(context?.contextBundle);
  const notionPages = extractNotionSearch(context?.contextBundle);
  const googleDocs = extractGoogleDocsSearch(context?.contextBundle);
  const knowledgeGapScan = extractKnowledgeGapJobScan(context?.contextBundle);
  if (
    !context?.file &&
    context?.contextBundle === undefined &&
    repoSummarySnippets.length === 0 &&
    localSnippets.length === 0 &&
    !jiraTickets &&
    !slackMessages &&
    !teamsMessages &&
    !codeHostActivity &&
    !confluencePages &&
    !notionPages &&
    !googleDocs &&
    !knowledgeGapScan
  ) {
    return message;
  }

  const lines: string[] = ["<attached_context>"];
  if (context?.owner && context.repo) {
    lines.push(`repo: ${context.owner}/${context.repo}`);
  }
  if (context?.branch) {
    lines.push(`branch: ${context.branch}`);
  }
  if (context?.file) {
    const range =
      context.selectedLines && context.selectedLines.length === 2
        ? ` lines="${context.selectedLines[0]}-${context.selectedLines[1]}"`
        : "";
    lines.push(`<file path="${context.file}"${range} />`);
  }
  const treeOverview = extractTreeOverview(context?.contextBundle);
  if (treeOverview) {
    const monorepoNote = buildMonorepoContextNote(treeOverview, context?.file);
    if (monorepoNote) {
      lines.push(monorepoNote);
    }
  }
  if (localSnippets.length > 0) {
    lines.push("<local_files>");
    lines.push("The file_content blocks below are authoritative source code from the user's workspace.");
    for (const file of localSnippets) {
      const range =
        file.lineRange && file.lineRange.length === 2
          ? ` lines="${file.lineRange[0]}-${file.lineRange[1]}"`
          : "";
      lines.push(`<file_content path="${file.path}"${range}>`);
      lines.push(file.content);
      lines.push("</file_content>");
    }
    lines.push("</local_files>");
  }
  if (repoSummarySnippets.length > 0) {
    lines.push("<repo_entry_files>");
    lines.push("Representative repository entry points for architecture overview (not limited to the active editor tab).");
    for (const file of repoSummarySnippets) {
      lines.push(`<file_content path="${file.path}">`);
      lines.push(file.content);
      lines.push("</file_content>");
    }
    lines.push("</repo_entry_files>");
  }
  if (jiraTickets) {
    lines.push(...formatJiraTicketsForLlm(jiraTickets));
  }
  if (slackMessages) {
    lines.push(...formatSlackMessagesForLlm(slackMessages));
  }
  if (teamsMessages) {
    lines.push(...formatTeamsMessagesForLlm(teamsMessages));
  }
  if (codeHostActivity) {
    lines.push(...formatCodeHostActivityForLlm(codeHostActivity));
  }
  if (confluencePages) {
    lines.push(...formatConfluencePagesForLlm(confluencePages));
  }
  if (notionPages) {
    lines.push(...formatNotionPagesForLlm(notionPages));
  }
  if (googleDocs) {
    lines.push(...formatGoogleDocsForLlm(googleDocs));
  }
  if (knowledgeGapScan) {
    lines.push(...formatKnowledgeGapJobScanForLlm(knowledgeGapScan));
  }
  if (context?.contextBundle !== undefined) {
    const qualityNote = buildIndexQualityNote(context.contextBundle);
    if (qualityNote) {
      lines.push(qualityNote);
    }
    lines.push("<graph_context>");
    lines.push(JSON.stringify(sanitizeContextBundleForLlm(context.contextBundle), null, 2));
    lines.push("</graph_context>");
  }
  lines.push("</attached_context>", "", message.trim());
  return lines.join("\n");
}

type TreeOverviewSnippet = {
  topLevelDirs?: string[];
  topLevelFiles?: string[];
};

function extractTreeOverview(bundle: unknown): TreeOverviewSnippet | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const treeOverview = (entry as { data?: { treeOverview?: TreeOverviewSnippet } }).data?.treeOverview;
    if (treeOverview?.topLevelDirs?.length) {
      return treeOverview;
    }
  }
  return undefined;
}

function buildMonorepoContextNote(treeOverview: TreeOverviewSnippet, activeFile?: string): string | undefined {
  const dirs = (treeOverview.topLevelDirs ?? []).map((dir) => dir.replace(/\/$/, ""));
  if (dirs.length <= 1) {
    return undefined;
  }
  const dirsList = dirs.map((dir) => `\`${dir}/\``).join(", ");
  let scopeLine =
    "Scope general answers to the whole monorepo unless the user names a specific top-level package.";
  if (activeFile) {
    const normalized = activeFile.replace(/\\/g, "/").replace(/^\.?\//, "");
    const top = normalized.split("/")[0];
    const matchingDir = dirs.find((dir) => dir === top || normalized.startsWith(`${dir}/`));
    if (matchingDir) {
      scopeLine = `Active editor context applies to the \`${matchingDir}/\` package (active file: \`${normalized}\`). Prefer paths under this package unless the user asks about another top-level package.`;
    }
  }
  return `<monorepo_context>Monorepo with top-level packages: ${dirsList}. ${scopeLine}</monorepo_context>`;
}

function extractRepoSummaryEntryFiles(bundle: unknown): ManifestSnippet[] {
  if (!Array.isArray(bundle)) {
    return [];
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const data = (entry as { data?: { entryFiles?: ManifestSnippet[] } }).data;
    const files = data?.entryFiles;
    if (files?.length) {
      return files.filter((file) => file.path && file.content);
    }
  }
  return [];
}

type JiraTicketSnippet = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  updated: string;
  htmlUrl: string;
  labels?: string[];
};

type JiraSearchSnippet = {
  jql: string;
  repoQuery?: string;
  issues: JiraTicketSnippet[];
  repoKeyHits?: string[];
  matchStrategy?: "text" | "git" | "key" | "none";
  searchNote?: string;
  error?: string;
};

function extractJiraSearchTickets(bundle: unknown): JiraSearchSnippet | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const jiraSearch = (entry as { data?: { jiraSearch?: JiraSearchSnippet } }).data?.jiraSearch;
    if (jiraSearch) {
      return jiraSearch;
    }
  }
  return undefined;
}

function formatJiraTicketsForLlm(jira: JiraSearchSnippet): string[] {
  const issues = jira.issues ?? [];
  const match = jira.matchStrategy ?? (issues.length > 0 ? "text" : "none");
  const lines: string[] = [`<jira_tickets match="${escapeXml(match)}">`];
  if (jira.error) {
    lines.push(`<error>${escapeXml(jira.error)}</error>`);
  }
  if (jira.searchNote) {
    lines.push(`<note>${escapeXml(jira.searchNote)}</note>`);
  }
  if (jira.jql) {
    const repoKeys = jira.repoKeyHits?.length ? ` repo_keys="${escapeXml(jira.repoKeyHits.join(", "))}"` : "";
    lines.push(
      `<search jql="${escapeXml(jira.jql)}"${jira.repoQuery ? ` repo="${escapeXml(jira.repoQuery)}"` : ""}${repoKeys} />`
    );
  }
  if (issues.length === 0 && !jira.error) {
    lines.push("<empty>No matching Jira tickets found.</empty>");
  }
  for (const issue of issues) {
    const labels = issue.labels?.length ? ` labels="${escapeXml(issue.labels.join(", "))}"` : "";
    lines.push(
      `<ticket key="${escapeXml(issue.key)}" status="${escapeXml(issue.status)}" type="${escapeXml(issue.issueType)}" updated="${escapeXml(issue.updated)}" url="${escapeXml(issue.htmlUrl)}"${labels}>${escapeXml(issue.summary)}</ticket>`
    );
  }
  lines.push("</jira_tickets>");
  return lines;
}

type SlackSearchSnippet = {
  query: string;
  repoQuery?: string;
  messages: Array<{ channelName?: string; userName?: string; text: string; ts: string; permalink?: string }>;
  error?: string;
};

type TeamsSearchSnippet = {
  query: string;
  repoQuery?: string;
  messages: Array<{ fromUserName?: string; body: string; createdAt: string; webUrl?: string }>;
  error?: string;
};

type CodeHostSearchSnippet = {
  provider: string;
  repoQuery?: string;
  pullRequests: Array<{ number: number; title: string; state: string; merged: boolean; author?: string; updatedAt: string; htmlUrl?: string }>;
  issues: Array<{ number: number; title: string; state: string; author?: string; updatedAt: string; htmlUrl?: string }>;
  error?: string;
};

function extractSlackSearchMessages(bundle: unknown): SlackSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "slackSearch");
}

function extractTeamsSearchMessages(bundle: unknown): TeamsSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "teamsSearch");
}

function extractCodeHostSearch(bundle: unknown): CodeHostSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "codeHostSearch");
}

type DocPageSnippet = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
};

type ConfluenceSearchSnippet = {
  cql: string;
  repoQuery?: string;
  pages: DocPageSnippet[];
  error?: string;
};

type NotionSearchSnippet = {
  query: string;
  repoQuery?: string;
  pages: Array<{ id: string; title: string; updated: string; htmlUrl: string }>;
  error?: string;
};

type GoogleDocsSearchSnippet = {
  query: string;
  repoQuery?: string;
  documents: Array<{ id: string; title: string; updated: string; htmlUrl: string }>;
  error?: string;
};

type KnowledgeGapJobScanSnippet = {
  source: string;
  cached?: boolean;
  foundGaps: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  gaps: Array<{ file?: string; type?: string; priority?: string; message?: string }>;
};

function extractConfluenceSearch(bundle: unknown): ConfluenceSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "confluenceSearch");
}

function extractNotionSearch(bundle: unknown): NotionSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "notionSearch");
}

function extractGoogleDocsSearch(bundle: unknown): GoogleDocsSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "googleDocsSearch");
}

function extractKnowledgeGapJobScan(bundle: unknown): KnowledgeGapJobScanSnippet | undefined {
  return extractIntegrationSearch(bundle, "jobScan");
}

function extractIntegrationSearch<T>(bundle: unknown, key: string): T | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const hit = (entry as { data?: Record<string, unknown> }).data?.[key];
    if (hit) {
      return hit as T;
    }
  }
  return undefined;
}

function formatSlackMessagesForLlm(slack: SlackSearchSnippet): string[] {
  const messages = slack.messages ?? [];
  const lines: string[] = ["<slack_messages>"];
  if (slack.error) {
    lines.push(`<error>${escapeXml(slack.error)}</error>`);
  }
  if (slack.query) {
    lines.push(`<search query="${escapeXml(slack.query)}"${slack.repoQuery ? ` repo="${escapeXml(slack.repoQuery)}"` : ""} />`);
  }
  if (messages.length === 0 && !slack.error) {
    lines.push("<empty>No matching Slack messages found.</empty>");
  }
  for (const msg of messages) {
    const channel = msg.channelName ? ` channel="${escapeXml(msg.channelName)}"` : "";
    const user = msg.userName ? ` user="${escapeXml(msg.userName)}"` : "";
    const url = msg.permalink ? ` url="${escapeXml(msg.permalink)}"` : "";
    lines.push(`<message ts="${escapeXml(msg.ts)}"${channel}${user}${url}>${escapeXml(msg.text)}</message>`);
  }
  lines.push("</slack_messages>");
  return lines;
}

function formatTeamsMessagesForLlm(teams: TeamsSearchSnippet): string[] {
  const messages = teams.messages ?? [];
  const lines: string[] = ["<teams_messages>"];
  if (teams.error) {
    lines.push(`<error>${escapeXml(teams.error)}</error>`);
  }
  if (teams.query) {
    lines.push(`<search query="${escapeXml(teams.query)}"${teams.repoQuery ? ` repo="${escapeXml(teams.repoQuery)}"` : ""} />`);
  }
  if (messages.length === 0 && !teams.error) {
    lines.push("<empty>No matching Teams messages found.</empty>");
  }
  for (const msg of messages) {
    const user = msg.fromUserName ? ` user="${escapeXml(msg.fromUserName)}"` : "";
    const url = msg.webUrl ? ` url="${escapeXml(msg.webUrl)}"` : "";
    lines.push(
      `<message created="${escapeXml(msg.createdAt)}"${user}${url}>${escapeXml(msg.body)}</message>`
    );
  }
  lines.push("</teams_messages>");
  return lines;
}

function formatKnowledgeGapJobScanForLlm(scan: KnowledgeGapJobScanSnippet): string[] {
  const gaps = scan.gaps ?? [];
  const lines: string[] = [
    `<knowledge_gap_scan cached="${scan.cached ? "true" : "false"}" found="${scan.foundGaps}" high="${scan.highPriority}" medium="${scan.mediumPriority}" low="${scan.lowPriority}">`
  ];
  if (gaps.length === 0) {
    lines.push("<empty>No structured repo gaps from background scan.</empty>");
  }
  for (const gap of gaps) {
    const file = gap.file ? ` file="${escapeXml(gap.file)}"` : "";
    const type = gap.type ? ` type="${escapeXml(gap.type)}"` : "";
    const priority = gap.priority ? ` priority="${escapeXml(gap.priority)}"` : "";
    lines.push(`<gap${file}${type}${priority}>${escapeXml(gap.message ?? "")}</gap>`);
  }
  lines.push("</knowledge_gap_scan>");
  return lines;
}

function formatConfluencePagesForLlm(confluence: ConfluenceSearchSnippet): string[] {
  const pages = confluence.pages ?? [];
  const pageCount = pages.length;
  const lines: string[] = [`<confluence_pages count="${pageCount}">`];
  if (confluence.error) {
    lines.push(`<error>${escapeXml(confluence.error)}</error>`);
  }
  if (confluence.cql) {
    lines.push(
      `<search cql="${escapeXml(confluence.cql)}"${confluence.repoQuery ? ` repo="${escapeXml(confluence.repoQuery)}"` : ""} />`
    );
  }
  if (pageCount === 0 && !confluence.error) {
    lines.push("<empty>No matching Confluence pages found.</empty>");
  }
  if (pageCount > 0) {
    lines.push(
      `<instruction>List all ${pageCount} page titles under **Confluence pages reviewed** in Knowledge Gaps responses.</instruction>`
    );
  }
  for (const page of pages) {
    const url = page.htmlUrl ? ` url="${escapeXml(page.htmlUrl)}"` : "";
    const excerpt = page.excerpt ? ` excerpt="${escapeXml(page.excerpt)}"` : "";
    lines.push(
      `<page id="${escapeXml(page.id)}" updated="${escapeXml(page.updated)}"${url}${excerpt}>${escapeXml(page.title)}</page>`
    );
  }
  lines.push("</confluence_pages>");
  return lines;
}

function formatNotionPagesForLlm(notion: NotionSearchSnippet): string[] {
  const pages = notion.pages ?? [];
  const lines: string[] = ["<notion_pages>"];
  if (notion.error) {
    lines.push(`<error>${escapeXml(notion.error)}</error>`);
  }
  if (notion.query) {
    lines.push(
      `<search query="${escapeXml(notion.query)}"${notion.repoQuery ? ` repo="${escapeXml(notion.repoQuery)}"` : ""} />`
    );
  }
  if (pages.length === 0 && !notion.error) {
    lines.push("<empty>No matching Notion pages found.</empty>");
  }
  for (const page of pages) {
    const url = page.htmlUrl ? ` url="${escapeXml(page.htmlUrl)}"` : "";
    lines.push(
      `<page id="${escapeXml(page.id)}" updated="${escapeXml(page.updated)}"${url}>${escapeXml(page.title)}</page>`
    );
  }
  lines.push("</notion_pages>");
  return lines;
}

function formatGoogleDocsForLlm(googleDocs: GoogleDocsSearchSnippet): string[] {
  const documents = googleDocs.documents ?? [];
  const lines: string[] = ["<google_docs>"];
  if (googleDocs.error) {
    lines.push(`<error>${escapeXml(googleDocs.error)}</error>`);
  }
  if (googleDocs.query) {
    lines.push(
      `<search query="${escapeXml(googleDocs.query)}"${googleDocs.repoQuery ? ` repo="${escapeXml(googleDocs.repoQuery)}"` : ""} />`
    );
  }
  if (documents.length === 0 && !googleDocs.error) {
    lines.push("<empty>No matching Google Docs found.</empty>");
  }
  for (const doc of documents) {
    const url = doc.htmlUrl ? ` url="${escapeXml(doc.htmlUrl)}"` : "";
    lines.push(
      `<document id="${escapeXml(doc.id)}" updated="${escapeXml(doc.updated)}"${url}>${escapeXml(doc.title)}</document>`
    );
  }
  lines.push("</google_docs>");
  return lines;
}

function formatCodeHostActivityForLlm(codeHost: CodeHostSearchSnippet): string[] {
  const pullRequests = codeHost.pullRequests ?? [];
  const issues = codeHost.issues ?? [];
  const lines: string[] = ["<code_host_activity>"];
  if (codeHost.error) {
    lines.push(`<error>${escapeXml(codeHost.error)}</error>`);
  }
  lines.push(`<provider>${escapeXml(codeHost.provider)}</provider>`);
  if (codeHost.repoQuery) {
    lines.push(`<repo>${escapeXml(codeHost.repoQuery)}</repo>`);
  }
  if (pullRequests.length === 0 && issues.length === 0 && !codeHost.error) {
    lines.push("<empty>No pull requests or issues found.</empty>");
  }
  for (const pr of pullRequests) {
    const author = pr.author ? ` author="${escapeXml(pr.author)}"` : "";
    const url = pr.htmlUrl ? ` url="${escapeXml(pr.htmlUrl)}"` : "";
    lines.push(
      `<pull_request number="${pr.number}" state="${escapeXml(pr.state)}" merged="${pr.merged}" updated="${escapeXml(pr.updatedAt)}"${author}${url}>${escapeXml(pr.title)}</pull_request>`
    );
  }
  for (const issue of issues) {
    const author = issue.author ? ` author="${escapeXml(issue.author)}"` : "";
    const url = issue.htmlUrl ? ` url="${escapeXml(issue.htmlUrl)}"` : "";
    lines.push(
      `<issue number="${issue.number}" state="${escapeXml(issue.state)}" updated="${escapeXml(issue.updatedAt)}"${author}${url}>${escapeXml(issue.title)}</issue>`
    );
  }
  lines.push("</code_host_activity>");
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractLocalFileSnippets(bundle: unknown): ManifestSnippet[] {
  if (!Array.isArray(bundle)) {
    return [];
  }
  const snippets: ManifestSnippet[] = [];
  const seen = new Set<string>();
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const localFiles = (entry as { data?: { localFiles?: { files?: ManifestSnippet[] } } }).data?.localFiles
      ?.files;
    if (!localFiles?.length) {
      continue;
    }
    for (const file of localFiles) {
      if (!file.path || !file.content || seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      snippets.push(file);
    }
  }
  return snippets;
}

function sanitizeContextBundleForLlm(bundle: unknown): unknown {
  if (!Array.isArray(bundle)) {
    return bundle;
  }
  return bundle.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return entry;
    }
    const record = entry as {
      data?: {
        localFiles?: { files?: Array<{ path: string; content: string; lineRange?: [number, number] }> };
        jiraSearch?: { issues: unknown[] };
        slackSearch?: { messages: unknown[] };
        teamsSearch?: { messages: unknown[] };
        codeHostSearch?: { pullRequests: unknown[]; issues: unknown[] };
        confluenceSearch?: { pages: unknown[] };
        notionSearch?: { pages: unknown[] };
        googleDocsSearch?: { documents: unknown[] };
        entryFiles?: Array<{ path: string; content: string; truncated?: boolean }>;
      };
    };
    const source = record.data;
    if (!source) {
      return entry;
    }

    let mutated = false;
    const data: Record<string, unknown> = { ...source };

    if (source.entryFiles?.length) {
      mutated = true;
      data.entryFiles = source.entryFiles.map((file) => ({
        path: file.path,
        byteLength: file.content?.length ?? 0,
        ...(file.truncated ? { truncated: true } : {})
      }));
    }

    if (source.localFiles?.files?.length) {
      mutated = true;
      data.localFiles = {
        ...source.localFiles,
        files: source.localFiles.files.map((file) => ({
          path: file.path,
          byteLength: file.content?.length ?? 0,
          ...(file.lineRange ? { lineRange: file.lineRange } : {})
        }))
      };
    }

    if (source.jiraSearch?.issues?.length) {
      mutated = true;
      data.jiraSearch = {
        ...source.jiraSearch,
        issues: source.jiraSearch.issues.map((issue) =>
          issue && typeof issue === "object"
            ? {
                key: (issue as { key?: string }).key,
                status: (issue as { status?: string }).status,
                issueType: (issue as { issueType?: string }).issueType
              }
            : issue
        )
      };
    }

    if (source.slackSearch?.messages?.length) {
      mutated = true;
      data.slackSearch = {
        ...source.slackSearch,
        messages: source.slackSearch.messages.map((msg) =>
          msg && typeof msg === "object"
            ? {
                channelName: (msg as { channelName?: string }).channelName,
                userName: (msg as { userName?: string }).userName,
                ts: (msg as { ts?: string }).ts
              }
            : msg
        )
      };
    }

    if (source.teamsSearch?.messages?.length) {
      mutated = true;
      data.teamsSearch = {
        ...source.teamsSearch,
        messages: source.teamsSearch.messages.map((msg) =>
          msg && typeof msg === "object"
            ? {
                fromUserName: (msg as { fromUserName?: string }).fromUserName,
                createdAt: (msg as { createdAt?: string }).createdAt
              }
            : msg
        )
      };
    }

    if (source.codeHostSearch) {
      mutated = true;
      data.codeHostSearch = {
        ...source.codeHostSearch,
        pullRequests: source.codeHostSearch.pullRequests?.map((pr) =>
          pr && typeof pr === "object"
            ? {
                number: (pr as { number?: number }).number,
                title: (pr as { title?: string }).title,
                state: (pr as { state?: string }).state
              }
            : pr
        ),
        issues: source.codeHostSearch.issues?.map((issue) =>
          issue && typeof issue === "object"
            ? {
                number: (issue as { number?: number }).number,
                title: (issue as { title?: string }).title,
                state: (issue as { state?: string }).state
              }
            : issue
        )
      };
    }

    if (source.confluenceSearch?.pages?.length) {
      mutated = true;
      data.confluenceSearch = {
        ...source.confluenceSearch,
        pages: source.confluenceSearch.pages.map((page) =>
          page && typeof page === "object"
            ? {
                id: (page as { id?: string }).id,
                title: (page as { title?: string }).title,
                updated: (page as { updated?: string }).updated
              }
            : page
        )
      };
    }

    if (source.notionSearch?.pages?.length) {
      mutated = true;
      data.notionSearch = {
        ...source.notionSearch,
        pages: source.notionSearch.pages.map((page) =>
          page && typeof page === "object"
            ? {
                id: (page as { id?: string }).id,
                title: (page as { title?: string }).title,
                updated: (page as { updated?: string }).updated
              }
            : page
        )
      };
    }

    if (source.googleDocsSearch?.documents?.length) {
      mutated = true;
      data.googleDocsSearch = {
        ...source.googleDocsSearch,
        documents: source.googleDocsSearch.documents.map((doc) =>
          doc && typeof doc === "object"
            ? {
                id: (doc as { id?: string }).id,
                title: (doc as { title?: string }).title,
                updated: (doc as { updated?: string }).updated
              }
            : doc
        )
      };
    }

    if (!mutated) {
      return entry;
    }
    return {
      ...entry,
      data
    };
  });
}

/**
 * Emits a compact XML annotation that tells the LLM what retrieval sources
 * contributed to the attached graph_context and how much to trust each one.
 *
 * The model uses this to calibrate confidence:
 *  - precise (SCIP):      compiler-derived, exact — treat like ground truth
 *  - full-text (Zoekt):   token-level exact match — reliable for pattern searches
 *  - semantic (embedding): similarity-based — flag inferences as "likely, not confirmed"
 *  - heuristic (tree-sitter): pattern-based — approximate; note caveats on specifics
 */
function buildIndexQualityNote(bundle: unknown): string | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }

  let scipPrecise = false;
  let zoektAvailable = false;
  let embeddingAvailable = false;
  let heuristicOnly = false;
  let language: string | undefined;

  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const data = (entry as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const lightning = data?.lightning as Record<string, unknown> | undefined;
    if (!lightning) {
      continue;
    }
    if (lightning.scipAvailable) {
      scipPrecise = true;
    }
    if (lightning.zoektAvailable) {
      zoektAvailable = true;
    }
    if (lightning.searchSource === "embedding") {
      embeddingAvailable = true;
    }
    if (lightning.searchSource === "tree-sitter") {
      heuristicOnly = true;
    }
    if (typeof lightning.language === "string") {
      language = lightning.language;
    }
  }

  // No lightning context in this bundle — skip the note
  if (!scipPrecise && !zoektAvailable && !embeddingAvailable && !heuristicOnly) {
    return undefined;
  }

  const sources: string[] = [];
  if (scipPrecise) {
    sources.push(`scip${language ? `(${language})` : ""}=precise`);
  }
  if (zoektAvailable) {
    sources.push("zoekt=full-text");
  }
  if (embeddingAvailable) {
    sources.push("embedding=semantic");
  }
  if (heuristicOnly && !scipPrecise) {
    sources.push("tree-sitter=heuristic");
  }

  const quality = scipPrecise ? "precise" : embeddingAvailable ? "semantic" : "heuristic";
  return `<index_quality quality="${quality}" sources="${sources.join(",")}">\n` +
    `When reasoning about code from graph_context:\n` +
    (scipPrecise ? `- SCIP symbols are compiler-derived. Definitions, types, and references are exact.\n` : "") +
    (zoektAvailable ? `- Zoekt hits are exact full-text matches. Safe for pattern and token searches.\n` : "") +
    (embeddingAvailable ? `- Embedding hits are semantic similarity matches. *Flag inferences as approximate* when only embedding context supports the claim.\n` : "") +
    (heuristicOnly && !scipPrecise ? `- Index is tree-sitter heuristic only. Treat symbol locations as approximate; note caveats for specific line numbers.\n` : "") +
    `</index_quality>`;
}
