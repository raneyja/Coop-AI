import type { ReviewedSourceWindow } from "./sourceCitationIntegrity";
import { splitMarkdownBlocks } from "./markdownProse";
import { tryParseCitationLocator, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";

export const MAX_SOURCE_REFERENCE_LINES = 20;
export const MAX_RENDERED_SOURCE_REFERENCES = 16;
export const MAX_RENDERED_SOURCE_BYTES = 16_000;

/** Resolve model-selected spans against admitted bytes; never let the model
 * retype a source quote. IDs follow snapshotSourceClaimEvidence admission order.
 * Invalid references remain private for the caller to reject or repair. */
export function renderSourceEvidenceReferences(content: string, windows: ReviewedSourceWindow[]): {
  content: string; invalidReferences: number;
} {
  const admitted = windows.filter(window => typeof window.content === "string" && window.content.trim()
    && Number.isInteger(window.startLine) && Number(window.startLine) >= 1);
  const byId = new Map(admitted.map((window, index) => [`window-${index + 1}`, window]));
  let invalidReferences = 0;
  let renderedReferences = 0, sourceBytes = 0;
  const encoder = new TextEncoder();
  const rendered = splitMarkdownBlocks(content).map(block => {
    if (block.kind === "code") {
      const location = tryParseFenceInfoLocator(block.info)
        ?? tryParseCitationLocator(block.body.split("\n")[0]?.trim() ?? "");
      // A real closed source quote stays opaque; exact-byte validation is the
      // caller's next step. Anonymous/unfinished fences cannot hide protocol.
      if (!block.closed || location?.startLine === undefined || location.endLine === undefined) {
        invalidReferences += block.text.match(/\[\[source/gi)?.length ?? 0;
      }
      return block.text;
    }
    return block.text.split(/(?<=\n)/).map(row => {
      const occurrences = row.match(/\[\[source/gi)?.length ?? 0;
      if (!occurrences) return row;
      const ending = row.endsWith("\r\n") ? "\r\n" : row.endsWith("\n") ? "\n" : "";
      const match = row.trim().match(/^\[\[source:(window-[1-9]\d*):([1-9]\d*):([1-9]\d*)\]\]$/);
      const window = match ? byId.get(match[1]) : undefined;
      const start = Number(match?.[2]), end = Number(match?.[3]);
      const first = Number(window?.startLine);
      const lines = window?.content?.split("\n");
      const last = first + (lines?.length ?? 0) - 1;
      if (!match || !window || !lines || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || start < first || end < start || end > last
        || !window.path.trim() || /[\r\n`]/.test(window.path)
        || !tryParseCitationLocator(`${start}:${end}:${window.path}`)) {
        invalidReferences += occurrences;
        return row;
      }
      const source = lines.slice(start - first, end - first + 1).join("\n");
      if (!source.trim()) {
        invalidReferences += occurrences;
        return row;
      }
      const bytes = encoder.encode(source).byteLength;
      const cards: Array<{ first: number; last: number; source: string }> = [];
      for (let firstLine = start; firstLine <= end; firstLine += MAX_SOURCE_REFERENCE_LINES) {
        const lastLine = Math.min(firstLine + MAX_SOURCE_REFERENCE_LINES - 1, end);
        const text = lines.slice(firstLine - first, lastLine - first + 1).join("\n");
        if (text.trim()) cards.push({ first: firstLine, last: lastLine, source: text });
      }
      // Admit the whole requested span or none: no partial expansion or clipping.
      if (renderedReferences + cards.length > MAX_RENDERED_SOURCE_REFERENCES || sourceBytes + bytes > MAX_RENDERED_SOURCE_BYTES) {
        invalidReferences += occurrences;
        return row;
      }
      renderedReferences += cards.length;
      sourceBytes += bytes;
      const longestRun = [...source.matchAll(/`+/g)].reduce((longest, run) => Math.max(longest, run[0].length), 0);
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      return cards.map(card => `${fence}${card.first}:${card.last}:${window.path}\n${card.source}\n${fence}`)
        .join("\n\n") + ending;
    }).join("");
  }).join("");
  return { content: rendered, invalidReferences };
}
