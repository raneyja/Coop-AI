/**
 * Chat Intent jobs — split an unstructured ask into { capability, terms }[]
 * and route each job onto today's search machine (index, Slack/Teams, Jira, docs).
 *
 * Named tools are a floor. Implied locate/decision jobs still run.
 * Per-job terms stay distinct. Leading labels (Pager:, On-call:) are metadata.
 */
import type { IntegrationChatProvider } from "../types";
import {
  CHAT_INTENT_TOOL_PROVIDERS,
  type ChatIntentJob,
  type ChatIntentJobCapability,
  type ChatIntentJobVerb,
  type ChatIntentTask,
  type ChatIntentTodo
} from "./types";
import { classifyRepoCodeIntent } from "../repoCodeIntent";
import { isTeamsComingSoon, omitTeamsWhileComingSoon } from "../../integrations/teamsAvailability";
import { isRepoSlugTerm } from "./repoSlugTerm";
import { SEARCH_MEANING_STOP, uniqueMeaningTerms } from "./searchMeaningStop";

const TOOL_NAME_PATTERNS: Array<{ provider: IntegrationChatProvider; pattern: RegExp }> = [
  { provider: "jira", pattern: /\bjira\b/i },
  { provider: "slack", pattern: /\bslack\b/i },
  { provider: "teams", pattern: /\b(ms\s*)?teams\b/i },
  { provider: "confluence", pattern: /\bconfluence\b/i },
  { provider: "notion", pattern: /\bnotion\b/i },
  { provider: "google-docs", pattern: /\b(google\s*docs?|gdocs?)\b/i }
];

/** Literal integration names, shared by rules and job planning. */
export function detectExplicitlyNamedTools(message: string): IntegrationChatProvider[] {
  const named: IntegrationChatProvider[] = [];
  for (const { provider, pattern } of TOOL_NAME_PATTERNS) {
    if (pattern.test(message)) {
      named.push(provider);
    }
  }
  return omitTeamsWhileComingSoon(
    CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => named.includes(provider))
  );
}

/** Decision phrasing searches discussion + tickets — not docs unless named or a docs job. */
export const DECISION_JOB_PROVIDERS: readonly IntegrationChatProvider[] = [
  "slack",
  "teams",
  "jira"
];
export const DOCS_JOB_PROVIDERS: readonly IntegrationChatProvider[] = [
  "confluence",
  "notion",
  "google-docs"
];
const DISCUSSION_PROVIDERS: readonly IntegrationChatProvider[] = ["slack", "teams"];

/** Leading operational labels — never search terms. */
const LEADING_ASK_LABEL =
  /^(?:(?:pager|on[-\s]?call|oncall|sev(?:erity)?\s*[0-3]|incident|outage|war[-\s]?room)\s*:\s*)+/i;

