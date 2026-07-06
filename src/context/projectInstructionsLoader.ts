import * as fs from "node:fs";
import * as path from "node:path";

export type ProjectInstructionKind = "agents-md" | "cursor-rule";

export type ProjectInstructionFile = {
  path: string;
  content: string;
  kind: ProjectInstructionKind;
};

export const MAX_INSTRUCTION_FILE_CHARS = 12_000;

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
  const content =
    raw.length > MAX_INSTRUCTION_FILE_CHARS
      ? `${raw.slice(0, MAX_INSTRUCTION_FILE_CHARS)}\n… [truncated]`
      : raw;
  return {
    path: normalizeInstructionPath(relativePath),
    content,
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
    const content =
      body.length > MAX_INSTRUCTION_FILE_CHARS
        ? `${body.slice(0, MAX_INSTRUCTION_FILE_CHARS)}\n… [truncated]`
        : body;
    files.push({
      path: normalizeInstructionPath(relative),
      content,
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

export function formatProjectInstructionsBlock(files: ProjectInstructionFile[]): string {
  if (!files.length) {
    return "";
  }
  const lines: string[] = ["<project_instructions>"];
  lines.push(
    "Persistent project rules and agent guides from the local workspace (AGENTS.md and Cursor alwaysApply rules)."
  );
  for (const file of files) {
    lines.push(`<instruction path="${file.path}" kind="${file.kind}">`);
    lines.push(file.content);
    lines.push("</instruction>");
  }
  lines.push("</project_instructions>");
  return lines.join("\n");
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
