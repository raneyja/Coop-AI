import { BitbucketClient } from "../api/codeHosts/bitbucketClient";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { GitLabClient } from "../api/codeHosts/gitlabClient";
import {
  PR_HANDOFF_AUDIT_ACTION,
  normalizeWriteFiles,
  pullCreateLockKey,
  sanitizeBranchName,
  validateCreatePullRequestInput,
  withPullCreateLock
} from "../api/codeHosts/pullRequestWrite";
import { CodeHostError, type CreatePullRequestInput, type CreatePullRequestResult, type RepoCoordinates } from "../api/codeHosts/types";

export { PR_HANDOFF_AUDIT_ACTION };

export type CreateRepoPullRequestBody = {
  branch?: unknown;
  title?: unknown;
  body?: unknown;
  base?: unknown;
  files?: unknown;
};

export type CreateRepoPullOk = CreatePullRequestResult & {
  repoId: string;
};

export async function createPullFromFilesForProvider(
  coords: RepoCoordinates,
  input: CreatePullRequestInput,
  token: string
): Promise<CreatePullRequestResult> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).createPullFromFiles(coords, input);
    case "gitlab":
      return new GitLabClient({ token }).createPullFromFiles(coords, input);
    case "bitbucket":
      return new BitbucketClient({ token }).createPullFromFiles(coords, input);
    default:
      throw new CodeHostError(`Unsupported provider: ${String(coords.provider)}`, "unsupported", 501);
  }
}

export function parseCreateRepoPullBody(body: unknown): CreatePullRequestInput | { error: string } {
  const record = typeof body === "object" && body !== null ? (body as CreateRepoPullRequestBody) : {};
  const filesRaw = Array.isArray(record.files) ? record.files : [];
  const files = normalizeWriteFiles(
    filesRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const file = entry as { path?: unknown; content?: unknown };
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        return [];
      }
      return [{ path: file.path, content: file.content }];
    })
  );
  const input: CreatePullRequestInput = {
    branch: typeof record.branch === "string" ? record.branch : "",
    title: typeof record.title === "string" ? record.title : "",
    body: typeof record.body === "string" ? record.body : undefined,
    base: typeof record.base === "string" ? record.base : undefined,
    files
  };
  const error = validateCreatePullRequestInput(input);
  if (error) {
    return { error };
  }
  return {
    ...input,
    branch: sanitizeBranchName(input.branch) ?? input.branch,
    title: input.title.trim()
  };
}

export async function executeCreateRepoPull(options: {
  orgId: string;
  repoId: string;
  coords: RepoCoordinates;
  input: CreatePullRequestInput;
  token: string;
  createPullFromFiles?: (
    coords: RepoCoordinates,
    input: CreatePullRequestInput,
    token: string
  ) => Promise<CreatePullRequestResult>;
}): Promise<CreateRepoPullOk> {
  const create = options.createPullFromFiles ?? createPullFromFilesForProvider;
  const branch = sanitizeBranchName(options.input.branch) ?? options.input.branch;
  const key = pullCreateLockKey(options.orgId, options.repoId, branch);
  const result = await withPullCreateLock(key, () =>
    create(options.coords, { ...options.input, branch }, options.token)
  );
  return { ...result, repoId: options.repoId };
}
