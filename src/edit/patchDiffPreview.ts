import type {
  PatchCardState,
  PatchDiffLine,
  PatchMatchLocation,
  PatchMatchProposal,
  PatchPreviewFile,
  PatchPreviewHunk,
  PatchSharedMatchGroup,
  PatchSharedMatchLocation
} from "../chat/types";
import { enclosingDefinitionAnchor } from "../context/enclosingDefinitionRange";
import { findAllSearchMatches, findSearchMatch, type SearchMatchHit } from "./patchContent";
import { extractInsertedPrefix } from "./snapPatchToSelection";
import { countHunks, countUniqueFiles, type ParsedPatchSet, type PatchHunk } from "./patchParser";
import { getSuppressedMessageTimestamps, markMessageMarkdownSuppressed } from "./patchSession";
import { lookupPatchFileContent } from "./patchFileContents";
import { collectOpenPatchFileBytes } from "./patchTarget";

const CONTEXT_LINES = 2;
const ANCHOR_LOOKBACK = 12;

export type PatchStatePublisher = (state: PatchCardState) => void;

export const PATCH_CARD_IDLE: PatchCardState = {
  status: "idle",
  fileCount: 0,
  hunkCount: 0,
  files: [],
  canCreatePr: false
};

/**
 * Registers `state`'s message (when it suppresses markdown) in the session-wide
 * suppression list, then stamps the full accumulated list onto the returned state.
 * Every card we publish or hand back to the webview should be passed through this so
 * a newer /edit patch replacing the "live" card never resurfaces an older message's
 * raw SEARCH/REPLACE fence.
 */
export function withSuppressionRegistry(state: PatchCardState): PatchCardState {
  if (state.suppressMarkdown) {
    markMessageMarkdownSuppressed(state.messageTimestamp);
  }
  return { ...state, suppressedMessageTimestamps: getSuppressedMessageTimestamps() };
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/);
}

function readWorkspaceFile(
  relativePath: string,
  overrides?: Readonly<Record<string, string>>,
  search?: string
): string {
  const live = collectOpenPatchFileBytes(relativePath, { search });
  if (live?.trim()) {
    return live;
  }
  return lookupPatchFileContent(relativePath, overrides) ?? "";
}

function lineIndexAtOffset(content: string, offset: number): number {
  if (offset <= 0) {
    return 0;
  }
  const prefix = content.slice(0, offset);
  const lines = splitLines(prefix);
  return Math.max(0, lines.length - 1);
}

export function matchLocationId(index: number): string {
  return `loc-${index}`;
}

