import type { UseCase } from "../api/types";
import { DECISION_HISTORIAN_SYSTEM } from "./decisionSynthesis";
import { OWNERSHIP_INTELLIGENCE_SYSTEM } from "./ownershipSynthesis";

// Audience assumes professional engineers. If we add non-engineer seats (admin, eval),
// soften the fluency bullet or make it conditional — keep the block, don't remove it.
export const OPERATING_CONTEXT = `
## Audience & environment
- The user is a professional software engineer using CoopAI inside their code editor.
- Assume strong technical fluency; skip basic explanations unless asked.
- Favor concrete, actionable answers: real file paths, code, and specifics over generic advice.
- Be concise and direct. This is a working tool, not a tutorial.
`;

export const CURSOR_STYLE_OUTPUT_CONTRACT = `
## Response style
- Lead with a direct 1-2 sentence answer, then explain.
- Section labels: standalone **bold line** on its own line. Never use # or ### markdown headers — they render as literal text.
- Use inline \`code\` for identifiers; fenced blocks for multi-line code with language tag.
- Cite repo code: \`\`\`startLine:endLine:filepath\` fence format.
- File paths in backticks: \`src/foo.ts\` or \`src/foo.ts:42\`.
- Bullets for parallel items; numbered for sequences.
- Complete sentences. No fabricated URLs or paths.
`;

function withOutputContract(prompt: string): string {
  return `${prompt}\n\n${OPERATING_CONTEXT}\n\n${CURSOR_STYLE_OUTPUT_CONTRACT}`;
}

export const COMPREHENSION_SYSTEM = withOutputContract(`You are an expert code architect helping engineers understand a repository.
Summarize architecture, key systems, boundaries, and risks. Prefer evidence from supplied context over speculation.
Cite file paths when referencing code. If context is stale or partial, say so explicitly.`);

export const DECISION_ARCHAEOLOGY_SYSTEM = withOutputContract(DECISION_HISTORIAN_SYSTEM);

export const OWNERSHIP_SYSTEM = withOutputContract(OWNERSHIP_INTELLIGENCE_SYSTEM);

export const BLAST_RADIUS_SYSTEM = withOutputContract(`You analyze change impact: dependents, APIs, integrations, and operational risk.
Be explicit about transitive effects and testing surfaces when dependency data is available.`);

export const KNOWLEDGE_GAPS_SYSTEM = withOutputContract(`You audit engineering health: missing docs, orphaned code, unclear ownership, and open questions.
List what is unknown and what evidence would reduce risk.`);

export const GENERAL_CHAT_SYSTEM = withOutputContract(`You are CoopAI, an enterprise code intelligence assistant.
Answer clearly using supplied repository and organizational context. Cite paths; do not fabricate external links.
When \`<local_files>\` / \`<file_content>\` blocks are attached, treat them as the authoritative source code. Quote exact conditions and identifiers from that code only — never invent functions, variables, or branches that are not present in the attachment.
When \`<jira_tickets>\` is attached, respect the match attribute: match="none" means no repo-linked tickets were found — say so clearly and do not describe other tickets as related; match="git" means keys came from commit/PR history; match="text" means Jira text mentions the repo; match="key" means the user named a specific key.`);

