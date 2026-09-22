import { CODE_HOST_PROVIDERS } from "../api/codeHosts/types";
import type { IntegrationChatProvider } from "../chat/types";
import type { RepoContext } from "../chat/types";
import { isExplicitRepoScope } from "../context/contextScope";
import { repoNameVariants } from "../context/docSearchQuery";
import { isOsAbsoluteDiskPath } from "../context/outsideWorkspaceFile";

/**
 * Enterprise trust: assembled code evidence must belong to the active Use-repo.
 * Soft prompt text is not enough — callers must drop foreign active-file chips
 * and refuse wrong-repo / local-workspace bodies before synthesis.
 */

export type RepoCoords = {
  owner?: string;
  repo?: string;
  repoId?: string;
  provider?: string;
};

export type CodeEvidenceSnippet = {
  path: string;
  repoId?: string;
  content?: string;
};

function normalizeSlug(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

/** Parse `github:owner/repo` or bare `owner/repo` into owner/repo. */
export function parseRepoIdCoords(repoId: string | undefined): { owner?: string; repo?: string } {
  const raw = repoId?.trim();
  if (!raw) {
    return {};
  }
  const withoutProvider = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const [owner, repo] = withoutProvider.split("/").map((part) => part.trim());
  if (!owner || !repo) {
    return {};
  }
  return { owner, repo };
}

export function repoSlug(coords: RepoCoords): string | undefined {
  const fromParts = normalizeSlug(coords.owner) && normalizeSlug(coords.repo)
    ? `${normalizeSlug(coords.owner)}/${normalizeSlug(coords.repo)}`
    : undefined;
  if (fromParts) {
    return fromParts;
  }
  const parsed = parseRepoIdCoords(coords.repoId);
  if (normalizeSlug(parsed.owner) && normalizeSlug(parsed.repo)) {
    return `${normalizeSlug(parsed.owner)}/${normalizeSlug(parsed.repo)}`;
  }
  return undefined;
}

export function sameRepoCoords(left: RepoCoords, right: RepoCoords): boolean {
  const a = repoSlug(left);
  const b = repoSlug(right);
  if (!a || !b) {
    return false;
  }
  return a === b;
}

/**
 * True when an evidence snippet's repoId matches the active Use-repo.
 * Snippets without repoId are treated as active-repo only when `allowMissingRepoId`
 * is true (legacy search hits that were already scoped by the search call).
 */
export function snippetBelongsToActiveRepo(
  snippet: Pick<CodeEvidenceSnippet, "repoId">,
  active: RepoCoords,
  options?: { allowMissingRepoId?: boolean }
): boolean {
  const activeSlug = repoSlug(active);
  if (!activeSlug) {
    return false;
  }
  const evidenceId = snippet.repoId?.trim();
  if (!evidenceId) {
    return options?.allowMissingRepoId !== false;
  }
  return sameRepoCoords({ repoId: evidenceId }, active);
}

/** Keep only snippets whose repoId matches the active Use-repo. */
export function filterCodeEvidenceToActiveRepo<T extends CodeEvidenceSnippet>(
  files: T[],
  active: RepoCoords,
  options?: { allowMissingRepoId?: boolean }
): T[] {
  return files.filter((file) => snippetBelongsToActiveRepo(file, active, options));
}

/**
 * Active-file chip is foreign to Use-repo when:
 * - chip carries a different owner/repo than Use-repo, or
 * - chip is a local workspace/git buffer while Use-repo is a different remote repo
 *   (`localWorkspaceMatchesUseRepo === false`).
 *
 * Outside-workspace Downloads files are left alone (explicit local attach).
 */
export function isForeignActiveFileForUseRepo(
  ctx: Pick<RepoContext, "owner" | "repo" | "file" | "fileSource" | "scope">,
  options?: {
    fileOwner?: string;
    fileRepo?: string;
    /** False when the open VS Code folder is not a clone/VFS of Use-repo. */
    localWorkspaceMatchesUseRepo?: boolean;
  }
): boolean {
  const useOwner = ctx.owner?.trim();
  const useRepo = ctx.repo?.trim();
  const file = ctx.file?.trim();
  if (!useOwner || !useRepo || !file) {
    return false;
  }
  if (isOsAbsoluteDiskPath(file) || ctx.fileSource === "external") {
    return false;
  }

  const fileOwner = options?.fileOwner?.trim() || undefined;
  const fileRepo = options?.fileRepo?.trim() || undefined;
  if (fileOwner && fileRepo && !sameRepoCoords({ owner: fileOwner, repo: fileRepo }, { owner: useOwner, repo: useRepo })) {
    return true;
  }

  const localSource = ctx.fileSource === "workspace" || ctx.fileSource === "git";
  if (localSource && options?.localWorkspaceMatchesUseRepo === false) {
    return true;
  }

  return false;
}

function clearActiveFileFields(ctx: RepoContext): RepoContext {
  return {
    ...ctx,
    file: undefined,
    fileSource: undefined,
    selectedLines: undefined,
    selectedSymbol: undefined,
    languageId: undefined,
    scope: ctx.owner?.trim() && ctx.repo?.trim() ? "repo" : ctx.scope,
    contextWarning: undefined
  };
}

/**
 * Drop active-file evidence when it belongs to another repo than Use-repo.
 * Prefer silent drop for Gaps / Understand / structure — never silently merge foreign code.
 */
export function dropForeignActiveFileEvidence(
  ctx: RepoContext,
  options?: {
    fileOwner?: string;
    fileRepo?: string;
    localWorkspaceMatchesUseRepo?: boolean;
  }
): RepoContext {
  if (!isForeignActiveFileForUseRepo(ctx, options)) {
    return ctx;
  }
  return clearActiveFileFields(ctx);
}

/**
 * Quick actions that must never treat a foreign open editor as the audit target.
 * Understand Repo already clears all file chips; Gaps / structure share this gate.
 */
export function shouldIsolateActiveFileForQuickAction(quickAction: string | undefined): boolean {
  return (
    quickAction === "knowledge-gaps" ||
    quickAction === "understand-repo" ||
    quickAction === "blast-radius" ||
    quickAction === "find-owner" ||
    quickAction === "trace-decision"
  );
}

/**
 * When Use-repo is sticky (scope:repo) and no intentional in-repo file chip exists,
 * do not invent active-file evidence from a leftover editor tab.
 */
export function shouldSkipLocalEditorAttachForRepoScope(ctx: RepoContext): boolean {
  return isExplicitRepoScope(ctx) && !ctx.file?.trim();
}

/** Prompt / Sources label: org docs are supplementary, not repo architecture SoT. */
export const ORG_DOCS_EVIDENCE_LABEL =
  "Org docs (org-wide Confluence/Notion — not this repository's architecture source of truth)";

/**
 * This turn's scenario. Slug match (`owner/repo`), not a substring.
 * Owner `coop-ai` is not the Coop-AI product. Repo `plane` is not Coop-AI.
 */
export type TurnIsolationScenario = {
  owner?: string;
  repo?: string;
  provider?: string;
  file?: string;
  /** Explicit /slack, /jira, … this turn. Other integration kinds are removed. */
  namedIntegration?: IntegrationChatProvider;
  /** /compare: evidence may name either repo. Sticky third repo is not included. */
  allowedRepos?: RepoCoords[];
  /** L file-assistant: drop remote integration evidence. The attached file stays. */
  dropRemoteIntegrations?: boolean;
};

/** Whole repo slug is the Coop product. Owner `coop-ai` does not qualify. */
export function activeRepoIsCoopProduct(repo: string | undefined): boolean {
  const name = repo?.trim().toLowerCase().replace(/[\s_]+/g, "-") ?? "";
  return name === "coop-ai" || name === "coopai";
}

const FOREIGN_PRODUCT_MARKERS = ["coop-ai", "coop ai", "coopai"];

const PATH_LIKE_OWNERS = new Set([
  "src",
  "app",
  "apps",
  "packages",
  "lib",
  "docs",
  "test",
  "tests",
  "web",
  "api",
  "components",
  "pages",
  "public",
  "dist",
  "node_modules"
]);

function allowedReposForScenario(scenario: TurnIsolationScenario): RepoCoords[] {
  const repos: RepoCoords[] = [];
  if (scenario.owner?.trim() && scenario.repo?.trim()) {
    repos.push({
      owner: scenario.owner,
      repo: scenario.repo,
      provider: scenario.provider
    });
  }
  for (const extra of scenario.allowedRepos ?? []) {
    if (extra.owner?.trim() && extra.repo?.trim()) {
      repos.push(extra);
    }
  }
  return repos;
}

function citedRepoSlugs(text: string): RepoCoords[] {
  const hostPattern = new RegExp(
    `\\b(?:${CODE_HOST_PROVIDERS.join("|")}):([a-z0-9_.-]+)/([a-z0-9_.-]+)\\b`,
    "gi"
  );
  const barePattern = /\b([a-z0-9_.-]{2,})\/([a-z0-9_.-]{2,})\b/gi;
  const found: RepoCoords[] = [];
  const seen = new Set<string>();
  const push = (owner: string, repo: string) => {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    found.push({ owner, repo });
  };
  for (const match of text.matchAll(hostPattern)) {
    if (match[1] && match[2]) {
      push(match[1], match[2]);
    }
  }
  for (const match of text.matchAll(barePattern)) {
    const owner = match[1];
    const repo = match[2];
    if (!owner || !repo) {
      continue;
    }
    if (PATH_LIKE_OWNERS.has(owner.toLowerCase())) {
      continue;
    }
    if (!/[-_]/.test(repo) && !activeRepoIsCoopProduct(repo)) {
      continue;
    }
    push(owner, repo);
  }
  return found;
}

function textIncludesTerm(haystack: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

function textNamesRepo(haystack: string, coords: RepoCoords): boolean {
  const repo = coords.repo?.trim();
  if (!repo) {
    return false;
  }
  const lower = haystack.toLowerCase();
  for (const variant of repoNameVariants(repo)) {
    if (textIncludesTerm(lower, variant)) {
      return true;
    }
  }
  const owner = coords.owner?.trim().toLowerCase();
  if (owner) {
    for (const variant of repoNameVariants(repo)) {
      if (textIncludesTerm(lower, `${owner}/${variant.toLowerCase()}`)) {
        return true;
      }
    }
  }
  if (activeRepoIsCoopProduct(repo)) {
    if (FOREIGN_PRODUCT_MARKERS.some((marker) => lower.includes(marker))) {
      return true;
    }
    if (/\bcoop-\d+\b/i.test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * True when text cites a different owner/repo, or a Coop product page while
 * this turn's repo is not that product. Repo-name substring `/coop/` is not used.
 */
export function evidenceTextIsForeignToRepo(
  text: string,
  scenario: TurnIsolationScenario,
  options?: { ignoreTicketKeys?: boolean }
): boolean {
  const allowed = allowedReposForScenario(scenario);
  if (allowed.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  for (const cited of citedRepoSlugs(haystack)) {
    const matchesTurn = allowed.some((repo) => sameRepoCoords(cited, repo));
    if (!matchesTurn) {
      return true;
    }
  }
  const turnIsCoopProduct = allowed.some((repo) => activeRepoIsCoopProduct(repo.repo));
  if (!turnIsCoopProduct) {
    if (FOREIGN_PRODUCT_MARKERS.some((marker) => haystack.includes(marker))) {
      return true;
    }
    if (!options?.ignoreTicketKeys && /\bcoop-\d+\b/i.test(haystack)) {
      return true;
    }
  }
  return false;
}

/** True when text positively names this turn's Use-repo (or either /compare repo). */
export function evidenceTextNamesActiveRepo(text: string, scenario: TurnIsolationScenario): boolean {
  const allowed = allowedReposForScenario(scenario);
  if (allowed.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  if (allowed.some((repo) => textNamesRepo(haystack, repo))) {
    return true;
  }
  return citedRepoSlugs(haystack).some((cited) =>
    allowed.some((repo) => sameRepoCoords(cited, repo))
  );
}

/**
 * Keep an integration hit only when it names this turn's repo and does not cite another.
 * Unlinked hits are dropped (honest empty). No Use-repo pin → keep (caller has no scenario).
 */
export function integrationHitBelongsToTurn(
  text: string,
  scenario: TurnIsolationScenario,
  options?: { ignoreTicketKeys?: boolean }
): boolean {
  if (scenario.dropRemoteIntegrations) {
    return false;
  }
  if (allowedReposForScenario(scenario).length === 0) {
    return true;
  }
  if (evidenceTextIsForeignToRepo(text, scenario, options)) {
    return false;
  }
  return evidenceTextNamesActiveRepo(text, scenario);
}

const INTEGRATION_FIELDS: Array<{
  key: string;
  kind: IntegrationChatProvider;
  listKey: "pages" | "documents" | "messages" | "issues";
}> = [
  { key: "confluenceSearch", kind: "confluence", listKey: "pages" },
  { key: "notionSearch", kind: "notion", listKey: "pages" },
  { key: "googleDocsSearch", kind: "google-docs", listKey: "documents" },
  { key: "slackSearch", kind: "slack", listKey: "messages" },
  { key: "teamsSearch", kind: "teams", listKey: "messages" },
  { key: "jiraSearch", kind: "jira", listKey: "issues" },
  { key: "confluence", kind: "confluence", listKey: "pages" },
  { key: "notion", kind: "notion", listKey: "pages" },
  { key: "googleDocs", kind: "google-docs", listKey: "documents" },
  { key: "slack", kind: "slack", listKey: "messages" },
  { key: "teams", kind: "teams", listKey: "messages" },
  { key: "jira", kind: "jira", listKey: "issues" }
];

const SNIPPET_KEYS = ["files", "semanticFiles", "snippets", "codeSnippets", "localFiles"];

function asDataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function integrationHitText(hit: unknown): string {
  const record = asDataRecord(hit);
  if (!record) {
    return "";
  }
  return ["title", "excerpt", "summary", "description", "text", "body", "key"]
    .map((field) => record[field])
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

function compareReposInBundle(bundle: readonly { data?: unknown }[]): RepoCoords[] | undefined {
  for (const entry of bundle) {
    const data = asDataRecord(entry.data);
    const compare = asDataRecord(data?.dualRepoCompare);
    const left = asDataRecord(compare?.left);
    const right = asDataRecord(compare?.right);
    const leftOwner = typeof left?.owner === "string" ? left.owner : undefined;
    const leftRepo = typeof left?.repo === "string" ? left.repo : undefined;
    const rightOwner = typeof right?.owner === "string" ? right.owner : undefined;
    const rightRepo = typeof right?.repo === "string" ? right.repo : undefined;
    if (leftOwner && leftRepo && rightOwner && rightRepo) {
      return [
        { owner: leftOwner, repo: leftRepo },
        { owner: rightOwner, repo: rightRepo }
      ];
    }
  }
  return undefined;
}

function filterIntegrationValue(
  value: unknown,
  field: (typeof INTEGRATION_FIELDS)[number],
  scenario: TurnIsolationScenario
): unknown | undefined {
  if (scenario.dropRemoteIntegrations) {
    return undefined;
  }
  if (scenario.namedIntegration && scenario.namedIntegration !== field.kind) {
    return undefined;
  }
  const record = asDataRecord(value);
  if (!record) {
    return value;
  }
  const list = record[field.listKey];
  if (!Array.isArray(list)) {
    return value;
  }
  if (allowedReposForScenario(scenario).length === 0 && !scenario.namedIntegration) {
    return value;
  }
  const kept = list.filter((hit) => integrationHitBelongsToTurn(integrationHitText(hit), scenario));
  if (kept.length === 0) {
    if (typeof record.error === "string" && record.error.trim()) {
      return { ...record, [field.listKey]: [] };
    }
    return undefined;
  }
  if (kept.length === list.length) {
    return value;
  }
  return { ...record, [field.listKey]: kept };
}

function filterSnippetList(value: unknown, scenario: TurnIsolationScenario): unknown {
  if (!Array.isArray(value) || scenario.dropRemoteIntegrations) {
    return value;
  }
  const allowed = allowedReposForScenario(scenario);
  if (allowed.length === 0) {
    return value;
  }
  return value.filter((item) => {
    const record = asDataRecord(item);
    if (!record || typeof record.path !== "string") {
      return true;
    }
    return allowed.some((repo) =>
      snippetBelongsToActiveRepo(
        { repoId: typeof record.repoId === "string" ? record.repoId : undefined },
        repo,
        { allowMissingRepoId: true }
      )
    );
  });
}

function isolateDataRecord(
  data: Record<string, unknown>,
  scenario: TurnIsolationScenario
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  for (const field of INTEGRATION_FIELDS) {
    if (!(field.key in next)) {
      continue;
    }
    const filtered = filterIntegrationValue(next[field.key], field, scenario);
    if (filtered === undefined) {
      delete next[field.key];
    } else {
      next[field.key] = filtered;
    }
  }
  if (!scenario.dropRemoteIntegrations) {
    for (const key of SNIPPET_KEYS) {
      if (key in next) {
        next[key] = filterSnippetList(next[key], scenario);
      }
    }
  }
  return next;
}

/**
 * Drop foreign Confluence/Notion/Google Docs pages, Slack/Teams threads, Jira
 * issues, and code snippets whose repoId is another owner/repo.
 * /compare bundles keep only the two named repos (sticky third repo is foreign).
 */
export function isolateContextBundleForTurn<T extends { data?: unknown }>(
  bundle: readonly T[],
  scenario: TurnIsolationScenario
): T[] {
  const compareRepos = compareReposInBundle(bundle);
  const effective: TurnIsolationScenario = compareRepos
    ? {
        ...scenario,
        owner: undefined,
        repo: undefined,
        allowedRepos: compareRepos,
        dropRemoteIntegrations: false
      }
    : scenario;
  return bundle.map((entry) => {
    const data = asDataRecord(entry.data);
    if (!data) {
      return entry;
    }
    const next = isolateDataRecord(data, effective);
    return { ...entry, data: next };
  });
}

export function orgDocsSynthesisGuardrail(activeOwner?: string, activeRepo?: string): string {
  const label =
    activeOwner?.trim() && activeRepo?.trim()
      ? `${activeOwner.trim()}/${activeRepo.trim()}`
      : "the active Use-repo";
  return (
    `Org documentation hits (Confluence/Notion/Google Docs) are org-wide supplementary context. ` +
    `Label them as org docs in the answer. Never treat them as ${label}'s architecture source of truth ` +
    `(especially Coop-AI ADRs or pages about other products). Prefer indexed repo code, inventory, and tree for architecture.`
  );
}
