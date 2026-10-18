import type { ReviewedSourceWindow } from "./sourceCitationIntegrity";
import { splitMarkdownBlocks } from "./markdownProse";
import { tryParseCitationLocator, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";

export const PREFERRED_SOURCE_REFERENCE_LINES = 20;
export const MAX_RENDERED_SOURCE_REFERENCES = 16;
export const MAX_RENDERED_SOURCE_BYTES = 16_000;
/** Preserve the original total line ceiling, independently of card boundaries. */
export const MAX_RENDERED_SOURCE_LINES = PREFERRED_SOURCE_REFERENCE_LINES * MAX_RENDERED_SOURCE_REFERENCES;

type Selection = {path: string; first: number; lines: string[]; source: string};

/** Resolve spans against admitted bytes. Card packing never clips source or
 * increases the original sixteen-card, 320-line or 16KB total budgets. */
export function renderSourceEvidenceReferences(content: string, windows: ReviewedSourceWindow[], options: {omitOverBudgetSelections?: boolean} = {}): {
  content: string; invalidReferences: number; omittedBudgetReferences?: number;
} {
  const admitted = windows.filter(window => typeof window.content === "string" && window.content.trim()
    && Number.isInteger(window.startLine) && Number(window.startLine) >= 1);
  const byId = new Map(admitted.map((window, index) => [`window-${index + 1}`, window]));
  const selections: Selection[] = [];
  let invalidReferences = 0, omittedBudgetReferences = 0, sourceBytes = 0, sourceLines = 0;
  const encoder = new TextEncoder();
  // Admit each complete marker in source order. Invalid/over-budget spans stay
  // unresolved for the caller to reject; other selected bytes are never lost.
  const parts = splitMarkdownBlocks(content).flatMap<Array<string | Selection>[number]>(block => {
    if (block.kind === "code") {
      const location = tryParseFenceInfoLocator(block.info)
        ?? tryParseCitationLocator(block.body.split("\n")[0]?.trim() ?? "");
      if (!block.closed || location?.startLine === undefined || location.endLine === undefined) {
        invalidReferences += block.text.match(/\[\[source/gi)?.length ?? 0;
      }
      return [block.text];
    }
    return block.text.split(/(?<=\n)/).flatMap<string | Selection>(row => {
      const occurrences = row.match(/\[\[source/gi)?.length ?? 0;
      if (!occurrences) return [row];
      const ending = row.endsWith("\r\n") ? "\r\n" : row.endsWith("\n") ? "\n" : "";
      const match = row.trim().match(/^\[\[source:(window-[1-9]\d*):([1-9]\d*):([1-9]\d*)\]\]$/);
      const window = match ? byId.get(match[1]) : undefined;
      const start = Number(match?.[2]), end = Number(match?.[3]);
      const first = Number(window?.startLine), lines = window?.content?.split("\n");
      const last = first + (lines?.length ?? 0) - 1;
      if (!match || !window || !lines || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || start < first || end < start || end > last
        || !window.path.trim() || /[\r\n`]/.test(window.path)
        || !tryParseCitationLocator(`${start}:${end}:${window.path}`)) {
        invalidReferences += occurrences; return [row];
      }
      const selected = lines.slice(start - first, end - first + 1), source = selected.join("\n");
      const bytes = encoder.encode(source).byteLength;
      if (!source.trim()) {invalidReferences += occurrences; return [row];}
      if (selections.length >= MAX_RENDERED_SOURCE_REFERENCES
        || sourceBytes + bytes > MAX_RENDERED_SOURCE_BYTES || sourceLines + selected.length > MAX_RENDERED_SOURCE_LINES) {
        // Optional private preparation may omit an ENTIRE valid citation, never
        // clip its bytes or waive a malformed reference. The exact resulting
        // prose still requires complete semantic review before publication.
        if (options.omitOverBudgetSelections) {omittedBudgetReferences += occurrences;return [ending];}
        invalidReferences += occurrences; return [row];
      }
      const selection = {path: window.path, first: start, lines: selected, source};
      selections.push(selection); sourceBytes += bytes; sourceLines += selected.length;
      return [selection, ending];
    });
  });
  const cards = (selection: Selection, lineLimit: number) => {
    const result: Array<{first: number; source: string; last: number}> = [];
    for (let offset = 0; offset < selection.lines.length; offset += lineLimit) {
      const lines = selection.lines.slice(offset, offset + lineLimit), source = lines.join("\n");
      if (source.trim()) result.push({first: selection.first + offset, last: selection.first + offset + lines.length - 1, source});
    }
    return result;
  };
  // Fragmentation alone must not consume the card budget: retain every selected
  // line and minimally increase per-card size within the unchanged total bound.
  let lineLimit = PREFERRED_SOURCE_REFERENCE_LINES;
  while (selections.reduce((sum, selection) => sum + cards(selection, lineLimit).length, 0) > MAX_RENDERED_SOURCE_REFERENCES) lineLimit++;
  return {content: parts.map(part => {
    if (typeof part === "string") return part;
    const longestRun = [...part.source.matchAll(/`+/g)].reduce((longest, run) => Math.max(longest, run[0].length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return cards(part, lineLimit).map(card => `${fence}${card.first}:${card.last}:${part.path}\n${card.source}\n${fence}`).join("\n\n");
  }).join(""), invalidReferences, ...(omittedBudgetReferences ? {omittedBudgetReferences} : {})};
}