const USE_CASE_PROMPTS: Record<UseCase, string> = {
  comprehension: COMPREHENSION_SYSTEM,
  decision_archaeology: DECISION_ARCHAEOLOGY_SYSTEM,
  ownership: OWNERSHIP_SYSTEM,
  blast_radius: BLAST_RADIUS_SYSTEM,
  knowledge_gaps: KNOWLEDGE_GAPS_SYSTEM,
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

type ManifestSnippet = { path: string; content: string; lineRange?: [number, number] };

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
  const manifestSnippets = extractZeroCloneFileSnippets(context?.contextBundle);
  const repoSummarySnippets = extractRepoSummaryEntryFiles(context?.contextBundle);
  const localSnippets = extractLocalFileSnippets(context?.contextBundle);
  const jiraTickets = extractJiraSearchTickets(context?.contextBundle);
  const slackMessages = extractSlackSearchMessages(context?.contextBundle);
  const teamsMessages = extractTeamsSearchMessages(context?.contextBundle);
  const codeHostActivity = extractCodeHostSearch(context?.contextBundle);
  const confluencePages = extractConfluenceSearch(context?.contextBundle);
  const notionPages = extractNotionSearch(context?.contextBundle);
  const googleDocs = extractGoogleDocsSearch(context?.contextBundle);
  if (
    !context?.file &&
    context?.contextBundle === undefined &&
    manifestSnippets.length === 0 &&
    repoSummarySnippets.length === 0 &&
    localSnippets.length === 0 &&
    !jiraTickets &&
    !slackMessages &&
    !teamsMessages &&
    !codeHostActivity &&
    !confluencePages &&
    !notionPages &&
    !googleDocs
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
  if (manifestSnippets.length > 0) {
    lines.push("<manifest_files>");
    for (const file of manifestSnippets) {
      lines.push(`<file_content path="${file.path}">`);
      lines.push(file.content);
      lines.push("</file_content>");
    }
    lines.push("</manifest_files>");
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
  if (context?.contextBundle !== undefined) {
    lines.push("<graph_context>");
    lines.push(JSON.stringify(sanitizeContextBundleForLlm(context.contextBundle), null, 2));
    lines.push("</graph_context>");
  }
  lines.push("</attached_context>", "", message.trim());
  return lines.join("\n");
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

function extractZeroCloneFileSnippets(bundle: unknown): ManifestSnippet[] {
  if (!Array.isArray(bundle)) {
    return [];
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const data = (entry as { data?: { zeroClone?: { files?: ManifestSnippet[] } } }).data;
    const files = data?.zeroClone?.files;
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
  const match = jira.matchStrategy ?? (jira.issues.length > 0 ? "text" : "none");
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
  if (jira.issues.length === 0 && !jira.error) {
    lines.push("<empty>No matching Jira tickets found.</empty>");
  }
  for (const issue of jira.issues) {
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

function extractConfluenceSearch(bundle: unknown): ConfluenceSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "confluenceSearch");
}

function extractNotionSearch(bundle: unknown): NotionSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "notionSearch");
}

function extractGoogleDocsSearch(bundle: unknown): GoogleDocsSearchSnippet | undefined {
  return extractIntegrationSearch(bundle, "googleDocsSearch");
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
  const lines: string[] = ["<slack_messages>"];
  if (slack.error) {
    lines.push(`<error>${escapeXml(slack.error)}</error>`);
  }
  if (slack.query) {
    lines.push(`<search query="${escapeXml(slack.query)}"${slack.repoQuery ? ` repo="${escapeXml(slack.repoQuery)}"` : ""} />`);
  }
  if (slack.messages.length === 0 && !slack.error) {
    lines.push("<empty>No matching Slack messages found.</empty>");
  }
  for (const msg of slack.messages) {
    const channel = msg.channelName ? ` channel="${escapeXml(msg.channelName)}"` : "";
    const user = msg.userName ? ` user="${escapeXml(msg.userName)}"` : "";
    const url = msg.permalink ? ` url="${escapeXml(msg.permalink)}"` : "";
    lines.push(`<message ts="${escapeXml(msg.ts)}"${channel}${user}${url}>${escapeXml(msg.text)}</message>`);
  }
  lines.push("</slack_messages>");
  return lines;
}

function formatTeamsMessagesForLlm(teams: TeamsSearchSnippet): string[] {
  const lines: string[] = ["<teams_messages>"];
  if (teams.error) {
    lines.push(`<error>${escapeXml(teams.error)}</error>`);
  }
  if (teams.query) {
    lines.push(`<search query="${escapeXml(teams.query)}"${teams.repoQuery ? ` repo="${escapeXml(teams.repoQuery)}"` : ""} />`);
  }
  if (teams.messages.length === 0 && !teams.error) {
    lines.push("<empty>No matching Teams messages found.</empty>");
  }
  for (const msg of teams.messages) {
    const user = msg.fromUserName ? ` user="${escapeXml(msg.fromUserName)}"` : "";
    const url = msg.webUrl ? ` url="${escapeXml(msg.webUrl)}"` : "";
    lines.push(
      `<message created="${escapeXml(msg.createdAt)}"${user}${url}>${escapeXml(msg.body)}</message>`
    );
  }
  lines.push("</teams_messages>");
  return lines;
}

function formatConfluencePagesForLlm(confluence: ConfluenceSearchSnippet): string[] {
  const lines: string[] = ["<confluence_pages>"];
  if (confluence.error) {
    lines.push(`<error>${escapeXml(confluence.error)}</error>`);
  }
  if (confluence.cql) {
    lines.push(
      `<search cql="${escapeXml(confluence.cql)}"${confluence.repoQuery ? ` repo="${escapeXml(confluence.repoQuery)}"` : ""} />`
    );
  }
  if (confluence.pages.length === 0 && !confluence.error) {
    lines.push("<empty>No matching Confluence pages found.</empty>");
  }
  for (const page of confluence.pages) {
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
  const lines: string[] = ["<notion_pages>"];
  if (notion.error) {
    lines.push(`<error>${escapeXml(notion.error)}</error>`);
  }
  if (notion.query) {
    lines.push(
      `<search query="${escapeXml(notion.query)}"${notion.repoQuery ? ` repo="${escapeXml(notion.repoQuery)}"` : ""} />`
    );
  }
  if (notion.pages.length === 0 && !notion.error) {
    lines.push("<empty>No matching Notion pages found.</empty>");
  }
  for (const page of notion.pages) {
    const url = page.htmlUrl ? ` url="${escapeXml(page.htmlUrl)}"` : "";
    lines.push(
      `<page id="${escapeXml(page.id)}" updated="${escapeXml(page.updated)}"${url}>${escapeXml(page.title)}</page>`
    );
  }
  lines.push("</notion_pages>");
  return lines;
}

function formatGoogleDocsForLlm(googleDocs: GoogleDocsSearchSnippet): string[] {
  const lines: string[] = ["<google_docs>"];
  if (googleDocs.error) {
    lines.push(`<error>${escapeXml(googleDocs.error)}</error>`);
  }
  if (googleDocs.query) {
    lines.push(
      `<search query="${escapeXml(googleDocs.query)}"${googleDocs.repoQuery ? ` repo="${escapeXml(googleDocs.repoQuery)}"` : ""} />`
    );
  }
  if (googleDocs.documents.length === 0 && !googleDocs.error) {
    lines.push("<empty>No matching Google Docs found.</empty>");
  }
  for (const doc of googleDocs.documents) {
    const url = doc.htmlUrl ? ` url="${escapeXml(doc.htmlUrl)}"` : "";
    lines.push(
      `<document id="${escapeXml(doc.id)}" updated="${escapeXml(doc.updated)}"${url}>${escapeXml(doc.title)}</document>`
    );
  }
  lines.push("</google_docs>");
  return lines;
}

function formatCodeHostActivityForLlm(codeHost: CodeHostSearchSnippet): string[] {
  const lines: string[] = ["<code_host_activity>"];
  if (codeHost.error) {
    lines.push(`<error>${escapeXml(codeHost.error)}</error>`);
  }
  lines.push(`<provider>${escapeXml(codeHost.provider)}</provider>`);
  if (codeHost.repoQuery) {
    lines.push(`<repo>${escapeXml(codeHost.repoQuery)}</repo>`);
  }
  if (codeHost.pullRequests.length === 0 && codeHost.issues.length === 0 && !codeHost.error) {
    lines.push("<empty>No pull requests or issues found.</empty>");
  }
  for (const pr of codeHost.pullRequests) {
    const author = pr.author ? ` author="${escapeXml(pr.author)}"` : "";
    const url = pr.htmlUrl ? ` url="${escapeXml(pr.htmlUrl)}"` : "";
    lines.push(
      `<pull_request number="${pr.number}" state="${escapeXml(pr.state)}" merged="${pr.merged}" updated="${escapeXml(pr.updatedAt)}"${author}${url}>${escapeXml(pr.title)}</pull_request>`
    );
  }
  for (const issue of codeHost.issues) {
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
        zeroClone?: { files?: Array<{ path: string; content: string }> };
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
    let data = record.data;
    if (!data) {
      return entry;
    }

    if (data.entryFiles?.length) {
      data = {
        ...data,
        entryFiles: data.entryFiles.map((file) => ({
          path: file.path,
          byteLength: file.content.length,
          ...(file.truncated ? { truncated: true } : {})
        }))
      };
    }

    if (data.zeroClone?.files?.length) {
      data = {
        ...data,
        zeroClone: {
          ...data.zeroClone,
          files: data.zeroClone.files.map((file) => ({
            path: file.path,
            byteLength: file.content.length
          }))
        }
      };
    }

    if (data.localFiles?.files?.length) {
      data = {
        ...data,
        localFiles: {
          ...data.localFiles,
          files: data.localFiles.files.map((file) => ({
            path: file.path,
            byteLength: file.content.length,
            ...(file.lineRange ? { lineRange: file.lineRange } : {})
          }))
        }
      };
    }

    if (data.jiraSearch?.issues?.length) {
      data = {
        ...data,
        jiraSearch: {
          ...data.jiraSearch,
          issues: data.jiraSearch.issues.map((issue) =>
            issue && typeof issue === "object"
              ? {
                  key: (issue as { key?: string }).key,
                  status: (issue as { status?: string }).status,
                  issueType: (issue as { issueType?: string }).issueType
                }
              : issue
          )
        }
      };
    }

    if (data.slackSearch?.messages?.length) {
      data = {
        ...data,
        slackSearch: {
          ...data.slackSearch,
          messages: data.slackSearch.messages.map((msg) =>
            msg && typeof msg === "object"
              ? {
                  channelName: (msg as { channelName?: string }).channelName,
                  userName: (msg as { userName?: string }).userName,
                  ts: (msg as { ts?: string }).ts
                }
              : msg
          )
        }
      };
    }

    if (data.teamsSearch?.messages?.length) {
      data = {
        ...data,
        teamsSearch: {
          ...data.teamsSearch,
          messages: data.teamsSearch.messages.map((msg) =>
            msg && typeof msg === "object"
              ? {
                  fromUserName: (msg as { fromUserName?: string }).fromUserName,
                  createdAt: (msg as { createdAt?: string }).createdAt
                }
              : msg
          )
        }
      };
    }

    if (data.codeHostSearch) {
      data = {
        ...data,
        codeHostSearch: {
          ...data.codeHostSearch,
          pullRequests: data.codeHostSearch.pullRequests?.map((pr) =>
            pr && typeof pr === "object"
              ? {
                  number: (pr as { number?: number }).number,
                  title: (pr as { title?: string }).title,
                  state: (pr as { state?: string }).state
                }
              : pr
          ),
          issues: data.codeHostSearch.issues?.map((issue) =>
            issue && typeof issue === "object"
              ? {
                  number: (issue as { number?: number }).number,
                  title: (issue as { title?: string }).title,
                  state: (issue as { state?: string }).state
                }
              : issue
          )
        }
      };
    }

    if (data.confluenceSearch?.pages?.length) {
      data = {
        ...data,
        confluenceSearch: {
          ...data.confluenceSearch,
          pages: data.confluenceSearch.pages.map((page) =>
            page && typeof page === "object"
              ? {
                  id: (page as { id?: string }).id,
                  title: (page as { title?: string }).title,
                  updated: (page as { updated?: string }).updated
                }
              : page
          )
        }
      };
    }

    if (data.notionSearch?.pages?.length) {
      data = {
        ...data,
        notionSearch: {
          ...data.notionSearch,
          pages: data.notionSearch.pages.map((page) =>
            page && typeof page === "object"
              ? {
                  id: (page as { id?: string }).id,
                  title: (page as { title?: string }).title,
                  updated: (page as { updated?: string }).updated
                }
              : page
          )
        }
      };
    }

    if (data.googleDocsSearch?.documents?.length) {
      data = {
        ...data,
        googleDocsSearch: {
          ...data.googleDocsSearch,
          documents: data.googleDocsSearch.documents.map((doc) =>
            doc && typeof doc === "object"
              ? {
                  id: (doc as { id?: string }).id,
                  title: (doc as { title?: string }).title,
                  updated: (doc as { updated?: string }).updated
                }
              : doc
          )
        }
      };
    }

    if (data === record.data) {
      return entry;
    }
    return {
      ...entry,
      data
    };
  });
}
