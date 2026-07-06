import * as fs from "node:fs";
import * as path from "node:path";

export function findGitRoot(startPath: string): string | undefined {
  let dir = startPath;
  try {
    dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  } catch {
    dir = path.dirname(startPath);
  }
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export function resolveGitRootFromWorkspace(options?: {
  activeFile?: string;
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  workspaceRoots?: string[];
}): string | undefined {
  if (options?.activeFile) {
    const absolute =
      options.resolveAbsolutePath?.(options.activeFile) ??
      options.workspaceRoots
        ?.map((root) => {
          const candidate = path.join(root, options.activeFile!);
          return fs.existsSync(candidate) ? candidate : undefined;
        })
        .find(Boolean);
    if (absolute) {
      const fromFile = findGitRoot(absolute);
      if (fromFile) {
        return fromFile;
      }
    }
  }

  for (const root of options?.workspaceRoots ?? []) {
    const gitRoot = findGitRoot(root);
    if (gitRoot) {
      return gitRoot;
    }
  }

  return undefined;
}
