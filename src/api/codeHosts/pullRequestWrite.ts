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
export const GITLAB_PR_WRITE_SCOPES = ["api", "write_repository"] as const;
export const BITBUCKET_PR_WRITE_SCOPES = ["repository:write", "account", "pullrequest:write"] as const;

export const GITHUB_WRITE_PERMISSION_MESSAGE =
  "Coop cannot create a pull request on this GitHub repo. Grant Contents and Pull requests write on the GitHub App, accept the update, then try again. Nothing was created.";

export const GITHUB_PR_WRITE_FAILED_MESSAGE =
  "GitHub refused to create this pull request. Nothing was created.";

export const GITLAB_WRITE_PERMISSION_MESSAGE =
  "This GitLab token cannot create merge requests. Reconnect GitLab in Coop with api and write_repository access, then try again. Nothing was created.";

export const GITLAB_PR_WRITE_FAILED_MESSAGE =
  "GitLab refused to create this merge request. Nothing was created.";

export const BITBUCKET_WRITE_PERMISSION_MESSAGE =
  "This Bitbucket token cannot create pull requests. Reconnect Bitbucket in Coop with repository:write and pullrequest:write, then try again. Nothing was created.";

export const BITBUCKET_PR_WRITE_FAILED_MESSAGE =
  "Bitbucket refused to create this pull request. Nothing was created.";

export const GITHUB_PR_REJECTED_MESSAGE =
  "GitHub rejected this pull request (422). No pull request was created.";

export const GITLAB_PR_REJECTED_MESSAGE =
  "GitLab rejected this merge request. No merge request was created.";

export const BITBUCKET_PR_REJECTED_MESSAGE =
  "Bitbucket rejected this pull request. No pull request was created.";

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
  return scopes.has("api") && scopes.has("write_repository");
}

export function bitbucketScopesAllowPullWrite(scopes: Set<string>): boolean {
  return scopes.has("repository:write") && scopes.has("pullrequest:write");
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