export function parseMatchLocationIndex(locationId: string): number | undefined {
  const match = /^loc-(\d+)$/.exec(locationId);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

function sharedLocationId(startLine: number, endLine: number): string {
  return `line-${startLine}-${endLine}`;
}

function proposalId(hunkId: string, matchIndex: number): string {
  return `${hunkId}:${matchIndex}`;
}

function buildReplaceLines(hunk: PatchHunk): PatchDiffLine[] {
  return splitLines(hunk.replace).map((line) => ({ kind: "add" as const, text: line }));
}

function buildUnmatchedHunkPreview(hunk: PatchHunk, hunkId: string): PatchPreviewHunk {
  const lines: PatchDiffLine[] = [];
  for (const line of splitLines(hunk.search)) {
    lines.push({ kind: "remove", text: line });
  }
  for (const line of buildReplaceLines(hunk)) {
    lines.push(line);
  }
  return { id: hunkId, lines, matchStatus: "not_found", status: "pending" };
}

function insertAbovePrefix(hunk: PatchHunk): string | undefined {
  const search = hunk.search;
  const replace = hunk.replace;
  if (!search || replace.length <= search.length) {
    return undefined;
  }
  if (replace.endsWith(search)) {
    return extractInsertedPrefix(replace, search);
  }
  const replaceLines = splitLines(replace);
  const searchLines = splitLines(search);
  if (replaceLines.length <= searchLines.length) {
    return undefined;
  }
  const extraCount = replaceLines.length - searchLines.length;
  const rest = replaceLines.slice(extraCount).join("\n");
  if (rest !== search) {
    return undefined;
  }
  return extractInsertedPrefix(replace, search);
}

function buildLocationPreviewLines(
  content: string,
  hit: SearchMatchHit,
  hunk: PatchHunk
): {
  lines: PatchDiffLine[];
  startLine: number;
  endLine: number;
  anchorLabel?: string;
} {
  const contentLines = splitLines(content);
  const matchedLines = splitLines(hit.matched);
  const startLineIdx = lineIndexAtOffset(content, hit.start);
  const endLineIdx = startLineIdx + Math.max(matchedLines.length, 1) - 1;
  const fallbackStart = Math.max(0, startLineIdx - CONTEXT_LINES);
  const anchor = enclosingDefinitionAnchor(content, startLineIdx + 1);
  const fromAnchor = anchor
    ? Math.max(0, anchor.contextLine - 1)
    : fallbackStart;
  const contextStart = Math.max(
    Math.max(0, startLineIdx - ANCHOR_LOOKBACK),
    Math.min(fallbackStart, fromAnchor)
  );
  const contextEnd = Math.min(contentLines.length - 1, endLineIdx + CONTEXT_LINES);

  const lines: PatchDiffLine[] = [];
  for (let i = contextStart; i < startLineIdx; i++) {
    lines.push({ kind: "context", text: contentLines[i] ?? "", lineNumber: i + 1 });
  }
  const inserted = insertAbovePrefix(hunk);
  let newLine = startLineIdx + 1;
  if (inserted !== undefined) {
    for (const line of splitLines(inserted)) {
      lines.push({ kind: "add", text: line, lineNumber: newLine });
      newLine += 1;
    }
    for (let i = 0; i < matchedLines.length; i++) {
      lines.push({
        kind: "context",
        text: matchedLines[i] ?? "",
        lineNumber: newLine
      });
      newLine += 1;
    }
  } else {
    for (let i = 0; i < matchedLines.length; i++) {
      lines.push({
        kind: "remove",
        text: matchedLines[i] ?? "",
        lineNumber: startLineIdx + i + 1
      });
    }
    for (const line of buildReplaceLines(hunk)) {
      lines.push({ ...line, lineNumber: newLine });
      newLine += 1;
    }
  }
  for (let i = endLineIdx + 1; i <= contextEnd; i++) {
    lines.push({ kind: "context", text: contentLines[i] ?? "", lineNumber: newLine });
    newLine += 1;
  }

  return {
    lines,
    startLine: startLineIdx + 1,
    endLine: endLineIdx + 1,
    anchorLabel: anchor?.label
  };
}

function buildMatchedHunkPreview(content: string, hunk: PatchHunk, hunkId: string): PatchPreviewHunk {
  const match = findSearchMatch(content, hunk.search);
  if (!match.ok) {
    return { ...buildUnmatchedHunkPreview(hunk, hunkId), matchStatus: "not_found" };
  }

  const preview = buildLocationPreviewLines(content, match, hunk);
  return {
    id: hunkId,
    lines: preview.lines,
    matchStatus: "matched",
    status: "pending",
    anchorLabel: preview.anchorLabel,
    startLine: preview.startLine,
    endLine: preview.endLine
  };
}

function buildAmbiguousHunkPreview(
  content: string,
  hunk: PatchHunk,
  hunkId: string,
  matches: SearchMatchHit[],
  previousSelected?: ReadonlySet<string>
): PatchPreviewHunk {
  const matchLocations: PatchMatchLocation[] = matches.map((hit, index) => {
    const id = matchLocationId(index);
    const preview = buildLocationPreviewLines(content, hit, hunk);
    return {
      id,
      startLine: preview.startLine,
      endLine: preview.endLine,
      lines: preview.lines,
      selected: previousSelected?.has(id) ?? false
    };
  });

  return {
    id: hunkId,
    lines: buildReplaceLines(hunk),
    matchStatus: "ambiguous",
    matchLocations,
    status: "pending"
  };
}

function buildPairedHunkPreview(
  content: string,
  hunk: PatchHunk,
  hunkId: string,
  hit: SearchMatchHit,
  matchIndex: number
): PatchPreviewHunk {
  const preview = buildLocationPreviewLines(content, hit, hunk);
  return {
    id: hunkId,
    lines: preview.lines,
    matchStatus: "matched",
    resolvedMatchIndices: [matchIndex],
    status: "pending",
    anchorLabel: preview.anchorLabel,
    startLine: preview.startLine,
    endLine: preview.endLine
  };
}

type PriorSharedSelection = {
  locationId: string;
  proposalId: string;
};

function locationFingerprint(preview: PatchPreviewHunk): string {
  return (preview.matchLocations ?? [])
    .map((location) => `${location.startLine}:${location.endLine}`)
    .join("|");
}

/**
 * When several hunks hit the same ambiguous places in a file (same line spans):
 * - Equal hunk/match counts → pair hunk[i] to match[i] (one edit per place, no picker).
 * - Otherwise → one shared location list (checkbox = place; at most one edit per place).
 *
 * Grouping is by preview line spans, not raw SEARCH bytes, so slight SEARCH wording
 * differences still collapse duplicate Option 1 · L15 / Option 2 · L30 pickers.
 */
function coalesceAmbiguousHunksForFile(
  content: string,
  rawHunks: readonly PatchHunk[],
  previews: PatchPreviewHunk[],
  previousSharedSelections: readonly PriorSharedSelection[]
): { hunks: PatchPreviewHunk[]; sharedMatchGroups?: PatchSharedMatchGroup[] } {
  const ambiguousIndexes = previews
    .map((preview, index) => ({ preview, index }))
    .filter(({ preview }) => preview.matchStatus === "ambiguous");

  if (ambiguousIndexes.length <= 1) {
    return { hunks: previews };
  }

  const byFingerprint = new Map<string, number[]>();
  for (const { preview, index } of ambiguousIndexes) {
    const fingerprint = locationFingerprint(preview);
    if (!fingerprint) {
      continue;
    }
    const list = byFingerprint.get(fingerprint) ?? [];
    list.push(index);
    byFingerprint.set(fingerprint, list);
  }

  const nextHunks = [...previews];
  const sharedMatchGroups: PatchSharedMatchGroup[] = [];
  let sharedGroupCounter = 0;

  for (const [, indexes] of byFingerprint) {
    if (indexes.length <= 1) {
      continue;
    }

    const firstIndex = indexes[0]!;
    const firstPreview = nextHunks[firstIndex]!;
    const matchCount = firstPreview.matchLocations?.length ?? 0;
    if (matchCount === 0) {
      continue;
    }

    // Resolve hits from the first hunk's SEARCH; pairing/shared indices refer to
    // that hunk's match list (same line spans as the group fingerprint).
    const matches = findAllSearchMatches(content, rawHunks[firstIndex]!.search);
    if (matches.length !== matchCount) {
      continue;
    }

    if (indexes.length === matchCount) {
      for (let i = 0; i < indexes.length; i++) {
        const hunkIndex = indexes[i]!;
        // Prefer this hunk's own SEARCH hits when available at the same lines.
        const ownMatches = findAllSearchMatches(content, rawHunks[hunkIndex]!.search);
        const hit =
          ownMatches.length === matchCount
            ? ownMatches[i]!
            : matches[i]!;
        nextHunks[hunkIndex] = buildPairedHunkPreview(
          content,
          rawHunks[hunkIndex]!,
          nextHunks[hunkIndex]!.id,
          hit,
          i
        );
      }
      continue;
    }

    const groupId = `shared-${sharedGroupCounter}`;
    sharedGroupCounter += 1;
    const hunkIds = indexes.map((index) => nextHunks[index]!.id);
    const priorByLocation = new Map(
      previousSharedSelections
        .filter((entry) => hunkIds.some((id) => entry.proposalId.startsWith(`${id}:`)))
        .map((entry) => [entry.locationId, entry.proposalId] as const)
    );

    const locations: PatchSharedMatchLocation[] = matches.map((hit, matchIndex) => {
      const startEnd = buildLocationPreviewLines(content, hit, rawHunks[firstIndex]!);
      const locationId = sharedLocationId(startEnd.startLine, startEnd.endLine);
      const proposals: PatchMatchProposal[] = indexes.map((hunkIndex) => {
        const hunkId = nextHunks[hunkIndex]!.id;
        const ownMatches = findAllSearchMatches(content, rawHunks[hunkIndex]!.search);
        const ownHit =
          ownMatches.length === matchCount
            ? ownMatches[matchIndex]!
            : hit;
        const preview = buildLocationPreviewLines(content, ownHit, rawHunks[hunkIndex]!);
        return {
          id: proposalId(hunkId, matchIndex),
          hunkId,
          matchIndex,
          lines: preview.lines
        };
      });

      const priorProposal = priorByLocation.get(locationId);
      const selectedProposalId =
        priorProposal && proposals.some((proposal) => proposal.id === priorProposal)
          ? priorProposal
          : undefined;

      return {
        id: locationId,
        startLine: startEnd.startLine,
        endLine: startEnd.endLine,
        proposals,
        selectedProposalId
      };
    });

    sharedMatchGroups.push({ id: groupId, hunkIds, locations });

    for (const hunkIndex of indexes) {
      const hunk = nextHunks[hunkIndex]!;
      nextHunks[hunkIndex] = {
        ...hunk,
        matchStatus: "ambiguous",
        matchLocations: undefined,
        lines: buildReplaceLines(rawHunks[hunkIndex]!),
        resolvedMatchIndices: undefined
      };
    }
  }

  return {
    hunks: nextHunks,
    sharedMatchGroups: sharedMatchGroups.length > 0 ? sharedMatchGroups : undefined
  };
}

function collectPriorSharedSelections(
  previousFiles?: readonly PatchPreviewFile[]
): Map<string, PriorSharedSelection[]> {
  const byPath = new Map<string, PriorSharedSelection[]>();
  for (const file of previousFiles ?? []) {
    const selected: PriorSharedSelection[] = [];
    for (const group of file.sharedMatchGroups ?? []) {
      for (const location of group.locations) {
        if (location.selectedProposalId) {
          selected.push({ locationId: location.id, proposalId: location.selectedProposalId });
        }
      }
    }
    if (selected.length > 0) {
      byPath.set(file.relativePath, selected);
    }
  }
  return byPath;
}

export function buildPatchCardState(
  patches: ParsedPatchSet,
  options: {
    status: PatchCardState["status"];
    messageTimestamp?: number;
    error?: string;
    appliedFileCount?: number;
    canUndo?: boolean;
    fileContents?: Readonly<Record<string, string>>;
    /** Preserve per-hunk apply/reject when rebuilding previews. */
    previousFiles?: readonly PatchPreviewFile[];
  }
): PatchCardState {
  const previousStatusById = new Map<string, NonNullable<PatchPreviewHunk["status"]>>();
  const previousSelectedByHunk = new Map<string, Set<string>>();
  const previousSharedByPath = collectPriorSharedSelections(options.previousFiles);

  for (const file of options.previousFiles ?? []) {
    for (const hunk of file.hunks) {
      if (hunk.status) {
        previousStatusById.set(hunk.id, hunk.status);
      }
      if (hunk.matchLocations?.length) {
        previousSelectedByHunk.set(
          hunk.id,
          new Set(hunk.matchLocations.filter((loc) => loc.selected).map((loc) => loc.id))
        );
      }
    }
  }

  const files: PatchPreviewFile[] = [];
  let hunkCounter = 0;

  for (const filePatch of patches.files) {
    const content = readWorkspaceFile(
      filePatch.relativePath,
      options.fileContents,
      filePatch.hunks[0]?.search
    );
    const rawPreviews: PatchPreviewHunk[] = [];

    for (const hunk of filePatch.hunks) {
      const hunkId = `hunk-${hunkCounter}`;
      hunkCounter += 1;
      const allMatches = findAllSearchMatches(content, hunk.search);
      let preview: PatchPreviewHunk;
      if (allMatches.length === 0) {
        preview = buildUnmatchedHunkPreview(hunk, hunkId);
      } else if (allMatches.length === 1) {
        preview = buildMatchedHunkPreview(content, hunk, hunkId);
      } else {
        preview = buildAmbiguousHunkPreview(
          content,
          hunk,
          hunkId,
          allMatches,
          previousSelectedByHunk.get(hunkId)
        );
      }
      rawPreviews.push(preview);
    }

    const coalesced = coalesceAmbiguousHunksForFile(
      content,
      filePatch.hunks,
      rawPreviews,
      previousSharedByPath.get(filePatch.relativePath) ?? []
    );

    const hunks = coalesced.hunks.map((preview) => {
      const prior = previousStatusById.get(preview.id);
      return prior ? { ...preview, status: prior } : preview;
    });

    files.push({
      relativePath: filePatch.relativePath,
      hunks,
      sharedMatchGroups: coalesced.sharedMatchGroups
    });
  }

  return {
    status: options.status,
    messageTimestamp: options.messageTimestamp,
    fileCount: countUniqueFiles(patches),
    hunkCount: countHunks(patches),
    files,
    error: options.error,
    appliedFileCount: options.appliedFileCount,
    canUndo: options.canUndo,
    canCreatePr: false
  };
}

export function setHunkStatusOnCard(
  card: PatchCardState,
  hunkId: string,
  status: NonNullable<PatchPreviewHunk["status"]>
): PatchCardState {
  return {
    ...card,
    files: card.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => (hunk.id === hunkId ? { ...hunk, status } : hunk))
    }))
  };
}

