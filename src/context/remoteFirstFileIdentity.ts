import type { RepoContextFileSource } from "../chat/types";

export type FileIdentitySnapshot = {
  file?: string;
  fileSource: RepoContextFileSource;
  owner?: string;
  repo?: string;
  warning?: string;
};

/**
 * Remote-first identity: when codehost owner/repo are known, present a local
 * workspace/git buffer as a codehost file reference. Physical URI classification
 * from `resolveEditorFile` stays workspace|git so editor pickers can still find the disk tab.
 */
export function applyRemoteFirstFileIdentity(
  resolved: FileIdentitySnapshot,
  prefs?: { owner?: string; repo?: string }
): FileIdentitySnapshot {
  const owner = resolved.owner?.trim() || prefs?.owner?.trim() || undefined;
  const repo = resolved.repo?.trim() || prefs?.repo?.trim() || undefined;
  if (
    resolved.file?.trim() &&
    owner &&
    repo &&
    (resolved.fileSource === "workspace" || resolved.fileSource === "git")
  ) {
    return {
      file: resolved.file,
      fileSource: "remote",
      owner,
      repo,
      warning: undefined
    };
  }
  return {
    ...resolved,
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {})
  };
}

/** Promote RepoContext.file to codehost identity when owner/repo are known. */
export function promoteRepoContextFileIdentity<T extends {
  file?: string;
  fileSource?: FileIdentitySnapshot["fileSource"];
  owner?: string;
  repo?: string;
  contextWarning?: string;
}>(ctx: T, prefs?: { owner?: string; repo?: string }): T {
  if (!ctx.file?.trim()) {
    return ctx;
  }
  const promoted = applyRemoteFirstFileIdentity(
    {
      file: ctx.file,
      fileSource: ctx.fileSource ?? "workspace",
      owner: ctx.owner,
      repo: ctx.repo,
      warning: ctx.contextWarning
    },
    prefs
  );
  if (
    promoted.fileSource === (ctx.fileSource ?? "workspace") &&
    promoted.owner === ctx.owner &&
    promoted.repo === ctx.repo &&
    promoted.warning === ctx.contextWarning
  ) {
    return ctx;
  }
  return {
    ...ctx,
    fileSource: promoted.fileSource,
    owner: promoted.owner ?? ctx.owner,
    repo: promoted.repo ?? ctx.repo,
    contextWarning: promoted.warning
  };
}
