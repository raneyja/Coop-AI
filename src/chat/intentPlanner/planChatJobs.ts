/**
 * Chat Intent jobs — split an unstructured ask into { capability, terms }[]
 * and route each job onto today's search machine (index, Slack/Teams, Jira, docs).
 *
 * Named tools are a floor. Implied locate/decision jobs still run.
 * Per-job terms stay distinct. Leading labels (Pager:, On-call:) are metadata.
 */
import type { IntegrationChatProvider } from "../types";
import { CHAT_INTENT_TOOL_PROVIDERS, type ChatIntentJob, type ChatIntentJobCapability } from "./types";
import { classifyRepoCodeIntent } from "../repoCodeIntent";

const TOOL_NAME_PATTERNS: Array<{ provider: IntegrationChatProvider; pattern: RegExp }> = [
  { provider: "jira", pattern: /\bjira\b/i },
  { provider: "slack", pattern: /\bslack\b/i },
  { provider: "teams", pattern: /\b(ms\s*)?teams\b/i },
  { provider: "confluence", pattern: /\bconfluence\b/i },
  { provider: "notion", pattern: /\bnotion\b/i },
  { provider: "google-docs", pattern: /\b(google\s*docs?|gdocs?)\b/i }
];

function namedToolsIn(message: string): IntegrationChatProvider[] {
  const named: IntegrationChatProvider[] = [];
  for (const { provider, pattern } of TOOL_NAME_PATTERNS) {
    if (pattern.test(message)) {
      named.push(provider);
    }
  }
  return CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => named.includes(provider));
}

const DECISION_PROVIDERS: IntegrationChatProvider[] = ["slack", "teams", "jira", "confluence"];
const DOCS_PROVIDERS: IntegrationChatProvider[] = ["confluence", "notion", "google-docs"];
const DISCUSSION_PROVIDERS: IntegrationChatProvider[] = ["slack", "teams"];

/** Leading operational labels — never search terms. */
const LEADING_ASK_LABEL =
  /^(?:(?:pager|on[-\s]?call|oncall|sev(?:erity)?\s*[0-3]|incident|outage|war[-\s]?room)\s*:\s*)+/i;

