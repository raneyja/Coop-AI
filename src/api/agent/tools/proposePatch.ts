import { normalizeRelativePath } from "../../../context/localFileContext";
import {
  countHunks,
  countUniqueFiles,
  parsePatchResponse,
  patchFileCapError,
  PATCH_SESSION_MAX_FILES
} from "../../../edit/patchParser";

type ProposedHunk = {
  search: string;
  replace: string;
};

type ProposedFile = {
  path: string;
  hunks: ProposedHunk[];
};

/**
 * Emit File: + SEARCH/REPLACE for the Patch card. Does **not** apply, write disk,
 * or open editors — Apply is the user's explicit action.
 */
export async function handleProposePatch(args: Record<string, unknown>): Promise<string> {
  const parsed = parseProposePatchArgs(args);
  if (!parsed.ok) {
    return JSON.stringify({ ok: false, applied: false, error: parsed.error });
  }

  if (parsed.files.length > PATCH_SESSION_MAX_FILES) {
    return JSON.stringify({
      ok: false,
      applied: false,
      error: patchFileCapError(parsed.files.length)
    });
  }

  const patchText = formatProposedPatches(parsed.files);
  const validated = parsePatchResponse(patchText);
  if (!validated.ok) {
    return JSON.stringify({ ok: false, applied: false, error: validated.error });
  }

  return JSON.stringify({
    ok: true,
    applied: false,
    fileCount: countUniqueFiles(validated.patches),
    hunkCount: countHunks(validated.patches),
    files: validated.patches.files.map((file) => file.relativePath),
    patchText
  });
}

function parseProposePatchArgs(
  args: Record<string, unknown>
): { ok: true; files: ProposedFile[] } | { ok: false; error: string } {
  const rawFiles = args.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { ok: false, error: "propose_patch requires a non-empty files array" };
  }

  const files: ProposedFile[] = [];
  for (const entry of rawFiles) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "Each files[] entry must be an object with path and SEARCH/REPLACE hunks" };
    }
    const row = entry as Record<string, unknown>;
    const pathValue = typeof row.path === "string" ? row.path.trim() : "";
    if (!pathValue) {
      return { ok: false, error: "Each files[] entry needs a path" };
    }
    const hunks = collectHunks(row);
    if (!hunks.ok) {
      return hunks;
    }
    files.push({ path: normalizeRelativePath(pathValue), hunks: hunks.hunks });
  }
  return { ok: true, files };
}

function collectHunks(
  row: Record<string, unknown>
): { ok: true; hunks: ProposedHunk[] } | { ok: false; error: string } {
  if (Array.isArray(row.hunks)) {
    const hunks: ProposedHunk[] = [];
    for (const hunk of row.hunks) {
      if (!hunk || typeof hunk !== "object" || Array.isArray(hunk)) {
        return { ok: false, error: "Malformed SEARCH/REPLACE: hunks must be {search, replace} objects" };
      }
      const parsed = hunkFromPair(hunk as Record<string, unknown>);
      if (!parsed.ok) {
        return parsed;
      }
      hunks.push(parsed.hunk);
    }
    if (hunks.length === 0) {
      return { ok: false, error: "Malformed SEARCH/REPLACE: files[].hunks is empty" };
    }
    return { ok: true, hunks };
  }

  const parsed = hunkFromPair(row);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, hunks: [parsed.hunk] };
}

function hunkFromPair(
  row: Record<string, unknown>
): { ok: true; hunk: ProposedHunk } | { ok: false; error: string } {
  const search = typeof row.search === "string" ? row.search : undefined;
  const replace = typeof row.replace === "string" ? row.replace : undefined;
  if (search === undefined || replace === undefined) {
    return {
      ok: false,
      error: "Malformed SEARCH/REPLACE: each hunk needs string search and replace"
    };
  }
  if (!search.length) {
    return { ok: false, error: "Malformed SEARCH/REPLACE: search block is empty" };
  }
  return { ok: true, hunk: { search, replace } };
}

function formatProposedPatches(files: ProposedFile[]): string {
  return files
    .map((file) => {
      const hunks = file.hunks.map((hunk) =>
        [
          "```patch",
          "<<<<<<< SEARCH",
          hunk.search,
          "=======",
          hunk.replace,
          ">>>>>>> REPLACE",
          "```"
        ].join("\n")
      );
      return [`File: \`${file.path}\``, "", ...hunks].join("\n");
    })
    .join("\n\n");
}
