import * as fs from "node:fs";
import * as path from "node:path";

export type ProjectInstructionKind = "agents-md" | "cursor-rule";

export type ProjectInstructionFile = {
  path: string;
  content: string;
  kind: ProjectInstructionKind;
};

export const MAX_INSTRUCTION_FILE_CHARS = 12_000;

/** Remote Use-repo paths fetched via IndexedRepoWorkspace.readFile (Zero-Clone). */
export const REMOTE_TEAM_INSTRUCTION_PATHS = ["AGENTS.md"] as const;

/** AGENTS.md injects every turn when enabled. Prompt library stays user-picked. */
export const PROJECT_INSTRUCTIONS_INJECTION_MODE = "always-on" as const;

/** Internal-only — never a chat banner, Sources chip, or activity row (UX-G6). */
export const INSTRUCTION_TRUNCATE_NOTE =
  "INTERNAL: instruction file truncated at 12000 characters; omitted remainder is not shown to the user.";

export const PROJECT_INSTRUCTIONS_SILENCE_NOTE =
  "INTERNAL: do not mention AGENTS.md, team instructions, or memory as a chat banner, Sources chip, or activity row.";

export function capInstructionContent(raw: string): { content: string; truncated: boolean } {
  if (raw.length <= MAX_INSTRUCTION_FILE_CHARS) {
    return { content: raw, truncated: false };
  }
  return {
    content: `${raw.slice(0, MAX_INSTRUCTION_FILE_CHARS)}\n… [truncated]\n${INSTRUCTION_TRUNCATE_NOTE}`,
    truncated: true
  };
}

type ReadFileFn = (absolutePath: string) => string | undefined;
type ListDirFn = (absoluteDir: string) => string[];
type ExistsFn = (absolutePath: string) => boolean;

export function findGitRoot(startPath: string, exists: ExistsFn = fs.existsSync): string | undefined {
  let dir = path.resolve(startPath);
  const { root } = path.parse(dir);
  while (true) {
    if (exists(path.join(dir, ".git"))) {
      return dir;
    }
    if (dir === root) {
      return undefined;
    }
    dir = path.dirname(dir);
  }
}

export function normalizeInstructionPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function parseMdcFrontmatter(text: string): { alwaysApply: boolean; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { alwaysApply: false, body: text };
  }
  let alwaysApply = false;
  for (const line of match[1].split(/\r?\n/)) {
    const valueMatch = line.match(/^alwaysApply\s*:\s*(.+)$/i);
    if (!valueMatch) {
      continue;
    }
    const value = valueMatch[1].trim().toLowerCase();
    alwaysApply = value === "true" || value === "yes";
  }
  return { alwaysApply, body: match[2] };
}

