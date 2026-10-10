import { isMalformedCitationLocator, tryParseCitationLocator, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";
import { splitMarkdownBlocks } from "./markdownProse";

export type ReviewedSourceWindow = { path: string; content?: string; startLine?: number };
export type SourceCitationIntegrity = { content: string; verifiedQuotes: number; invalidQuotes: number };

/** Callers supply identity/ref-isolated evidence. This proves exact source bytes,
 * not the semantics of prose. Anonymous code is never promoted to a citation. */
export function verifySourceCitationQuotes(content: string, files?: ReviewedSourceWindow[]): SourceCitationIntegrity {
  let verifiedQuotes = 0, invalidQuotes = 0;
  const reject = (text: string): string => {
    invalidQuotes++;
    return "The quoted code could not be matched to the reviewed source." + (text.endsWith("\n") ? "\n" : "");
  };
  const aligned = splitMarkdownBlocks(content).map(block => {
    if (block.kind === "prose") return block.text;
    const templateLocator = /^(?:[A-Za-z][\w+#-]*\s+)?(?:startLine|start)\s*:\s*(?:endLine|end)\s*:/i;
    if (templateLocator.test(block.info)) return reject(block.text);
    let location = tryParseFenceInfoLocator(block.info);
    let body = block.body.replace(/\n$/, "");
    if (!location) {
      const [first, ...rest] = body.split("\n");
      if (isMalformedCitationLocator(first.trim()) || templateLocator.test(first.trim())) return reject(block.text);
      const legacy = tryParseCitationLocator(first.trim());
      if (legacy?.startLine !== undefined) {
        location = legacy;
        body = rest.join("\n");
      }
    }
    if (!location) return isMalformedCitationLocator(block.info) ? reject(block.text) : block.text;
    if (!block.closed || !body.trim()) return reject(block.text);
    const quoted = body.split("\n");
    const matches = new Map<number, string[]>();
    for (const file of files ?? []) {
      if (file.path !== location.path || !file.content || !Number.isInteger(file.startLine) || Number(file.startLine) < 1) continue;
      const lines = file.content.split("\n");
      for (let index = 0; index <= lines.length - quoted.length; index++) {
        if (quoted.every((line, offset) => line === lines[index + offset])) {
          matches.set(Number(file.startLine) + index, lines.slice(index, index + quoted.length));
        }
      }
    }
    // A valid claimed span wins; otherwise only a unique exact span can repair
    // an offset. Never guess the nearest of repeated definitions.
    const start = location.startLine !== undefined && matches.has(location.startLine) && location.endLine === location.startLine + quoted.length - 1
      ? location.startLine : matches.size === 1 ? [...matches.keys()][0] : undefined;
    if (start === undefined) return reject(block.text);
    const lines = matches.get(start)!;
    verifiedQuotes++;
    const newline = block.text.endsWith("\n") ? "\n" : "";
    return `${block.fence}${start}:${start + lines.length - 1}:${location.path}\n${lines.join("\n")}\n${block.fence}${newline}`;
  }).join("");
  return { content: aligned, verifiedQuotes, invalidQuotes };
}
