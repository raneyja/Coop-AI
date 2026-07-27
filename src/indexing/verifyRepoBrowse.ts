import { BitbucketClient } from "../api/codeHosts/bitbucketClient";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { GitLabClient } from "../api/codeHosts/gitlabClient";
import { CodeHostError, type CodeHostProvider, type RepoCoordinates } from "../api/codeHosts/types";
import { parseRepoId } from "../server/gitCloneService";

export type BrowseStatus = "pending" | "verified" | "failed";

export type VerifyRepoBrowseResult = {
  browseStatus: BrowseStatus;
  defaultBranch?: string;
  browseError?: string;
  browseVerifiedAt?: Date;
};

/**
 * Prove the org can list the repo root via the code host — same path Remote
 * workspace uses. Prefer the repo's real default branch; on 404 retry without
 * an explicit branch ref.
 */
export async function verifyRepoBrowse(options: {
  repoId: string;
  token: string;
  preferredBranch?: string;
}): Promise<VerifyRepoBrowseResult> {
  const target = parseRepoId(options.repoId);
  const coords: RepoCoordinates = {
    provider: target.provider,
    owner: target.owner,
    repo: target.repo,
    branch: options.preferredBranch?.trim() || undefined
  };

  try {
    const tree = await fetchTreeWithBranchFallback(coords, options.token);
    if (!tree.entries.length) {
      return {
        browseStatus: "failed",
        defaultBranch: tree.branch,
        browseError: "Repository tree is empty — nothing for developers to browse.",
        browseVerifiedAt: new Date()
      };
    }
    return {
      browseStatus: "verified",
      defaultBranch: tree.branch,
      browseVerifiedAt: new Date()
    };
  } catch (error) {
    const message =
      error instanceof CodeHostError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Browse verification failed";
    return {
      browseStatus: "failed",
      defaultBranch: options.preferredBranch?.trim() || undefined,
      browseError: message,
      browseVerifiedAt: new Date()
    };
  }
}

async function fetchTreeWithBranchFallback(
  coords: RepoCoordinates,
  token: string
): Promise<{ branch: string; entries: unknown[] }> {
  try {
    return await fetchTree(coords, token);
  } catch (error) {
    if (coords.branch && error instanceof CodeHostError && error.status === 404) {
      return fetchTree({ ...coords, branch: undefined }, token);
    }
    throw error;
  }
}

async function fetchTree(
  coords: RepoCoordinates,
  token: string
): Promise<{ branch: string; entries: unknown[] }> {
  switch (coords.provider as CodeHostProvider) {
    case "github": {
      const tree = await new GitHubClient({ token }).getRepositoryTree(coords, "");
      return { branch: tree.branch, entries: tree.entries };
    }
    case "gitlab": {
      const tree = await new GitLabClient({ token }).getRepositoryTree(coords, "");
      return { branch: tree.branch, entries: tree.entries };
    }
    case "bitbucket": {
      const tree = await new BitbucketClient({ token }).getRepositoryTree(coords, "");
      return { branch: tree.branch, entries: tree.entries };
    }
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

/** Map job progress milestones to admin-facing stage labels. */
export function indexStageFromProgress(progress: number | undefined): {
  stage: string;
  detail: string;
} {
  const value = typeof progress === "number" ? progress : 0;
  if (value < 15) {
    return { stage: "Starting", detail: "Job is initializing…" };
  }
  if (value < 30) {
    return { stage: "Preparing", detail: "Preparing repository clone…" };
  }
  if (value < 42) {
    return { stage: "Cloning", detail: "Cloning repository…" };
  }
  if (value < 55) {
    return { stage: "Symbols", detail: "Building symbol index…" };
  }
  if (value < 65) {
    return { stage: "Search index", detail: "Building full-text search index…" };
  }
  if (value < 86) {
    return {
      stage: "Embeddings",
      detail: "Embedding files — large repos can take several minutes. This is normal."
    };
  }
  if (value < 90) {
    return { stage: "Inventory", detail: "Recording repository inventory…" };
  }
  if (value < 100) {
    return { stage: "Verifying", detail: "Checking developers can browse the repo…" };
  }
  return { stage: "Complete", detail: "Index finished." };
}

export function isBrowseVerified(status: BrowseStatus | undefined | null): boolean {
  return status === "verified";
}

/** Grants / workspace: allow legacy null, block explicit browse failures. */
export function isUsableForDeveloperAccess(repo: {
  lightningEnabled?: boolean;
  indexStatus?: string;
  browseStatus?: BrowseStatus | null;
}): boolean {
  if (!repo.lightningEnabled || repo.indexStatus === "disabled") {
    return false;
  }
  if (repo.indexStatus !== "ready") {
    return false;
  }
  return repo.browseStatus !== "failed";
}

export function isFullyUsable(repo: {
  lightningEnabled?: boolean;
  indexStatus?: string;
  browseStatus?: BrowseStatus | null;
}): boolean {
  return Boolean(
    repo.lightningEnabled && repo.indexStatus === "ready" && repo.browseStatus === "verified"
  );
}
