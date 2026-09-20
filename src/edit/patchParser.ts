export type PatchHunk = {
  search: string;
  replace: string;
};

export type FilePatch = {
  relativePath: string;
  hunks: PatchHunk[];
};

export type ParsedPatchSet = {
  files: FilePatch[];
};

export type ParsePatchResult =
  | { ok: true; patches: ParsedPatchSet }
  | { ok: false; error: string };

/** Cap for one Apply session. Split larger edits rather than unbounded patch sets. */
export const PATCH_SESSION_MAX_FILES = 5;

const HUNK_PATTERN =
  /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

const FILE_HEADER_PATTERN = /^File:\s*(?:`([^`]+)`|([^\n`]+))\s*$/gim;

/** Bold / italic File: wrappers the model often emits instead of a bare File: line. */
const MARKDOWN_FILE_HEADER =
  /^\s*\*{0,2}File:\*{0,2}\s*(?:`([^`]+)`|([^\s`*]+))\s*\*{0,2}\s*$/gim;

export type ParsePatchOptions = {
  /** Open /edit file chip — used when the model omits File: headers. */
  preferredFile?: string;
};

const CITATION_FENCE_INFO =
  /^(?:\d+:\d+:|(?:startLine|start)\s*:\s*(?:endLine|end)\s*:)/i;

/**
 * Drop ```startLine:endLine:path citation fences so they never become Apply hunks.
 * Patch fences (```patch) and unfenced SEARCH/REPLACE after File: stay.
 */
export function stripCitationFences(content: string): string {
  return content.replace(/^```([^\n]*)\r?\n([\s\S]*?)^```[ \t]*$/gm, (full, info: string) => {
    if (CITATION_FENCE_INFO.test(info.trim())) {
      return "";
    }
    return full;
  });
}

export function patchFileCapError(fileCount: number): string {
  return `Patch set exceeds the ${PATCH_SESSION_MAX_FILES}-file maximum (got ${fileCount}). Split into smaller edits.`;
}

function extractHunks(text: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const re = new RegExp(HUNK_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    hunks.push({ search: match[1]!, replace: match[2]! });
  }
  return hunks;
}

/** Collapse repeated File: headers for the same path into one FilePatch. */
export function mergeFilePatchesByPath(files: FilePatch[]): FilePatch[] {
  const byPath = new Map<string, FilePatch>();
  for (const file of files) {
    const existing = byPath.get(file.relativePath);
    if (existing) {
      existing.hunks.push(...file.hunks);
    } else {
      byPath.set(file.relativePath, {
        relativePath: file.relativePath,
        hunks: [...file.hunks]
      });
    }
  }
  return [...byPath.values()];
}

export function countHunks(patches: ParsedPatchSet): number {
  return patches.files.reduce((sum, file) => sum + file.hunks.length, 0);
}

export function countUniqueFiles(patches: ParsedPatchSet): number {
  return new Set(patches.files.map((file) => file.relativePath)).size;
}

/** Resolve a preview hunk id (`hunk-0`) to its FilePatch + hunk. */
export function locateHunkById(
  patches: ParsedPatchSet,
  hunkId: string
): { file: FilePatch; hunk: PatchHunk; hunkIndex: number; globalIndex: number } | undefined {
  const match = /^hunk-(\d+)$/.exec(hunkId.trim());
  if (!match) {
    return undefined;
  }
  const target = Number(match[1]);
  if (!Number.isInteger(target) || target < 0) {
    return undefined;
  }
  let globalIndex = 0;
  for (const file of patches.files) {
    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      if (globalIndex === target) {
        return { file, hunk: file.hunks[hunkIndex]!, hunkIndex, globalIndex };
      }
      globalIndex += 1;
    }
  }
  return undefined;
}

function fileHeaderPath(match: RegExpMatchArray): string {
  return (match[1] ?? match[2] ?? "").trim();
}