export function setHunkMatchLocationsOnCard(
  card: PatchCardState,
  hunkId: string,
  locationIds: readonly string[]
): PatchCardState {
  const selected = new Set(locationIds);
  return {
    ...card,
    error: undefined,
    files: card.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => {
        if (hunk.id !== hunkId || !hunk.matchLocations) {
          return hunk;
        }
        return {
          ...hunk,
          matchLocations: hunk.matchLocations.map((loc) => ({
            ...loc,
            selected: selected.has(loc.id)
          }))
        };
      })
    }))
  };
}

export function setSharedMatchProposalOnCard(
  card: PatchCardState,
  relativePath: string,
  groupId: string,
  locationId: string,
  proposalIdValue: string | null | undefined
): PatchCardState {
  return {
    ...card,
    error: undefined,
    files: card.files.map((file) => {
      if (file.relativePath !== relativePath || !file.sharedMatchGroups) {
        return file;
      }
      return {
        ...file,
        sharedMatchGroups: file.sharedMatchGroups.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          return {
            ...group,
            locations: group.locations.map((location) => {
              if (location.id !== locationId) {
                return location;
              }
              const nextId = proposalIdValue || undefined;
              if (nextId && !location.proposals.some((proposal) => proposal.id === nextId)) {
                return location;
              }
              return { ...location, selectedProposalId: nextId };
            })
          };
        })
      };
    })
  };
}

