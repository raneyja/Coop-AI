import type { Uri } from "vscode";
import { pathsReferToSameFile } from "./githubVfsUri";
import { toRepositoryRelativePath } from "./repoFilePath";

/**
 * Untitled API tabs are the Zero-Clone viewing vehicle when VFS is unavailable.
 * The URI has no repo path — this table is the identity. Chip / editor resolve
 * must consult it so "Untitled-1" is never treated as a local file the user picked.
 */
export type RememberedRemoteBuffer = {
  path: string;
  uriString: string;
  content: string;
  owner?: string;
  repo?: string;
  provider?: import("../chat/types").CodeHostProviderPreference;
  branch?: string;
};

const rememberedRemoteBuffers = new Map<string, RememberedRemoteBuffer>();

function normalizeBufferKey(relativePath: string): string {
  return (toRepositoryRelativePath(relativePath) ?? relativePath).replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function rememberedRemoteEntry(relativePath: string): RememberedRemoteBuffer | undefined {
  const key = normalizeBufferKey(relativePath);
  const matches = [...rememberedRemoteBuffers.values()].filter(value => pathsReferToSameFile(value.path, key));
  const identities = new Set(matches.map(value => JSON.stringify([value.provider, value.owner, value.repo, value.branch])));
  return identities.size === 1 ? matches.at(-1) : undefined;
}

/** Bitbucket/GitLab Zero-Clone tabs are untitled — remember path → buffer at open. */
export function rememberRemotePatchBuffer(
  relativePath: string,
  uri: Uri,
  content: string,
  identity?: { owner?: string; repo?: string; provider?: import("../chat/types").CodeHostProviderPreference; branch?: string }
): void {
  const key = normalizeBufferKey(relativePath);
  if (!key || !content.trim()) {
    return;
  }
  rememberedRemoteBuffers.set(uri.toString(), {
    path: key,
    uriString: uri.toString(),
    content,
    owner: identity?.owner?.trim() || undefined,
    repo: identity?.repo?.trim() || undefined,
    provider: identity?.provider,
    branch: identity?.branch?.trim() || undefined
  });
}

export function listRememberedRemoteBuffers(): Array<{ path: string } & RememberedRemoteBuffer> {
  return [...rememberedRemoteBuffers.values()];
}

export function rememberedRemoteBufferForUri(
  uriString: string
): ({ path: string } & RememberedRemoteBuffer) | undefined {
  const wanted = uriString.trim();
  if (!wanted) {
    return undefined;
  }
  for (const value of rememberedRemoteBuffers.values()) {
    if (value.uriString === wanted) {
      return value;
    }
  }
  return undefined;
}

/** Chip identity for an untitled tab that is actually a remote viewing buffer. */
export function remoteIdentityForUntitledUri(uriString: string):
  | { file: string; fileSource: "remote"; owner?: string; repo?: string; provider?: import("../chat/types").CodeHostProviderPreference; branch?: string }
  | undefined {
  const remembered = rememberedRemoteBufferForUri(uriString);
  if (!remembered) {
    return undefined;
  }
  const file = toRepositoryRelativePath(remembered.path) || remembered.path;
  if (!file.trim()) {
    return undefined;
  }
  return {
    file,
    fileSource: "remote",
    owner: remembered.owner,
    repo: remembered.repo,
    provider: remembered.provider,
    branch: remembered.branch
  };
}

export function clearRemotePatchBuffersForTests(): void {
  rememberedRemoteBuffers.clear();
}
