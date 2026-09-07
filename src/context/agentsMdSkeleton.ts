/**
 * Shared AGENTS.md template + create-path helper.
 * Kept browser-safe (no node:path) so the webview can import AGENTS_MD_SKELETON.
 */
export const AGENTS_MD_FILENAME = "AGENTS.md";

function joinRootFile(root: string, filename: string): string {
  const trimmed = root.replace(/[/\\]+$/, "");
  const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${sep}${filename}`;
}

/** Repo-root path only when no AGENTS.md exists yet — never overwrite an existing guide. */
export function unusedAgentsMdRootPath(
  gitRoot: string | undefined,
  exists: (absolutePath: string) => boolean
): string | undefined {
  if (!gitRoot?.trim()) {
    return undefined;
  }
  const target = joinRootFile(gitRoot, AGENTS_MD_FILENAME);
  return exists(target) ? undefined : target;
}

export const AGENTS_MD_SKELETON = `# Agent guide

## Canonical URLs

| Purpose | URL |
| --- | --- |
| API |  |
| Staging |  |

## Build & test

- \`npm run build\` — production build
- \`npm test\` — unit tests

## Architecture

Brief overview of services, entry points, and where to find docs.

## Agent instructions

When giving setup steps, name the surface (File / Terminal / Browser / Extension UI).
`;
