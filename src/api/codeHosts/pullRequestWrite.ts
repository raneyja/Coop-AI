import {
  CodeHostError,
  type CodeHostProvider,
  type CreatePullRequestInput,
  type CreatePullRequestResult,
  type PullRequestWriteFile,
  type RepoCoordinates
} from "./types";

/** Audit / telemetry action for a confirmed PR handoff. */
export const PR_HANDOFF_AUDIT_ACTION = "repo.pull.create";

export const GITHUB_PR_WRITE_SCOPES = ["contents", "pull_requests"] as const;
/** REST create-commit + merge-request needs `api`. `write_repository` is Git-over-HTTP only. */
export const GITLAB_PR_WRITE_SCOPES = ["api"] as const;
export const BITBUCKET_PR_WRITE_SCOPES = ["repository:write", "account", "pullrequest:write"] as const;

export const GITHUB_WRITE_PERMISSION_MESSAGE =
  "GitHub blocked this. The Coop GitHub App needs Contents and Pull requests write on this repo. An admin must grant those, accept the update on GitHub, then try again. Nothing was created.";

export const GITHUB_APP_CANNOT_WRITE_REPO_MESSAGE =
  "GitHub blocked this. Coop's GitHub App is not allowed to write in this repository. That usually means a different GitHub org, or this repo isn't on the App's access list. An admin needs to add the repo and grant Contents and Pull requests write. Nothing was created.";

export const GITHUB_PR_WRITE_FAILED_MESSAGE = GITHUB_APP_CANNOT_WRITE_REPO_MESSAGE;

export const GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE =
  "GitHub blocked this. Coop is using a personal GitHub token that cannot write. Reconnect GitHub in Coop settings, then try again. Nothing was created.";

export const GITHUB_NOT_CONNECTED_MESSAGE =
  "GitHub blocked this. GitHub is not connected for this organization. Install the Coop GitHub App from Coop settings, then try again. Nothing was created.";

/**
 * Points at the one installation that must approve, because "go to your
 * installations" is useless when an account has more than one.
 */
export function githubInstallationAcceptMessage(installation: {
  accountLogin?: string;
  installationId?: number;
  installationUrl?: string;
}): string {
  const who = installation.accountLogin ? ` on ${installation.accountLogin}` : "";
  const where =
    installation.installationUrl ??
    (installation.installationId
      ? `https://github.com/settings/installations/${installation.installationId}`
      : undefined);
  const open = where ? ` Open ${where} and approve the pending request.` : "";
  return `GitHub blocked this. The Coop GitHub App${who} has not approved Contents and Pull requests write.${open} Nothing was created.`;
}

/** The App is installed but this repo is outside its Repository access list. */
export function githubRepoNotInInstallationMessage(owner: string, repo: string): string {
  return `GitHub blocked this. The Coop GitHub App cannot see ${owner}/${repo}. An admin needs to add this repository under the App's Repository access. Nothing was created.`;
}

export const GITLAB_WRITE_PERMISSION_MESSAGE =
  "GitLab blocked this. Coop does not have permission to create a merge request. Reconnect GitLab in Coop settings with api access, then try again. Nothing was created.";

export const GITLAB_PR_WRITE_FAILED_MESSAGE = GITLAB_WRITE_PERMISSION_MESSAGE;

export const BITBUCKET_WRITE_PERMISSION_MESSAGE =
  "Bitbucket blocked this. Coop does not have permission to create a pull request. Reconnect Bitbucket in Coop settings with repository:write and pullrequest:write, then try again. Nothing was created.";

export const BITBUCKET_PR_WRITE_FAILED_MESSAGE = BITBUCKET_WRITE_PERMISSION_MESSAGE;

export const GITHUB_PR_REJECTED_MESSAGE =
  "GitHub didn't open a pull request. A PR may already exist for this branch — change the branch name and try again.";

export const GITLAB_PR_REJECTED_MESSAGE =
  "GitLab didn't open a merge request. This branch may already have one, or there were no file changes. Try a different branch name.";

export const BITBUCKET_PR_REJECTED_MESSAGE =
  "Bitbucket didn't open a pull request. This branch may already have one, or there were no file changes. Try a different branch name.";

const ALREADY_HUMAN_PULL_CREATE =
  /^(GitHub|GitLab|Bitbucket) blocked this\.|^(GitHub|GitLab|Bitbucket) didn't open/i;

/**
 * Turn host jargon into a reason a user can act on. Safe to run twice.
 */