const DECISION_PHRASE =
  /\b(?:decid(?:e|ed|ing|es)|decision|already\s+(?:decide[d]?|agreed|said)|don(?:'t|’t)\s+mix|not\s+to\s+mix|do\s+not\s+mix|what\s+(?:did|does)\s+.+?\s+say|where\s+did\s+.+?\s+(?:decide|agree))\b/i;

/**
 * Explicit request to search PRs/MRs/issues on a code host.
 * Topical "the SQL-injection PR" is NOT this.
 */
const EXPLICIT_CODE_HOST =
  /\b(?:search|list|show|find|open|recent)\s+(?:the\s+|our\s+|any\s+)?(?:(?:github|gitlab|bitbucket)\s+)?(?:PRs?|pull requests?|MRs?|merge requests?|issues)\b/i;

const EXPLICIT_CODE_HOST_REPO =
  /\b(?:PRs?|pull requests?|MRs?|merge requests?)\s+(?:for|in|on)\s+(?:this\s+)?(?:repo|repository)\b/i;

const EXPLICIT_CODE_HOST_VENDOR =
  /\b(?:github|gitlab|bitbucket)\b.{0,48}\b(?:PRs?|pull requests?|MRs?|merge requests?|issues?)\b/i;

const EXPLICIT_PR_NUMBER = /\b(?:PR|pull request|merge request|MR)\s*#\s*\d+\b/i;
const EXPLICIT_ISSUE_NUMBER = /\bissue\s*#\s*\d+\b/i;

const NAMED_SOURCE_FILE =
  /(?:^|[\s`'"(\[]|\/)((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?=$|[\s`'")\],:;!?])/g;

const IDENTIFIER =
  /\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

const HYPHEN_TOPIC = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

const WHERE_IS_PHRASE =
  /\bwhere\s+is\s+(.+?)(?:\s+implemented|\s+defined|\s+located|\s+enforced|$)/i;

const MIX_PHRASES = [/\bdon(?:'t|’t)\s+mix\b/i, /\bnot\s+to\s+mix\b/i, /\bdo\s+not\s+mix\b/i];

const PEEL_AUTH = /\bpeel(?:ing)?\s+auth(?:entication)?\b/i;

const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

const ABOUT_TOPIC = /\babout\s+(.+?)(?:\?|$)/i;

const CLAUSE_SPLIT =
  /\s*(?:,\s+and\s+|;\s+(?:and\s+)?|[—–]\s+(?:and\s+)?(?=(?:did|what|where)\b)|\s+and\s+(?=(?:did\b|what\s+(?:did|does)\b|where\s+did\b)))\s*/i;

const TERM_STOP = SEARCH_MEANING_STOP;

/**
 * Recency-only language. A real topic (SQL-injection, COOP-101) still wins —
 * those words are sort, not the query.
 */
const RECENCY_PHRASE =
  /\b(?:most\s+recent(?:ly)?|latest|newest|last\s+(?:post|posts|message|messages|ticket|tickets|page|pages|doc|docs|document|documents|item|items))\b/i;

export type ChatAskAssignmentKind = "none" | "latest" | "search";

export function hasRecencyLanguage(message: string): boolean {
  return RECENCY_PHRASE.test(stripLeadingAskLabels(message));
}

/**
 * Shared assignment: leftover filler is not a topic; recency-only is `latest`.
 */
export function classifyChatAskAssignment(
  message: string,
  useRepo?: string
): { kind: ChatAskAssignmentKind } {
  const text = stripLeadingAskLabels(message ?? "").trim();
  if (text.length < 3 || isRepoSlugTerm(text, useRepo)) {
    return { kind: "none" };
  }
  const topic = extractJobTerms(stripToolNames(text), "decision", undefined);
  if (topic.length > 0) {
    return { kind: "search" };
  }
  if (hasRecencyLanguage(text)) {
    return { kind: "latest" };
  }
  return { kind: "search" };
}

export type PlanChatJobsInput = {
  message: string;
  activeFile?: string;
  connectedTools?: IntegrationChatProvider[];
  namedTools?: IntegrationChatProvider[];
};

export function stripLeadingAskLabels(message: string): string {
  return message.replace(LEADING_ASK_LABEL, "").trim();
}

export function wantsExplicitCodeHostSearch(message: string): boolean {
  const q = stripLeadingAskLabels(message);
  if (!q) {
    return false;
  }
  return (
    EXPLICIT_CODE_HOST.test(q) ||
    EXPLICIT_CODE_HOST_REPO.test(q) ||
    EXPLICIT_CODE_HOST_VENDOR.test(q) ||
    EXPLICIT_PR_NUMBER.test(q) ||
    EXPLICIT_ISSUE_NUMBER.test(q)
  );
}

export function decisionPhrasePresent(message: string): boolean {
  return DECISION_PHRASE.test(stripLeadingAskLabels(message));
}

/**
 * Start Slack/Jira prefetch in parallel with the base fetch only when there is
 * no locate job. Locate must run first (or with a reserved budget), never after
 * five sequential doc searches have exhausted the gather window.
 */
export function shouldOverlapIntegrationPrefetch(jobs: ChatIntentJob[] | undefined): boolean {
  const list = jobs ?? [];
  if (list.length === 0) {
    return false;
  }
  return locateJobTerms(list).length === 0;
}

export function locateJobTerms(jobs: ChatIntentJob[] | undefined): string[] {
  return uniqueTerms(
    (jobs ?? []).filter((job) => job.capability === "locate").flatMap((job) => job.terms)
  );
}

function matchingIntegrationJobs(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): ChatIntentJob[] {
  return (jobs ?? []).filter(
    (job) =>
      (job.capability === "decision" && DECISION_JOB_PROVIDERS.includes(provider)) ||
      (job.capability === "docs" && DOCS_JOB_PROVIDERS.includes(provider))
  );
}

export function jobVerbForIntegration(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): ChatIntentJobVerb {
  const matching = matchingIntegrationJobs(jobs, provider);
  if (matching.some((job) => job.verb === "latest")) {
    return "latest";
  }
  return "search";
}

export function extraTermsForIntegration(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): string[] | undefined {
  if (!jobs?.length) {
    return undefined;
  }
  const matching = matchingIntegrationJobs(jobs, provider);
  if (matching.length === 0) {
    return undefined;
  }
  const unique = uniqueTerms(matching.flatMap((job) => job.terms));
  if (matching.some((job) => job.verb === "latest")) {
    return unique;
  }
  return unique.length > 0 ? unique : undefined;
}

/** Decision/docs job terms as one search string — never the locate symbol. */
export function integrationJobQuery(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): string | undefined {
  const terms = extraTermsForIntegration(jobs, provider);
  if (!terms?.length) {
    return undefined;
  }
  return terms.slice(0, 6).join(" ");
}

export function integrationFillQueries(
  jobs: ChatIntentJob[] | undefined,
  tools: IntegrationChatProvider[] | undefined
): Partial<Record<IntegrationChatProvider, string>> {
  const out: Partial<Record<IntegrationChatProvider, string>> = {};
  for (const provider of tools ?? []) {
    const query = integrationJobQuery(jobs, provider);
    if (query) {
      out[provider] = query;
    }
  }
  return out;
}

export function hasIntegrationJob(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): boolean {
  return (jobs ?? []).some(
    (job) =>
      (job.capability === "decision" && DECISION_JOB_PROVIDERS.includes(provider)) ||
      (job.capability === "docs" && DOCS_JOB_PROVIDERS.includes(provider))
  );
}

export function codeHostJobTerms(jobs: ChatIntentJob[] | undefined): string[] {
  return uniqueTerms(
    (jobs ?? []).filter((job) => job.capability === "code-host").flatMap((job) => job.terms)
  );
}

export function hasCodeHostJob(jobs: ChatIntentJob[] | undefined): boolean {
  return (jobs ?? []).some((job) => job.capability === "code-host");
}

/** Exact query contract handed to code-host execution. */
export function codeHostJobQuery(jobs: ChatIntentJob[] | undefined): string | undefined {
  const terms = codeHostJobTerms(jobs);
  return terms.length > 0 ? terms.join(" ") : undefined;
}

export function codeHostJobVerb(jobs: ChatIntentJob[] | undefined): ChatIntentJobVerb {
  if ((jobs ?? []).some((job) => job.capability === "code-host" && job.verb === "latest")) {
    return "latest";
  }
  return "search";
}

/**
 * Tools implied by jobs. Named tools are a floor (always kept).
 * Implied decision (phrasing, not merely naming Slack) adds Slack + Jira,
 * plus Teams when connected and not coming-soon. Do not auto-attach
 * Confluence / Notion / Google Docs unless the user named them or a docs job
 * exists. Docs/discussion siblings stay on shared lists — never a GitHub-only
 * or Slack-only fork.
 */
export function toolsImpliedByJobs(options: {
  jobs: ChatIntentJob[];
  namedTools: IntegrationChatProvider[];
  connectedTools: IntegrationChatProvider[];
  decisionImplied: boolean;
}): IntegrationChatProvider[] {
  const tools = new Set<IntegrationChatProvider>(options.namedTools);
  if (options.decisionImplied) {
    tools.add("slack");
    tools.add("jira");
    if (!isTeamsComingSoon() && options.connectedTools.includes("teams")) {
      tools.add("teams");
    }
  }
  const hasDocsJob = options.jobs.some((job) => job.capability === "docs");
  if (hasDocsJob && options.namedTools.length === 0) {
    for (const provider of DOCS_JOB_PROVIDERS) {
      if (options.connectedTools.includes(provider)) {
        tools.add(provider);
      }
    }
  }
  return omitTeamsWhileComingSoon(
    CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => tools.has(provider))
  );
}

const TASK_TOOL_LABEL: Record<IntegrationChatProvider, string> = {
  jira: "Jira",
  slack: "Slack",
  teams: "Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

/**
 * Expand jobs into the steps the turn will run. One locate step, then one
 * search step per tool that job owns. These become the planned todos.
 */
export function planChatTasks(options: {
  jobs: ChatIntentJob[];
  tools: IntegrationChatProvider[];
}): ChatIntentTask[] {
  const tasks: ChatIntentTask[] = [];
  for (const job of options.jobs) {
    const query = job.terms.join(" ").trim();
    const preview = job.terms.slice(0, 3).join(", ");
    const verb = job.verb === "latest" ? "latest" : "search";
    if (job.capability === "locate") {
      tasks.push({
        id: "locate-repo",
        job: "locate",
        kind: "search-repo",
        title: preview ? `Find ${preview} in the repo` : "Find named code in the repo",
        query,
        verb: "search",
        tool: "repo"
      });
      continue;
    }
    if (job.capability === "code-host") {
      tasks.push({
        id: "code-host",
        job: "code-host",
        kind: "search-code-host",
        title:
          verb === "latest"
            ? "Latest pull requests and issues"
            : preview
              ? `Search pull requests for ${preview}`
              : "Search pull requests",
        query,
        verb,
        tool: "code-host"
      });
      continue;
    }
    const providers =
      job.capability === "docs"
        ? options.tools.filter((tool) => DOCS_JOB_PROVIDERS.includes(tool))
        : options.tools.filter((tool) => DECISION_JOB_PROVIDERS.includes(tool));
    const fallback =
      job.capability === "docs" ? [...DOCS_JOB_PROVIDERS] : (["slack", "jira"] as const);
    const tools = providers.length > 0 ? providers : [...fallback];
    for (const tool of tools) {
      tasks.push({
        id: `${job.capability}-${tool}`,
        job: job.capability,
        kind: "search-integration",
        title:
          verb === "latest"
            ? `Latest ${TASK_TOOL_LABEL[tool]}`
            : preview
              ? `Search ${TASK_TOOL_LABEL[tool]} for ${preview}`
              : `Search ${TASK_TOOL_LABEL[tool]}`,
        query: verb === "latest" ? "latest" : query,
        verb,
        tool
      });
    }
  }
  return tasks;
}

export function planChatTodos(tasks: ChatIntentTask[]): ChatIntentTodo[] {
  return tasks.map((task) => ({ id: task.id, content: task.title }));
}

/** Trace Decision must not steal a locate + “did we decide” compound ask. */
export function interpreterJobsClaimTurn(
  jobs: ChatIntentJob[] | undefined,
  workflow: string | undefined,
  decisionImplied: boolean
): boolean {
  if (workflow !== "trace-decision" || !decisionImplied) {
    return false;
  }
  const capabilities = new Set((jobs ?? []).map((job) => job.capability));
  return capabilities.has("locate") && capabilities.has("decision");
}

export function mergeChatIntentTools(
  named: IntegrationChatProvider[],
  implied: IntegrationChatProvider[]
): IntegrationChatProvider[] {
  const seen = new Set<IntegrationChatProvider>([...named, ...implied]);
  return CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => seen.has(provider));
}

export function planChatJobs(input: PlanChatJobsInput): ChatIntentJob[] {
  const raw = input.message?.trim() ?? "";
  if (raw.length < 8) {
    return [];
  }
  const stripped = stripLeadingAskLabels(raw) || raw;
  const named = input.namedTools ?? detectExplicitlyNamedTools(raw);
  const clauses = splitAskClauses(stripped);
  const jobs: ChatIntentJob[] = [];

  const decisionImplied = decisionPhrasePresent(stripped);
  const locateGlobal = classifyRepoCodeIntent(stripped).action === "locate";
  const assignment = classifyChatAskAssignment(stripped);

  for (const clause of clauses) {
    const capability = classifyClause(clause, named);
    if (!capability) {
      continue;
    }
    const terms = extractJobTerms(clause, capability, input.activeFile);
    if (terms.length === 0 && !(assignment.kind === "latest" && capability !== "locate")) {
      continue;
    }
    pushJob(
      jobs,
      capability,
      terms,
      assignment.kind === "latest" && terms.length === 0 ? "latest" : "search"
    );
  }

  if (locateGlobal && !jobs.some((job) => job.capability === "locate")) {
    const locateClause =
      clauses.find((clause) => classifyRepoCodeIntent(clause).action === "locate") ?? stripped;
    const terms = extractJobTerms(locateClause, "locate", input.activeFile);
    if (terms.length > 0) {
      pushJob(jobs, "locate", terms);
    }
  }

  if (decisionImplied && !jobs.some((job) => job.capability === "decision")) {
    const decisionClause = clauses.find((clause) => DECISION_PHRASE.test(clause)) ?? stripped;
    const terms = extractJobTerms(decisionClause, "decision", undefined);
    if (terms.length > 0) {
      pushJob(jobs, "decision", terms);
    }
  }

  // Named tools are a floor: ensure a job covers them even without decide/docs verbs.
  if (named.some((tool) => DISCUSSION_PROVIDERS.includes(tool) || tool === "jira")) {
    if (!jobs.some((job) => job.capability === "decision")) {
      if (assignment.kind === "latest") {
        pushJob(jobs, "decision", [], "latest");
      } else {
        const terms = extractJobTerms(stripToolNames(stripped), "decision", undefined);
        pushJob(
          jobs,
          "decision",
          terms.length ? terms : extractJobTerms(stripped, "decision", undefined)
        );
      }
    }
  }
  if (named.some((tool) => DOCS_JOB_PROVIDERS.includes(tool))) {
    if (!jobs.some((job) => job.capability === "docs")) {
      if (assignment.kind === "latest") {
        pushJob(jobs, "docs", [], "latest");
      } else {
        const terms = extractJobTerms(stripToolNames(stripped), "docs", undefined);
        pushJob(jobs, "docs", terms.length ? terms : extractJobTerms(stripped, "docs", undefined));
      }
    }
  }

  if (wantsExplicitCodeHostSearch(stripped) && !jobs.some((job) => job.capability === "code-host")) {
    const terms = extractJobTerms(stripped, "code-host", undefined);
    pushJob(
      jobs,
      "code-host",
      terms,
      assignment.kind === "latest" && terms.length === 0 ? "latest" : "search"
    );
  }

  dropLocateTermsFromDecision(jobs);
  return jobs.filter((job) => job.verb === "latest" || job.terms.length > 0);
}

function classifyClause(
  clause: string,
  named: IntegrationChatProvider[]
): ChatIntentJobCapability | undefined {
  if (wantsExplicitCodeHostSearch(clause)) {
    return "code-host";
  }
  if (DECISION_PHRASE.test(clause)) {
    return "decision";
  }
  if (named.some((tool) => DOCS_JOB_PROVIDERS.includes(tool)) && namedDocsInClause(clause)) {
    return "docs";
  }
  if (classifyRepoCodeIntent(clause).action === "locate") {
    return "locate";
  }
  return undefined;
}

function namedDocsInClause(clause: string): boolean {
  return /\b(confluence|notion|google\s*docs?|gdocs?)\b/i.test(clause);
}

function splitAskClauses(text: string): string[] {
  const parts = text
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim().replace(/^[\-–—]+\s*|\s*[\-–—]+$/g, "").trim())
    .filter((part) => part.length > 2);
  return parts.length > 0 ? parts : [text];
}

function extractJobTerms(
  clause: string,
  capability: ChatIntentJobCapability,
  activeFile: string | undefined
): string[] {
  const terms: string[] = [];
  const cleaned = stripToolNames(stripLeadingAskLabels(clause));

  if (capability === "code-host") {
    for (const match of cleaned.matchAll(
      /\b(PR|pull request|merge request|MR|issue)\s*#?\s*(\d+)\b/gi
    )) {
      terms.push(`${/^issue$/i.test(match[1]) ? "Issue" : "PR"} #${match[2]}`);
    }
    const topic = compactPhrase(cleaned);
    if (topic) {
      terms.push(topic);
    }
  }

  for (const match of cleaned.matchAll(/"([^"]{1,80})"|`([^`]{1,80})`|(?<![A-Za-z0-9])'([^'\n]{1,64})'(?![A-Za-z])/g)) {
    const quoted = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    // Contractions ("I'm", "what's") are not quoted search terms; neither is a whole sentence.
    if (quoted && quoted.split(/\s+/).length <= 6 && !/[?.!]/.test(quoted)) {
      terms.push(quoted);
    }
  }

  NAMED_SOURCE_FILE.lastIndex = 0;
  for (const match of cleaned.matchAll(NAMED_SOURCE_FILE)) {
    const file = match[1]?.trim();
    if (file && !isBlockedFileExt(file)) {
      terms.push(file);
    }
  }

  IDENTIFIER.lastIndex = 0;
  for (const match of cleaned.matchAll(IDENTIFIER)) {
    const id = match[0];
    if (id && !TERM_STOP.has(id.toLowerCase()) && !/^Pager$/i.test(id)) {
      terms.push(id);
    }
  }

  HYPHEN_TOPIC.lastIndex = 0;
  for (const match of cleaned.matchAll(HYPHEN_TOPIC)) {
    terms.push(match[0]);
  }

  ISSUE_KEY.lastIndex = 0;
  for (const match of cleaned.matchAll(ISSUE_KEY)) {
    terms.push(match[0].toUpperCase());
  }

  if (capability === "locate") {
    const whereIs = cleaned.match(WHERE_IS_PHRASE);
    if (whereIs?.[1]) {
      const phrase = compactPhrase(whereIs[1]);
      if (phrase) {
        terms.push(phrase);
      }
    }
    const fileName = activeFile?.trim().split(/[/\\]/).pop();
    if (fileName) {
      terms.push(fileName);
    }
  }

  if (capability === "decision") {
    for (const pattern of MIX_PHRASES) {
      const hit = cleaned.match(pattern);
      if (hit) {
        terms.push(hit[0].replace(/’/g, "'").toLowerCase());
      }
    }
    const peel = cleaned.match(PEEL_AUTH);
    if (peel?.[0]) {
      terms.push(peel[0].toLowerCase().replace(/\s+/g, " "));
    }
    const hasDistinctiveTopic = terms.some(
      (term) =>
        PEEL_AUTH.test(term) ||
        /^[A-Z][A-Z0-9]+-\d+$/.test(term) ||
        /[a-z0-9]+-[a-z0-9-]+/i.test(term)
    );
    if (!hasDistinctiveTopic) {
      const about = cleaned.match(ABOUT_TOPIC);
      const phrase = compactPhrase(about?.[1] ?? cleaned);
      if (phrase) {
        terms.push(phrase);
      }
    }
  }

  return uniqueTerms(terms).slice(0, 8);
}

function compactPhrase(value: string): string | undefined {
  const compact = value
    .replace(/[—–]/g, " ")
    .replace(/[^a-zA-Z0-9_./\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact || compact.length < 3) {
    return undefined;
  }
  const tokens = compact.split(/\s+/).filter((token) => !TERM_STOP.has(token.toLowerCase()));
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.slice(0, 4).join(" ");
}

function stripToolNames(text: string): string {
  return text
    .replace(/\b(ms\s*)?teams\b/gi, " ")
    .replace(/\bmicrosoft\s+teams\b/gi, " ")
    .replace(/\b(google\s*docs?|gdocs?)\b/gi, " ")
    .replace(/\b(jira|slack|confluence|notion)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlockedFileExt(file: string): boolean {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return ["com", "org", "net", "edu", "gov", "io", "dev", "ai"].includes(ext);
}

function dropLocateTermsFromDecision(jobs: ChatIntentJob[]): void {
  const locateExact = new Set(
    jobs
      .filter((job) => job.capability === "locate")
      .flatMap((job) => job.terms)
      .map((term) => term.toLowerCase())
  );
  if (locateExact.size === 0) {
    return;
  }
  for (const job of jobs) {
    if (job.capability !== "decision") {
      continue;
    }
    job.terms = job.terms.filter((term) => !locateExact.has(term.toLowerCase()));
  }
}

function pushJob(
  jobs: ChatIntentJob[],
  capability: ChatIntentJobCapability,
  terms: string[],
  verb: ChatIntentJobVerb = "search"
): void {
  const unique = uniqueTerms(terms).slice(0, 8);
  const resolvedVerb = unique.length > 0 ? "search" : verb;
  const existing = jobs.find((job) => job.capability === capability);
  if (existing) {
    existing.terms = uniqueTerms([...existing.terms, ...unique]).slice(0, 8);
    existing.verb = existing.terms.length > 0 ? "search" : resolvedVerb;
    return;
  }
  jobs.push({ capability, verb: resolvedVerb, terms: unique });
}

export function uniqueTerms(terms: string[]): string[] {
  return uniqueMeaningTerms(terms).filter((term) => !LEADING_ASK_LABEL.test(`${term}:`));
}