/**
 * Normalize common File: variants so Apply can still build a Patch card:
 * **File:** wrappers, File: as the first line inside ```patch, case folding.
 */
export function canonicalizePatchFileHeaders(content: string): string {
  let next = content.replace(
    MARKDOWN_FILE_HEADER,
    (_full, quoted: string | undefined, bare: string | undefined) => {
      const path = (quoted ?? bare ?? "").trim();
      return path ? `File: ${path}` : _full;
    }
  );
  next = next.replace(
    /```patch[^\n]*\r?\n[ \t]*\*{0,2}File:\*{0,2}[ \t]*(?:`([^`]+)`|([^\n`]+))\s*\r?\n/gi,
    (_full, quoted: string | undefined, bare: string | undefined) => {
      const path = (quoted ?? bare ?? "").trim();
      return path ? `File: ${path}\n\`\`\`patch\n` : _full;
    }
  );
  return next;
}

function finishParsed(files: FilePatch[]): ParsePatchResult {
  const merged = mergeFilePatchesByPath(files);
  if (merged.length === 0) {
    return { ok: false, error: "No patch blocks found" };
  }
  if (merged.length > PATCH_SESSION_MAX_FILES) {
    return { ok: false, error: patchFileCapError(merged.length) };
  }
  return { ok: true, patches: { files: merged } };
}

export function parsePatchResponse(content: string, options?: ParsePatchOptions): ParsePatchResult {
  const trimmed = canonicalizePatchFileHeaders(stripCitationFences(content)).trim();
  if (!trimmed) {
    return { ok: false, error: "Empty response" };
  }

  const preferredFile = options?.preferredFile?.trim();
  FILE_HEADER_PATTERN.lastIndex = 0;
  const fileMatches = [...trimmed.matchAll(FILE_HEADER_PATTERN)];
  if (fileMatches.length === 0) {
    const hunks = extractHunks(trimmed);
    if (hunks.length > 0) {
      if (preferredFile) {
        return finishParsed([{ relativePath: preferredFile, hunks }]);
      }
      return { ok: false, error: "Patch blocks found but no File: header" };
    }
    return { ok: false, error: "No patch blocks found" };
  }

  const files: FilePatch[] = [];
  const preambleHunks = extractHunks(trimmed.slice(0, fileMatches[0]!.index));
  for (let i = 0; i < fileMatches.length; i++) {
    const match = fileMatches[i]!;
    const relativePath = fileHeaderPath(match);
    if (!relativePath) {
      return { ok: false, error: "Empty file path in File: header" };
    }

    const sectionStart = match.index! + match[0].length;
    const sectionEnd = i + 1 < fileMatches.length ? fileMatches[i + 1]!.index! : trimmed.length;
    const section = trimmed.slice(sectionStart, sectionEnd);
    const hunks = extractHunks(section);
    if (hunks.length === 0) {
      if (/<<<<<<< SEARCH/.test(section) || />>>>>>> REPLACE/.test(section)) {
        return {
          ok: false,
          error: `Malformed SEARCH/REPLACE for ${relativePath}. Use <<<<<<< SEARCH / ======= / >>>>>>> REPLACE — no files were written.`
        };
      }
      // File: after the fence, or a header with hunks in the preamble — skip empty sections.
      continue;
    }

    files.push({ relativePath, hunks });
  }

  if (preambleHunks.length > 0) {
    const path = preferredFile || fileHeaderPath(fileMatches[0]!) || files[0]?.relativePath;
    if (path) {
      files.unshift({ relativePath: path, hunks: preambleHunks });
    }
  }

  if (files.length === 0) {
    const allHunks = extractHunks(trimmed);
    const path = preferredFile || fileHeaderPath(fileMatches[0]!);
    if (allHunks.length > 0 && path) {
      return finishParsed([{ relativePath: path, hunks: allHunks }]);
    }
    const named = path || "file";
    return { ok: false, error: `No patch hunks for ${named}` };
  }

  return finishParsed(files);
}