export function explainPullCreateFailure(
  provider: CodeHostProvider | undefined,
  raw: string
): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) {
    return "The host blocked this pull request. Nothing was created.";
  }
  if (ALREADY_HUMAN_PULL_CREATE.test(text) && !/resource not accessible by integration/i.test(text)) {
    return text;
  }
  const host = provider ?? inferPullCreateProvider(text);

  if (/unexpected end of json/i.test(text) || /empty response from the code host/i.test(text)) {
    return "The host saved the commit but sent an empty reply. Try Create pull request again. Nothing extra was created on this attempt.";
  }

  if (host === "github") {
    if (
      /resource not accessible by integration/i.test(text) ||
      /not accessible by integration/i.test(text) ||
      /github refused to create/i.test(text) ||
      /authentication failed/i.test(text) ||
      /\b403\b|\b401\b/.test(text)
    ) {
      return GITHUB_APP_CANNOT_WRITE_REPO_MESSAGE;
    }
    if (
      /validation failed|\(422\)|already exists/i.test(text) ||
      /rejected this pull request \(422\)/i.test(text)
    ) {
      return GITHUB_PR_REJECTED_MESSAGE;
    }
    if (/resource not found/i.test(text)) {
      return "GitHub blocked this. It could not find the repository or branch. Check Use-repo and the branch name. Nothing was created.";
    }
    return text;
  }

  if (host === "gitlab") {
    if (
      /gitlab refused to create|\b403\b|\b401\b|insufficient|forbidden|unauthorized|permission|authentication failed/i.test(
        text
      )
    ) {
      return GITLAB_WRITE_PERMISSION_MESSAGE;
    }
    if (/didn't open a merge request|blocked this/i.test(text)) {
      return text;
    }
    const extra = text
      .replace(/^GitLab refused to create this merge request\.\s*/i, "")
      .replace(/^Request failed \(\d+\)\.\s*/i, "")
      .replace(/^Authentication failed\. Update your token in settings\.\s*/i, "")
      .trim();
    if (extra && extra.length < 180 && !/unexpected end of json/i.test(extra)) {
      return `GitLab didn't open a merge request. ${extra}`;
    }
    return GITLAB_PR_REJECTED_MESSAGE;
  }

  if (host === "bitbucket") {
    if (
      /bitbucket refused to create|\b403\b|\b401\b|insufficient|forbidden|unauthorized|permission|oauth|authentication failed/i.test(
        text
      )
    ) {
      return BITBUCKET_WRITE_PERMISSION_MESSAGE;
    }
    const extra = text
      .replace(/^Bitbucket refused to create this pull request\.\s*/i, "")
      .replace(/^Request failed \(\d+\)\.\s*/i, "")
      .replace(/^Authentication failed\. Update your token in settings\.\s*/i, "")
      .trim();
    if (extra && extra.length < 180 && !/unexpected end of json/i.test(extra)) {
      return `Bitbucket didn't open a pull request. ${extra}`;
    }
    return BITBUCKET_PR_REJECTED_MESSAGE;
  }

  return text;
}

function inferPullCreateProvider(text: string): CodeHostProvider | undefined {
  if (/gitlab/i.test(text)) {
    return "gitlab";
  }
  if (/bitbucket/i.test(text)) {
    return "bitbucket";
  }
  if (/github/i.test(text) || /integration/i.test(text)) {
    return "github";
  }
  return undefined;
}

export function writePermissionMessage(provider: CodeHostProvider): string {
  if (provider === "gitlab") {
    return GITLAB_WRITE_PERMISSION_MESSAGE;
  }
  if (provider === "bitbucket") {
    return BITBUCKET_WRITE_PERMISSION_MESSAGE;
  }
  return GITHUB_WRITE_PERMISSION_MESSAGE;
}

export function pullRequestWriteNotYetMessage(provider: CodeHostProvider): string {
  return `Creating pull requests from Coop is not yet available for ${provider}.`;
}

export function throwPullRequestWriteNotYet(provider: CodeHostProvider): never {
  throw new CodeHostError(pullRequestWriteNotYetMessage(provider), "unsupported", 501, provider);
}

