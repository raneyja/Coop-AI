import { normalizeRelativePath } from "./localFileContext";

export function parseGithubVfsUri(raw: string): { owner: string; repo: string; file: string } | undefined {
  const normalized = raw
    .replace(/^vscode-vfs:\/\/github/i, "")
    .replace(/^github:\/\//i, "")
    .replace(/^\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() === "github") {
    segments.shift();
  }
  if (segments.length < 3) {
    return undefined;
  }
  const [owner, repo, ...rest] = segments;
  if (!owner || !repo || rest.length === 0) {
    return undefined;
  }
  return { owner, repo, file: rest.join("/") };
}

export function isRemoteTabAbsolutePath(absolutePath: string): boolean {
  return absolutePath.includes("://");
}

export function pathsReferToSameFile(left: string, right: string): boolean {
  const a = normalizeRelativePath(left);
  const b = normalizeRelativePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}
