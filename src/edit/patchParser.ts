import { countEmbeddedOptionMarkers } from "./editOptionsIntent";

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

/**
 * Matches an "option" header line the model emits when the user asked for
 * several alternative rewrites, e.g.:
 *   Option 1: Extract a helper
 *   Option 1 — Guard against re-init
 *   ## Option B — inline the loop
 *   **Alternative 2:** use reduce
 * Requires a separator after the label so prose like "Options are limited" does
 * not register as a header.
 */
const OPTION_HEADER_PATTERN =
  /^[ \t>*#]*(?:Option|Alternative)\s*([0-9]+|[A-Za-z])?\s*[:.\-–—)]+\s*(.*?)\s*\*{0,2}\s*$/i;

/** Captures a Summary / TL;DR / Why line the model puts under an option. */
const TLDR_LINE_PATTERN =
  /^(?:Summary|TL;?DR|Why|Rationale)(?:\s*\([^)]*\))?\s*[:.\-–—)]\s*(.+)$/i;

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

export type PatchVariant = {
  /** Stable id, unique within a single assistant message (e.g. "v0", "v1"). */
  id: string;
  /** Human label shown on the card, e.g. "Option 1: Extract helper". */
  label: string;
  /** 0-based order the option was emitted in. */
  index: number;
  patches: ParsedPatchSet;
  /** Short rationale for this option (TL;DR), when the user asked for one. */
  summary?: string;
};

export type ParsePatchVariantsResult =
  | { ok: true; variants: PatchVariant[] }
  | { ok: false; error: string };

type OptionHeader = { lineIndex: number; id: string | undefined; label: string };

function normalizeOptionLabel(rawId: string | undefined, rawLabel: string, ordinal: number): string {
  const id = (rawId ?? "").trim();
  // Strip leftover markdown and trailing "TL;DR…" that some models glue onto the header.
  let label = rawLabel.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  label = label.replace(/\s*TL;?DR\b.*$/i, "").trim();
  const heading = id ? `Option ${id}` : `Option ${ordinal}`;
  return label ? `${heading}: ${label}` : heading;
}

function findOptionHeaders(lines: string[]): OptionHeader[] {
  const headers: OptionHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = OPTION_HEADER_PATTERN.exec(lines[i]!);
    if (!match) {
      continue;
    }
    // Skip lines that are themselves a summary labeled with an option number —
    // "Summary (Option 1): …" / "TL;DR (Option 1): …" are rationale lines, not option headers.
    if (/^(?:Summary|TL;?DR)\b/i.test(lines[i]!.trim())) {
      continue;
    }
    headers.push({ lineIndex: i, id: match[1], label: match[2] ?? "" });
  }
  return headers;
}

/**
 * Pulls a short rationale out of an option section. Prefers an explicit
 * TL;DR / Why line; otherwise uses the first non-empty prose paragraph that
 * is not a File header or fence.
 */
export function extractOptionSummary(section: string): string | undefined {
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const tldr = TLDR_LINE_PATTERN.exec(trimmed);
    if (tldr) {
      return tldr[1]!.trim();
    }
  }

  const prose: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (/^File:\s/i.test(trimmed)) {
      continue;
    }
    if (OPTION_HEADER_PATTERN.test(trimmed) || TLDR_LINE_PATTERN.test(trimmed)) {
      continue;
    }
    if (!trimmed) {
      if (prose.length > 0) {
        break;
      }
      continue;
    }
    prose.push(trimmed);
    if (prose.join(" ").length > 280) {
      break;
    }
  }
  const joined = prose.join(" ").trim();
  return joined || undefined;
}

function singleVariant(patches: ParsedPatchSet, summary?: string): PatchVariant[] {
  return [{ id: "v0", label: "", index: 0, patches, summary }];
}

/** Flatten a patch set into ordered (path, hunk) pairs for redistribution. */
function flattenHunks(patches: ParsedPatchSet): Array<{ relativePath: string; hunk: PatchHunk }> {
  const flat: Array<{ relativePath: string; hunk: PatchHunk }> = [];
  for (const file of patches.files) {
    for (const hunk of file.hunks) {
      flat.push({ relativePath: file.relativePath, hunk });
    }
  }
  return flat;
}

function patchSetFromFlat(
  items: Array<{ relativePath: string; hunk: PatchHunk }>
): ParsedPatchSet {
  const byPath = new Map<string, PatchHunk[]>();
  const order: string[] = [];
  for (const item of items) {
    if (!byPath.has(item.relativePath)) {
      byPath.set(item.relativePath, []);
      order.push(item.relativePath);
    }
    byPath.get(item.relativePath)!.push(item.hunk);
  }
  return {
    files: order.map((relativePath) => ({
      relativePath,
      hunks: byPath.get(relativePath)!
    }))
  };
}

/**
 * When the model dumps every SEARCH/REPLACE first and only then lists
 * "Option N — … / TL;DR" prose, redistribute the preceding patches so each
 * option becomes its own card instead of one mashed apply set.
 */
