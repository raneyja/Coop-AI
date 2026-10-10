import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { understandFocusCoverage, understandIncompleteFocusMessage } from "../context/understandRepoSourceEvidence";
import { groundCodeCitation } from "../webview/lib/groundCodeCitation";
import { citationLocatorInFenceBody, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";

/** Focused reports may cite only verbatim source from the windows attached this turn. */
export function enrichUnderstandRepoResponse(content: string, summary: RepoSummaryEvidence | undefined): string {
  const files = (summary?.entryFiles ?? []).filter((file): file is typeof file & { content: string } => Boolean(file.content?.trim()));
  const coverage = understandFocusCoverage(summary?.userFocus, files);
  const incomplete = understandIncompleteFocusMessage(coverage);
  if (incomplete) return incomplete;
  if (!coverage.requested.length) return content;
  return content.replace(/(^|\n)[ \t]*```([^\n]*)\n([\s\S]*?)\n[ \t]*```/g, (block, before: string, info: string, body: string) => {
    const bodyLines = body.split("\n");
    const bodyCitation = citationLocatorInFenceBody(bodyLines);
    const locator = tryParseFenceInfoLocator(info.trim()) ?? bodyCitation?.locator;
    if (!locator) return block;
    const snippet = (tryParseFenceInfoLocator(info.trim()) ? bodyLines : bodyLines.slice(bodyCitation!.codeStart)).join("\n");
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
        blocks.push(`\`\`\`${start}:${start + excerpt.length - 1}:${locator.path}\n${excerpt.join("\n")}\n\`\`\``);
      }
      return before + blocks.join("\n\n");
    }
    // Keep the explanation and real path references, never an invented numeric code surface.
    return before;
  }).replace(/\n{3,}/g, "\n\n").trim();
}
