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
  // Outside-workspace local files stay local — never promote to remote.
  if (ctx.fileSource === "external") {
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

export type EditorFileIdentityDecoration = {
  badge: "L" | "R";
  tooltip: string;
};

/** Tab decoration for open editors — L = local disk (workspace/git/external), R = remote/codehost. */
export function classifyEditorFileIdentityDecoration(
  resolved: FileIdentitySnapshot
): EditorFileIdentityDecoration | undefined {
  if (!resolved.file?.trim()) {
    return undefined;
  }
  if (resolved.fileSource === "remote") {
    const owner = resolved.owner?.trim();
    const repo = resolved.repo?.trim();
    return {
      badge: "R",
      tooltip: owner && repo ? `Remote · ${owner}/${repo}` : "Remote file"
    };
  }
  if (resolved.fileSource === "external") {
    return {
      badge: "L",
      tooltip: "Local · outside workspace"
    };
  }
  if (resolved.fileSource === "workspace" || resolved.fileSource === "git" || !resolved.fileSource) {
    return {
      badge: "L",
      tooltip: "Local workspace file"
    };
  }
  return undefined;
}