function distributePatchesAcrossOptions(
  patches: ParsedPatchSet,
  optionCount: number
): ParsedPatchSet[] | undefined {
  if (optionCount < 2) {
    return undefined;
  }

  // Prefer one File: block per option (even when the path repeats).
  if (patches.files.length === optionCount) {
    return patches.files.map((file) => ({ files: [file] }));
  }

  const flat = flattenHunks(patches);
  if (flat.length < optionCount) {
    return undefined;
  }

  // One hunk per option when counts match.
  if (flat.length === optionCount) {
    return flat.map((item) => patchSetFromFlat([item]));
  }

  // Even chunks when hunks divide cleanly (e.g. 6 hunks → 3 options of 2).
  if (flat.length % optionCount === 0) {
    const chunk = flat.length / optionCount;
    const groups: ParsedPatchSet[] = [];
    for (let i = 0; i < optionCount; i++) {
      groups.push(patchSetFromFlat(flat.slice(i * chunk, (i + 1) * chunk)));
    }
    return groups;
  }

  // Otherwise assign hunks round-robin-ish by contiguous slices sized as evenly
  // as possible — better than merging mutually exclusive rewrites into one card.
  const base = Math.floor(flat.length / optionCount);
  const extra = flat.length % optionCount;
  const groups: ParsedPatchSet[] = [];
  let cursor = 0;
  for (let i = 0; i < optionCount; i++) {
    const size = base + (i < extra ? 1 : 0);
    if (size === 0) {
      return undefined;
    }
    groups.push(patchSetFromFlat(flat.slice(cursor, cursor + size)));
    cursor += size;
  }
  return groups;
}

function buildVariantsFromSections(
  lines: string[],
  headers: OptionHeader[]
): PatchVariant[] {
  const variants: PatchVariant[] = [];
  for (let h = 0; h < headers.length; h++) {
    const startLine = headers[h]!.lineIndex + 1;
    const endLine = h + 1 < headers.length ? headers[h + 1]!.lineIndex : lines.length;
    const section = lines.slice(startLine, endLine).join("\n");
    const parsed = parsePatchResponse(section);
    if (!parsed.ok) {
      continue;
    }
    variants.push({
      id: `v${variants.length}`,
      label: normalizeOptionLabel(headers[h]!.id, headers[h]!.label, variants.length + 1),
      index: variants.length,
      patches: parsed.patches,
      summary: extractOptionSummary(section)
    });
  }
  return variants;
}

/**
 * Parses an /edit response into one or more selectable variants.
 *
 * Happy path: each `Option N:` header wraps its own File/SEARCH/REPLACE (+ optional TL;DR).
 * Recovery path: model dumps all patches first, then lists Option/TL;DR prose —
 * redistribute those patches across the option headers so the UI never merges
 * mutually exclusive rewrites into one apply card.
 * Reject path: model buries Option 1/2/3 as comments inside one REPLACE — that is
 * not a valid multi-option reply; fail instead of showing a fake single card.
 */
export function parsePatchVariants(content: string): ParsePatchVariantsResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty response" };
  }

  const embeddedCount = countEmbeddedOptionMarkers(trimmed);
  const lines = trimmed.split(/\r?\n/);
  const headers = findOptionHeaders(lines);

  // Classic single patch — no option headers.
  if (headers.length < 2) {
    if (embeddedCount >= 2) {
      return {
        ok: false,
        error:
          "Those alternatives were packed into one code block as comments, so I can't offer separate Apply cards. Run /edit again — I'll emit one Option block (File: + SEARCH/REPLACE + Summary) per alternative."
      };
    }
    const single = parsePatchResponse(trimmed);
    return single.ok ? { ok: true, variants: singleVariant(single.patches) } : single;
  }

  // Happy path: each option section carries its own patches.
  const sectionVariants = buildVariantsFromSections(lines, headers);
  if (sectionVariants.length >= 2) {
    return { ok: true, variants: sectionVariants };
  }

  // Recovery: options were listed after a patch dump (or only one section had hunks).
  const firstHeaderLine = headers[0]!.lineIndex;
  const prelude = lines.slice(0, firstHeaderLine).join("\n");
  const preludeParsed = parsePatchResponse(prelude);
  if (!preludeParsed.ok) {
    if (embeddedCount >= 2) {
      return {
        ok: false,
        error:
          "Those alternatives were packed into one code block as comments, so I can't offer separate Apply cards. Run /edit again — I'll emit one Option block (File: + SEARCH/REPLACE + Summary) per alternative."
      };
    }
    // Last resort: parse the whole response as one patch (legacy behavior).
    const single = parsePatchResponse(trimmed);
    return single.ok ? { ok: true, variants: singleVariant(single.patches) } : single;
  }

  const distributed = distributePatchesAcrossOptions(preludeParsed.patches, headers.length);
  if (!distributed || distributed.length !== headers.length) {
    return {
      ok: false,
      error:
        "I found several option labels, but the patches weren't separated per option. Ask again with /edit — I'll emit one Option block (with its own File: + SEARCH/REPLACE and Summary) per alternative."
    };
  }

  const variants: PatchVariant[] = headers.map((header, index) => {
    const startLine = header.lineIndex + 1;
    const endLine = index + 1 < headers.length ? headers[index + 1]!.lineIndex : lines.length;
    const section = lines.slice(startLine, endLine).join("\n");
    return {
      id: `v${index}`,
      label: normalizeOptionLabel(header.id, header.label, index + 1),
      index,
      patches: distributed[index]!,
      summary: extractOptionSummary(section)
    };
  });

  return { ok: true, variants };
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