const DECISION_PHRASE =
  /\b(?:decid(?:e|ed|ing|es)|decision|already\s+(?:decide[d]?|agreed|said)|don(?:'t|’t)\s+mix|not\s+to\s+mix|do\s+not\s+mix|what\s+did\s+\w+\s+say)\b/i;

/**
 * Explicit request to search PRs/MRs/issues on a code host.
 * Topical "the SQL-injection PR" is NOT this.
 */
const EXPLICIT_CODE_HOST =
  /\b(?:search|list|show|find|open|recent)\s+(?:the\s+|our\s+|any\s+)?(?:PRs?|pull requests?|MRs?|merge requests?|issues?)\b/i;

const EXPLICIT_CODE_HOST_REPO =
  /\b(?:PRs?|pull requests?|MRs?|merge requests?)\s+(?:for|in|on)\s+(?:this\s+)?(?:repo|repository)\b/i;

const EXPLICIT_CODE_HOST_VENDOR =
  /\b(?:github|gitlab|bitbucket)\b.{0,48}\b(?:PRs?|pull requests?|MRs?|merge requests?|issues?)\b/i;

const EXPLICIT_PR_NUMBER = /\b(?:PR|pull request|merge request|MR)\s*#\s*\d+\b/i;

const NAMED_SOURCE_FILE =
  /(?:^|[\s`'"(\[]|\/)((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?=$|[\s`'")\],:;!?])/g;

const IDENTIFIER =
  /\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

const HYPHEN_TOPIC = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

const WHERE_IS_PHRASE =
  /\bwhere\s+is\s+(.+?)(?:\s+implemented|\s+defined|\s+located|\s+enforced|$)/i;

const MIX_PHRASES = [/\bdon(?:'t|’t)\s+mix\b/i, /\bnot\s+to\s+mix\b/i, /\bdo\s+not\s+mix\b/i];

const CLAUSE_SPLIT = /\s*(?:,\s+and\s+|;\s+|\s+and\s+did\s+we\b)\s*/i;

const TERM_STOP = new Set(
  [
    "where",
    "what",
    "which",
    "who",
    "how",
    "does",
    "did",
    "already",
    "this",
    "that",
    "into",
    "the",
    "and",
    "for",
    "from",
    "with",
    "about",
    "please",
    "find",
    "show",
    "check",
    "search",
    "pager",
    "oncall",
    "incident",
    "outage",
    "implemented",
    "defined",
    "located",
    "decide",
    "decided",
    "decision",
    "already",
    "we",
    "our",
    "was",
    "were",
    "have",
    "has",
    "been",
    "not",
    "dont",
    "don't",
    "mix",
    "prs",
    "pr",
    "mrs",
    "mr",
    "pull",
    "request",
    "requests",
    "merge",
    "issue",
    "issues",
    "slack",
    "jira",
    "teams",
    "confluence",
    "notion",
    "google",
    "docs",
    "gdocs"
  ].map((w) => w.toLowerCase())
);

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
    EXPLICIT_PR_NUMBER.test(q)
  );
}

export function decisionPhrasePresent(message: string): boolean {
  return DECISION_PHRASE.test(stripLeadingAskLabels(message));
}

/**
 * True when jobs should skip the LLM tool-wander loop: integrations/docs/code-host
 * run on prefetch, then one writer. Locate-only still uses today's agent hunt.
 */
export function jobsSkipAgentLoop(jobs: ChatIntentJob[] | undefined): boolean {
  return (jobs ?? []).some(
    (job) =>
      job.capability === "decision" || job.capability === "docs" || job.capability === "code-host"
  );
}

export function locateJobTerms(jobs: ChatIntentJob[] | undefined): string[] {
  return uniqueTerms(
    (jobs ?? []).filter((job) => job.capability === "locate").flatMap((job) => job.terms)
  );
}

export function extraTermsForIntegration(
  jobs: ChatIntentJob[] | undefined,
  provider: IntegrationChatProvider
): string[] | undefined {
  if (!jobs?.length) {
    return undefined;
  }
  const terms: string[] = [];
  for (const job of jobs) {
    if (job.capability === "decision" && DECISION_PROVIDERS.includes(provider)) {
      terms.push(...job.terms);
    }
    if (job.capability === "docs" && DOCS_PROVIDERS.includes(provider)) {
      terms.push(...job.terms);
    }
  }
  const unique = uniqueTerms(terms);
  return unique.length > 0 ? unique : undefined;
}

export function hasCodeHostJob(jobs: ChatIntentJob[] | undefined): boolean {
  return (jobs ?? []).some((job) => job.capability === "code-host");
}

/**
 * Tools implied by jobs. Named tools are a floor (always kept).
 * Implied decision (phrasing, not merely naming Slack) adds Slack + Jira,
 * plus Teams / Confluence when connected. Docs/discussion siblings stay on
 * shared lists — never a GitHub-only or Slack-only fork.
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
    if (options.connectedTools.includes("teams")) {
      tools.add("teams");
    }
    if (options.connectedTools.includes("confluence")) {
      tools.add("confluence");
    }
  }
  const hasDocsJob = options.jobs.some((job) => job.capability === "docs");
  if (hasDocsJob && options.namedTools.length === 0) {
    for (const provider of DOCS_PROVIDERS) {
      if (options.connectedTools.includes(provider)) {
        tools.add(provider);
      }
    }
  }
  return CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => tools.has(provider));
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
  const named = input.namedTools ?? namedToolsIn(raw);
  const clauses = splitAskClauses(stripped);
  const jobs: ChatIntentJob[] = [];

  const decisionImplied = decisionPhrasePresent(stripped);
  const locateGlobal = classifyRepoCodeIntent(stripped).action === "locate";

  for (const clause of clauses) {
    const capability = classifyClause(clause, named);
    if (!capability) {
      continue;
    }
    const terms = extractJobTerms(clause, capability, input.activeFile);
    if (terms.length === 0 && capability !== "code-host") {
      continue;
    }
    pushJob(jobs, capability, terms);
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
      const terms = extractJobTerms(stripToolNames(stripped), "decision", undefined);
      pushJob(jobs, "decision", terms.length ? terms : extractJobTerms(stripped, "decision", undefined));
    }
  }
  if (named.some((tool) => DOCS_PROVIDERS.includes(tool))) {
    if (!jobs.some((job) => job.capability === "docs")) {
      const terms = extractJobTerms(stripToolNames(stripped), "docs", undefined);
      pushJob(jobs, "docs", terms.length ? terms : extractJobTerms(stripped, "docs", undefined));
    }
  }

  if (wantsExplicitCodeHostSearch(stripped) && !jobs.some((job) => job.capability === "code-host")) {
    pushJob(jobs, "code-host", extractJobTerms(stripped, "code-host", undefined));
  }

  return jobs.filter((job) => job.capability === "code-host" || job.terms.length > 0);
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
  if (named.some((tool) => DOCS_PROVIDERS.includes(tool)) && namedDocsInClause(clause)) {
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

  for (const match of cleaned.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g)) {
    const quoted = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (quoted) {
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

function pushJob(jobs: ChatIntentJob[], capability: ChatIntentJobCapability, terms: string[]): void {
  const existing = jobs.find((job) => job.capability === capability);
  if (existing) {
    existing.terms = uniqueTerms([...existing.terms, ...terms]).slice(0, 8);
    return;
  }
  jobs.push({ capability, terms: uniqueTerms(terms).slice(0, 8) });
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim();
    if (!term || term.length < 2) {
      continue;
    }
    const key = term.toLowerCase();
    if (TERM_STOP.has(key) || seen.has(key)) {
      continue;
    }
    if (LEADING_ASK_LABEL.test(`${term}:`)) {
      continue;
    }
    seen.add(key);
    out.push(term);
  }
  return out;
}
