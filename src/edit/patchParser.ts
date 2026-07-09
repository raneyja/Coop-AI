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

const HUNK_PATTERN =
  /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

const FILE_HEADER_PATTERN = /^File:\s*(?:`([^`]+)`|([^\n`]+))\s*$/gm;

function extractHunks(text: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const re = new RegExp(HUNK_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    hunks.push({ search: match[1]!, replace: match[2]! });
  }
  return hunks;
}

export function countHunks(patches: ParsedPatchSet): number {
  return patches.files.reduce((sum, file) => sum + file.hunks.length, 0);
}

export function parsePatchResponse(content: string): ParsePatchResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty response" };
  }

  const fileMatches = [...trimmed.matchAll(FILE_HEADER_PATTERN)];
  if (fileMatches.length === 0) {
    if (extractHunks(trimmed).length > 0) {
      return { ok: false, error: "Patch blocks found but no File: header" };
    }
    return { ok: false, error: "No patch blocks found" };
  }

  const files: FilePatch[] = [];
  for (let i = 0; i < fileMatches.length; i++) {
    const match = fileMatches[i]!;
    const relativePath = (match[1] ?? match[2] ?? "").trim();
    if (!relativePath) {
      return { ok: false, error: "Empty file path in File: header" };
    }

    const sectionStart = match.index! + match[0].length;
    const sectionEnd = i + 1 < fileMatches.length ? fileMatches[i + 1]!.index! : trimmed.length;
    const section = trimmed.slice(sectionStart, sectionEnd);
    const hunks = extractHunks(section);
    if (hunks.length === 0) {
      return { ok: false, error: `No patch hunks for ${relativePath}` };
    }

    files.push({ relativePath, hunks });
  }

  return { ok: true, patches: { files } };
}