export function sanitizeBranchName(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^refs\/heads\//, "");
  if (!trimmed || trimmed.length > 200) {
    return undefined;
  }
  if (trimmed.startsWith("/") || trimmed.endsWith("/") || trimmed.includes("..") || /\s/.test(trimmed)) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function normalizeWriteFiles(files: PullRequestWriteFile[] | undefined): PullRequestWriteFile[] {
  if (!files?.length) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: PullRequestWriteFile[] = [];
  for (const file of files) {
    const path = file.path.replace(/^\/+/, "").trim();
    if (!path || seen.has(path)) {
      continue;
    }
    if (typeof file.content !== "string" || file.content.length === 0) {
      continue;
    }
    seen.add(path);
    normalized.push({ path, content: file.content });
  }
  return normalized;
}

export function isPullRequestWriteSupported(provider?: CodeHostProvider): boolean {
  return !provider || provider === "github" || provider === "gitlab" || provider === "bitbucket";
}

export type CreatePullRequestDecision = "confirm" | "cancel" | "dismiss";

export type CreatePullRequestEvaluation =
  | { action: "create"; payload: CreatePullRequestInput }
  | {
      action: "nothing";
      reason: "cancelled" | "dismissed" | "not_yet" | "empty_files" | "missing_branch" | "missing_title";
    };

export function evaluateCreatePullRequest(
  input: CreatePullRequestInput & { provider?: CodeHostProvider },
  decision: CreatePullRequestDecision
): CreatePullRequestEvaluation {
  if (decision === "cancel") {
    return { action: "nothing", reason: "cancelled" };
  }
  if (decision === "dismiss") {
    return { action: "nothing", reason: "dismissed" };
  }
  if (!isPullRequestWriteSupported(input.provider)) {
    return { action: "nothing", reason: "not_yet" };
  }
  if (!sanitizeBranchName(input.branch) && !input.branch.trim()) {
    return { action: "nothing", reason: "missing_branch" };
  }
  if (!input.title.trim()) {
    return { action: "nothing", reason: "missing_title" };
  }
  const files = normalizeWriteFiles(input.files);
  if (files.length === 0) {
    return { action: "nothing", reason: "empty_files" };
  }
  return {
    action: "create",
    payload: {
      ...input,
      branch: sanitizeBranchName(input.branch) ?? input.branch.trim(),
      title: input.title.trim(),
      body: input.body?.trim() || undefined,
      files
    }
  };
}

export function validateCreatePullRequestInput(input: CreatePullRequestInput): string | undefined {
  const branch = sanitizeBranchName(input.branch);
  if (!branch) {
    return "Enter a valid branch name.";
  }
  if (!input.title.trim()) {
    return "Enter a pull request title.";
  }
  if (normalizeWriteFiles(input.files).length === 0) {
    return "Select at least one file to include in the pull request.";
  }
  return undefined;
}

export function githubTokenHasWriteScopes(oauthScopesHeader: string | null | undefined): boolean | undefined {
  if (!oauthScopesHeader || !oauthScopesHeader.trim()) {
    return undefined;
  }
  const scopes = parseOAuthScopeSet(oauthScopesHeader);
  const hasRepo = scopes.has("repo") || scopes.has("public_repo");
  const hasContents = hasRepo || scopes.has("contents") || scopes.has("contents:write");
  const hasPulls =
    hasRepo || scopes.has("pull_request") || scopes.has("pull_requests") || scopes.has("pull_requests:write");
  return hasContents && hasPulls;
}

export function parseOAuthScopeSet(raw: string | string[] | null | undefined): Set<string> {
  const parts = Array.isArray(raw)
    ? raw
    : (raw ?? "")
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
  return new Set(parts.map((scope) => scope.toLowerCase()));
}

/** GitHub App installation tokens report Contents / Pull requests on GET /installation. */
export function githubAppInstallationHasPullWrite(
  permissions: Record<string, string> | undefined
): boolean {
  if (!permissions) {
    return false;
  }
  const contents = (permissions.contents ?? "").toLowerCase();
  const pulls = (permissions.pull_requests ?? permissions.pull_request ?? "").toLowerCase();
  return contents === "write" && pulls === "write";
}

export function gitlabScopesAllowPullWrite(scopes: Set<string>): boolean {
  // `api` is complete REST read/write (commits + merge requests).
  // `write_repository` authenticates Git-over-HTTP only — not the API.
  return scopes.has("api");
}

export function bitbucketScopesAllowPullWrite(scopes: Set<string>): boolean {
  // Classic OAuth: pullrequest:write implies repository:write.
  if (scopes.has("pullrequest:write")) {
    return true;
  }
  // Forge / API tokens list scopes independently (write:pullrequest does not imply write:repository).
  return scopes.has("write:pullrequest:bitbucket") && scopes.has("write:repository:bitbucket");
}

/**
 * Collaborator `permissions.push` is a user-token signal.
 * GitHub App installation tokens often report push=false even with Contents write.
 * Only trust it when classic OAuth scopes already look sufficient.
 */
export function githubWriteBlockedByCollaboratorPush(
  oauthScopesHeader: string | null | undefined,
  push: boolean | undefined
): boolean {
  return githubTokenHasWriteScopes(oauthScopesHeader) === true && push === false;
}

const inflightCreates = new Map<string, Promise<CreatePullRequestResult>>();

export function pullCreateLockKey(orgId: string, repoId: string, branch: string): string {
  return `${orgId}:${repoId}:${branch}`;
}

export async function withPullCreateLock(
  key: string,
  run: () => Promise<CreatePullRequestResult>
): Promise<CreatePullRequestResult> {
  const existing = inflightCreates.get(key);
  if (existing) {
    return existing;
  }
  const pending = run().finally(() => {
    if (inflightCreates.get(key) === pending) {
      inflightCreates.delete(key);
    }
  });
  inflightCreates.set(key, pending);
  return pending;
}

export function resetPullCreateLocks(): void {
  inflightCreates.clear();
}

export function createConfirmSubmitGuard(): (run: () => Promise<void>) => Promise<"ran" | "skipped"> {
  let inflight = false;
  return async (run) => {
    if (inflight) {
      return "skipped";
    }
    inflight = true;
    try {
      await run();
      return "ran";
    } finally {
      inflight = false;
    }
  };
}

export const PHASE_C_FIXTURE_REPO: RepoCoordinates = {
  provider: "github",
  owner: "acme",
  repo: "plane",
  branch: "main"
};

export const PHASE_C_FIXTURE_FILES: PullRequestWriteFile[] = [
  {
    path: "apps/api/auth.ts",
    content: "export function requireAuth(): boolean {\n  return true;\n}\n"
  },
  {
    path: "docs/fixture-note.md",
    content: "# Fixture patch\n\nUsed by Wave 2 Phase C tests.\n"
  }
];