export function selectedMatchIndicesForHunk(hunk: PatchPreviewHunk): number[] {
  if (hunk.resolvedMatchIndices?.length) {
    return [...hunk.resolvedMatchIndices];
  }
  if (!hunk.matchLocations?.length) {
    return [];
  }
  return hunk.matchLocations
    .filter((loc) => loc.selected)
    .map((loc) => parseMatchLocationIndex(loc.id))
    .filter((index): index is number => index !== undefined);
}

/** Match indices implied by shared location proposals for a given hunk. */
export function sharedMatchIndicesForHunk(
  file: PatchPreviewFile,
  hunkId: string
): number[] | undefined {
  const groups = file.sharedMatchGroups?.filter((group) => group.hunkIds.includes(hunkId));
  if (!groups?.length) {
    return undefined;
  }
  const indices: number[] = [];
  for (const group of groups) {
    for (const location of group.locations) {
      const proposal = location.proposals.find((entry) => entry.id === location.selectedProposalId);
      if (proposal?.hunkId === hunkId) {
        indices.push(proposal.matchIndex);
      }
    }
  }
  return indices;
}

export function hunkNeedsMatchSelection(hunk: PatchPreviewHunk, file?: PatchPreviewFile): boolean {
  if ((hunk.status ?? "pending") !== "pending") {
    return false;
  }
  if (hunk.resolvedMatchIndices?.length) {
    return false;
  }
  if (file?.sharedMatchGroups?.some((group) => group.hunkIds.includes(hunk.id))) {
    const indices = sharedMatchIndicesForHunk(file, hunk.id);
    return !indices || indices.length === 0;
  }
  return hunk.matchStatus === "ambiguous";
}