export function collectNestedAgentsMdPaths(gitRoot: string, activeFile: string, exists: ExistsFn = fs.existsSync): string[] {
  const normalized = normalizeInstructionPath(activeFile);
  const fileDir = path.dirname(normalized);
  if (!fileDir || fileDir === ".") {
    return [];
  }

  const dirs: string[] = [];
  let current = fileDir;
  while (current && current !== ".") {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  dirs.reverse();

  const paths: string[] = [];
  for (const dir of dirs) {
    const relative = path.posix.join(dir, "AGENTS.md");
    if (exists(path.join(gitRoot, relative))) {
      paths.push(relative);
    }
  }
  return paths;
}

function readInstructionFile(
  gitRoot: string,
  relativePath: string,
  kind: ProjectInstructionKind,
  readFile: ReadFileFn
): ProjectInstructionFile | undefined {
  const absolute = path.join(gitRoot, relativePath);
  const raw = readFile(absolute);
  if (raw === undefined) {
    return undefined;
  }
  return {
    path: normalizeInstructionPath(relativePath),
    content: capInstructionContent(raw).content,
    kind
  };
}

function loadAlwaysApplyCursorRules(
  gitRoot: string,
  readFile: ReadFileFn,
  listDir: ListDirFn
): ProjectInstructionFile[] {
  const rulesDir = path.join(gitRoot, ".cursor", "rules");
  let entries: string[];
  try {
    entries = listDir(rulesDir).filter((name) => name.endsWith(".mdc")).sort();
  } catch {
    return [];
  }

  const files: ProjectInstructionFile[] = [];
  for (const name of entries) {
    const relative = path.posix.join(".cursor/rules", name);
    const raw = readFile(path.join(gitRoot, relative));
    if (raw === undefined) {
      continue;
    }
    const parsed = parseMdcFrontmatter(raw);
    if (!parsed.alwaysApply) {
      continue;
    }
    const body = parsed.body.trim();
    if (!body) {
      continue;
    }
    files.push({
      path: normalizeInstructionPath(relative),
      content: capInstructionContent(body).content,
      kind: "cursor-rule"
    });
  }
  return files;
}

export type LoadProjectInstructionsOptions = {
  gitRoot: string;
  activeFile?: string;
  readFile?: ReadFileFn;
  listDir?: ListDirFn;
  exists?: ExistsFn;
};

export type LoadedProjectInstructions = {
  files: ProjectInstructionFile[];
  sourcePaths: string[];
};

export function loadProjectInstructions(options: LoadProjectInstructionsOptions): LoadedProjectInstructions {
  const gitRoot = path.resolve(options.gitRoot);
  const readFile =
    options.readFile ??
    ((absolutePath: string): string | undefined => {
      try {
        return fs.readFileSync(absolutePath, "utf8");
      } catch {
        return undefined;
      }
    });
  const listDir =
    options.listDir ??
    ((absoluteDir: string): string[] => {
      return fs.readdirSync(absoluteDir);
    });
  const exists = options.exists ?? fs.existsSync;

  const seen = new Set<string>();
  const files: ProjectInstructionFile[] = [];
  const sourcePaths: string[] = [];

  const pushFile = (relativePath: string, kind: ProjectInstructionKind): void => {
    const normalized = normalizeInstructionPath(relativePath);
    if (seen.has(normalized)) {
      return;
    }
    const absolute = path.join(gitRoot, normalized);
    if (!exists(absolute)) {
      return;
    }
    const loaded = readInstructionFile(gitRoot, normalized, kind, readFile);
    if (!loaded) {
      return;
    }
    seen.add(normalized);
    sourcePaths.push(absolute);
    files.push(loaded);
  };

  pushFile("AGENTS.md", "agents-md");

  const activeFile = options.activeFile?.trim();
  if (activeFile) {
    for (const nested of collectNestedAgentsMdPaths(gitRoot, activeFile, exists)) {
      pushFile(nested, "agents-md");
    }
  }

  for (const rule of loadAlwaysApplyCursorRules(gitRoot, readFile, listDir)) {
    if (seen.has(rule.path)) {
      continue;
    }
    seen.add(rule.path);
    sourcePaths.push(path.join(gitRoot, rule.path));
    files.push(rule);
  }

  return { files, sourcePaths };
}

/**
 * User-uploaded or Coop-created AGENTS.md. Never used to scan the open folder.
 */
export function loadAttachedAgentsMdFile(
  fsPath: string,
  readFile: ReadFileFn = (absolutePath) => {
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  }
): ProjectInstructionFile | undefined {
  const trimmed = fsPath.trim();
  if (!trimmed) {
    return undefined;
  }
  const raw = readFile(trimmed);
  if (raw === undefined || !raw.trim()) {
    return undefined;
  }
  return {
    path: path.basename(trimmed),
    content: capInstructionContent(raw).content,
    kind: "agents-md"
  };
}

export function formatProjectInstructionsBlock(files: ProjectInstructionFile[]): string {
  if (!files.length) {
    return "";
  }
  const lines: string[] = ["<project_instructions>"];
  lines.push(
    "Persistent project rules and agent guides from the Use-repo (AGENTS.md and team instruction files)."
  );
  lines.push(PROJECT_INSTRUCTIONS_SILENCE_NOTE);
  for (const file of files) {
    lines.push(`<instruction path="${file.path}" kind="${file.kind}">`);
    lines.push(file.content);
    lines.push("</instruction>");
  }
  lines.push("</project_instructions>");
  return lines.join("\n");
}

export function joinInstructionBlocks(...blocks: Array<string | undefined>): string | undefined {
  const parts = blocks.map((block) => block?.trim()).filter((block): block is string => Boolean(block));
  return parts.length ? parts.join("\n\n") : undefined;
}

export type RemoteInstructionReader = (path: string) => Promise<string | undefined>;

export async function loadRemoteProjectInstructions(options: {
  readFile: RemoteInstructionReader;
  timeoutMs: number;
  paths?: readonly string[];
}): Promise<LoadedProjectInstructions> {
  const paths = options.paths ?? REMOTE_TEAM_INSTRUCTION_PATHS;
  if (options.timeoutMs <= 0) {
    return { files: [], sourcePaths: [] };
  }

  let timedOut = false;
  const loaded = await Promise.race([
    readRemoteInstructionFiles(paths, options.readFile),
    new Promise<undefined>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve(undefined);
      }, options.timeoutMs);
    })
  ]);

  if (timedOut || !loaded) {
    return { files: [], sourcePaths: [] };
  }
  return loaded;
}

async function readRemoteInstructionFiles(
  paths: readonly string[],
  readFile: RemoteInstructionReader
): Promise<LoadedProjectInstructions> {
  const files: ProjectInstructionFile[] = [];
  const sourcePaths: string[] = [];
  const results = await Promise.all(
    paths.map(async (relativePath) => {
      try {
        const raw = await readFile(relativePath);
        return { relativePath, raw };
      } catch {
        return { relativePath, raw: undefined };
      }
    })
  );
  for (const { relativePath, raw } of results) {
    if (raw === undefined || !raw.trim()) {
      continue;
    }
    const normalized = normalizeInstructionPath(relativePath);
    files.push({
      path: normalized,
      content: capInstructionContent(raw).content,
      kind: "agents-md"
    });
    sourcePaths.push(normalized);
  }
  return { files, sourcePaths };
}

export function resolveProjectInstructionsGitRoot(options: {
  activeFile?: string;
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  workspaceRoots?: string[];
  exists?: ExistsFn;
}): string | undefined {
  const exists = options.exists ?? fs.existsSync;

  if (options.activeFile?.trim() && options.resolveAbsolutePath) {
    const absolute = options.resolveAbsolutePath(options.activeFile.trim());
    if (absolute) {
      const fromFile = findGitRoot(path.dirname(absolute), exists);
      if (fromFile) {
        return fromFile;
      }
    }
  }

  for (const workspaceRoot of options.workspaceRoots ?? []) {
    const resolvedRoot = path.resolve(workspaceRoot);
    const gitRoot = findGitRoot(resolvedRoot, exists);
    if (gitRoot) {
      return gitRoot;
    }
    if (exists(path.join(resolvedRoot, ".git"))) {
      return resolvedRoot;
    }
  }

  return undefined;
}
