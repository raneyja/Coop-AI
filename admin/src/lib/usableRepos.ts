import type { OrgRepoRecord } from "./coopApi";

/** Mirror of server isUsableForDeveloperAccess — ready and browse not failed. */
export function isUsableForDeveloperAccess(repo: OrgRepoRecord): boolean {
  if (!repo.lightningEnabled || repo.indexStatus === "disabled") {
    return false;
  }
  if (repo.indexStatus !== "ready") {
    return false;
  }
  return repo.browseStatus !== "failed";
}

export function isFullyUsableRepo(repo: OrgRepoRecord): boolean {
  return Boolean(
    repo.lightningEnabled && repo.indexStatus === "ready" && repo.browseStatus === "verified"
  );
}