export function hunkReadyToApply(hunk: PatchPreviewHunk, file?: PatchPreviewFile): boolean {
  if ((hunk.status ?? "pending") !== "pending") {
    return false;
  }
  if (hunk.matchStatus === "not_found") {
    return false;
  }
  if (hunk.resolvedMatchIndices?.length) {
    return true;
  }
  if (hunk.matchStatus === "matched") {
    return true;
  }
  if (file?.sharedMatchGroups?.some((group) => group.hunkIds.includes(hunk.id))) {
    const indices = sharedMatchIndicesForHunk(file, hunk.id);
    return Boolean(indices && indices.length > 0);
  }
  if (hunk.matchStatus === "ambiguous") {
    return selectedMatchIndicesForHunk(hunk).length > 0;
  }
  return false;
}

export function pendingHunkIds(card: PatchCardState): string[] {
  return card.files.flatMap((file) =>
    file.hunks.filter((hunk) => (hunk.status ?? "pending") === "pending").map((hunk) => hunk.id)
  );
}

export function deriveCardStatusFromHunks(card: PatchCardState): PatchCardState["status"] {
  const statuses = card.files.flatMap((file) => file.hunks.map((hunk) => hunk.status ?? "pending"));
  if (statuses.length === 0) {
    return card.status;
  }
  if (statuses.every((status) => status === "applied")) {
    return "applied";
  }
  if (statuses.every((status) => status === "rejected")) {
    return "rejected";
  }
  if (statuses.some((status) => status === "applied") && !statuses.some((status) => status === "pending")) {
    return "applied";
  }
  return "pending";
}

export function cardHasAmbiguousPending(card: PatchCardState): boolean {
  for (const file of card.files) {
    for (const group of file.sharedMatchGroups ?? []) {
      const pendingMembers = group.hunkIds.some((hunkId) => {
        const hunk = file.hunks.find((entry) => entry.id === hunkId);
        return (hunk?.status ?? "pending") === "pending";
      });
      if (pendingMembers) {
        return true;
      }
    }
    for (const hunk of file.hunks) {
      if ((hunk.status ?? "pending") !== "pending") {
        continue;
      }
      if (hunk.matchStatus === "ambiguous" && (hunk.matchLocations?.length ?? 0) > 1) {
        return true;
      }
    }
  }
  return false;
}
