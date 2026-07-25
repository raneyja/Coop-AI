import * as fs from "node:fs";
import type { RepoContextFileSource } from "../chat/types";

export const LOCAL_FILE_MAX_BYTES = 80_000;
export const LOCAL_FILE_MAX_FILES = 3;
const LINE_CONTEXT_PADDING = 5;

export type LocalFileSnippet = {
  path: string;
  content: string;
  encoding?: string;
  lineRange?: [number, number];
};

export type LocalFileContextPayload = {
  source: "local-workspace" | "remote-codehost";
  activeFile: string;
  files: LocalFileSnippet[];
  fallbackLevel: "partial";
};

export function normalizeRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isLocalDiskFileSource(fileSource: string | undefined): fileSource is RepoContextFileSource {
  return fileSource === "workspace" || fileSource === "git";
}

export function hasLocalDiskContext(params: { file?: string; fileSource?: string }): boolean {
  if (!params.file?.trim()) {
    return false;
  }
  if (isLocalDiskFileSource(params.fileSource)) {
    return true;
  }
  // Restored context may omit fileSource; still attempt a workspace read unless explicitly non-local.
  return params.fileSource !== "remote" && params.fileSource !== "external";
}

export function rankLocalFilePaths(options: {
  activeFile: string;
  openEditors?: string[];
  maxFiles: number;
}): string[] {
  const seen = new Set<string>();
  const ranked: string[] = [];
  const push = (filePath: string | undefined) => {
    if (!filePath || seen.has(filePath)) {
      return;
    }
    seen.add(filePath);
    ranked.push(filePath);
  };

  push(normalizeRelativePath(options.activeFile));
  for (const openPath of options.openEditors ?? []) {
    push(normalizeRelativePath(openPath));
    if (ranked.length >= options.maxFiles) {
      break;
    }
  }
  return ranked.slice(0, options.maxFiles);
}

export function sliceFileContent(
  content: string,
  lines?: { start: number; end: number }
): { content: string; lineRange?: [number, number] } {
  if (!lines) {
    return { content };
  }

  const allLines = content.split(/\r?\n/);
  const start = Math.max(1, lines.start - LINE_CONTEXT_PADDING);
  const end = Math.min(allLines.length, lines.end + LINE_CONTEXT_PADDING);
  if (start > end) {
    return { content };
  }

  return {
    content: allLines.slice(start - 1, end).join("\n"),
    lineRange: [start, end]
  };
}

/** Read file bytes from a known absolute path (e.g. open editor tab URI). */
export function readWorkspaceFileFromAbsolutePath(
  absolutePath: string,
  relativePath: string,
  lines?: { start: number; end: number }
): LocalFileContextPayload | undefined {
  const normalized = normalizeRelativePath(relativePath);
  let raw: string;
  try {
    raw = fs.readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }

  const sliced = sliceFileContent(raw, lines);
  return {
    source: "local-workspace",
    activeFile: normalized,
    files: [
      {
        path: normalized,
        content: sliced.content,
        encoding: "utf8",
        ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
      }
    ],
    fallbackLevel: "partial"
  };
}

export async function readLocalWorkspaceFiles(options: {
  file: string;
  fileSource?: string;
  openEditors?: string[];
  lines?: { start: number; end: number };
  resolveAbsolutePath: (relativePath: string) => string | undefined;
  maxFiles?: number;
  maxBytesPerFile?: number;
}): Promise<LocalFileContextPayload | undefined> {
  if (!hasLocalDiskContext(options)) {
    return undefined;
  }

  const activeFile = normalizeRelativePath(options.file);
  const resolvePath = options.resolveAbsolutePath;
  const maxFiles = options.maxFiles ?? LOCAL_FILE_MAX_FILES;
  const maxBytes = options.maxBytesPerFile ?? LOCAL_FILE_MAX_BYTES;
  const paths = rankLocalFilePaths({
    activeFile,
    openEditors: options.openEditors,
    maxFiles
  });

  const files: LocalFileSnippet[] = [];
  for (const filePath of paths) {
    const absolutePath = resolvePath(filePath);
    if (!absolutePath) {
      continue;
    }

    let raw: string;
    try {
      const buffer = fs.readFileSync(absolutePath);
      if (buffer.byteLength > maxBytes) {
        raw = buffer.subarray(0, maxBytes).toString("utf8");
      } else {
        raw = buffer.toString("utf8");
      }
    } catch {
      continue;
    }

    const sliced =
      filePath === activeFile ? sliceFileContent(raw, options.lines) : { content: raw, lineRange: undefined };
    files.push({
      path: filePath,
      content: sliced.content,
      encoding: "utf8",
      ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
    });
  }

  if (files.length === 0) {
    return undefined;
  }

  return {
    source: "local-workspace",
    activeFile,
    files,
    fallbackLevel: "partial"
  };
}

export function attachLocalFilesToData(
  data: Record<string, unknown> | undefined,
  local: LocalFileContextPayload
): Record<string, unknown> {
  return {
    ...(data ?? {}),
    localFiles: local,
    fallbackLevel: local.fallbackLevel
  };
}

export function localFilesFromContextData(data: unknown): LocalFileSnippet[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const localFiles = (data as { localFiles?: LocalFileContextPayload }).localFiles;
  if (!localFiles?.files?.length) {
    return [];
  }
  return localFiles.files.filter((file) => file.path && file.content);
}
