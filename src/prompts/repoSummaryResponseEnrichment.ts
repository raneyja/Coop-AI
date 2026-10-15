import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { understandFocusCoverage, understandIncompleteFocusMessage } from "../context/understandRepoSourceEvidence";
import { groundCodeCitation } from "../webview/lib/groundCodeCitation";
import { citationLocatorInFenceBody, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";
import { collapseProseBlankLines, splitMarkdownBlocks } from "./markdownProse";
import { verifySourceCitationQuotes } from "./sourceCitationIntegrity";

/** Focused reports may cite only verbatim source from the windows attached this turn. */
export function enrichUnderstandRepoResponse(content: string, summary: RepoSummaryEvidence | undefined): string {
  const files = (summary?.entryFiles ?? []).filter((file): file is typeof file & { content: string } => Boolean(file.content?.trim()));
  const coverage = understandFocusCoverage(summary?.userFocus, files);
  const incomplete = understandIncompleteFocusMessage(coverage);
  if (incomplete) return incomplete;
  if (!coverage.requested.length) return content;
  return collapseProseBlankLines(splitMarkdownBlocks(content).map(block => {
    if (block.kind === "prose" || !block.closed) return block.text;
    // Remove only the syntactic separator before the closing fence. Source
    // blank lines and shorter embedded delimiter runs remain opaque bytes.
    const bodyLines = block.body.replace(/\r?\n$/, "").split("\n");
    const bodyCitation = citationLocatorInFenceBody(bodyLines);
    const infoLocator = tryParseFenceInfoLocator(block.info);
    const locator = infoLocator ?? bodyCitation?.locator;
    if (!locator) return block.text;
    if (locator.startLine !== undefined) {
      // This helper also serves legacy callers. Use the canonical exact-byte
      // owner rather than trusting arbitrary coordinates or re-grounding an
      // already admitted card through a whitespace-tolerant legacy matcher.
      const checked = verifySourceCitationQuotes(block.text, files.map(file => ({ ...file, startLine: file.startLine ?? 1 })));
      if (checked.invalidQuotes) return "";
      if (checked.verifiedQuotes === 1) {
        const aligned = splitMarkdownBlocks(checked.content).find(part => part.kind === "code");
        const verifiedLocator = aligned?.kind === "code" ? tryParseFenceInfoLocator(aligned.info) : null;
        return verifiedLocator?.path === locator.path && verifiedLocator.startLine === locator.startLine
          && verifiedLocator.endLine === locator.endLine ? block.text : checked.content;
      }
    }
    const snippet = (infoLocator ? bodyLines : bodyLines.slice(bodyCitation!.codeStart)).join("\n");
    for (const file of files.filter(file => file.path === locator.path)) {
      const first = file.startLine ?? 1;
      const source = "\n".repeat(first - 1) + file.content;
      const grounded = groundCodeCitation(source, snippet, locator.startLine, locator.endLine, { strictRange: true });
      const last = first + file.content.split("\n").length - 1;
      if (!grounded.grounded || grounded.startLine < first || grounded.endLine > last) continue;
      const lines = grounded.code.split("\n");
      const blocks: string[] = [];
      for (let offset = 0; offset < lines.length; offset += 20) {
        const excerpt = lines.slice(offset, offset + 20);
        const start = grounded.startLine + offset;
        const source = excerpt.join("\n");
        const longestRun = [...source.matchAll(/`+/g)].reduce((longest, run) => Math.max(longest, run[0].length), 0);
        const fence = "`".repeat(Math.max(3, longestRun + 1));
        blocks.push(`${fence}${start}:${start + excerpt.length - 1}:${locator.path}\n${source}\n${fence}`);
      }
      return blocks.join("\n\n") + (block.text.endsWith("\n") ? "\n" : "");
    }
    // Keep the explanation and real path references, never an invented numeric code surface.
    return "";
  }).join(""));
}
