import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import { citationLocatorInFenceBody, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";
import { groundCodeCitation } from "../webview/lib/groundCodeCitation";

// Preserve quoted literals while allowing the model's whitespace formatting to
// differ. A changed operator, identifier or string cannot match source tokens.
function tokens(text: string, jsTrailingCommas: boolean): Array<{ value: string; offset: number }> {
  const pattern = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|>>>=|===|!==|>>>|<<=|>>=|\*\*=|&&=|\|\|=|\?\?=|\.\.\.|==|!=|=>|&&|\|\||\?\?|\?\.|\+\+|--|\*\*|<<|>>|<=|>=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[^\s]/g;
  const parsed = [...text.matchAll(pattern)].map(match => ({ value: match[0], offset: match.index! }));
  return jsTrailingCommas ? parsed.filter((token, index) => !(token.value === "," &&
    parsed[index - 1]?.value !== "," && /^[}\])]$/.test(parsed[index + 1]?.value ?? ""))) : parsed;
}

/** Numeric source cards display remote source bytes, never rewritten model code. */
export function groundBlastSourceCitations(content: string, evidence: BlastRadiusEvidence): string {
  const sources = new Map((evidence.sourceFiles ?? []).map(source => [source.path, source]));
  if (!sources.size) return content;
  return content.replace(/```([^\n]*)\n([\s\S]*?)```/g, (original, info: string, body: string) => {
    const bodyCitation = citationLocatorInFenceBody(body.split("\n"));
    const locator = tryParseFenceInfoLocator(info.trim()) ?? bodyCitation?.locator;
    if (!locator) return original;
    const source = sources.get(locator.path.replace(/^\.\//, "").replace(/\\/g, "/"));
    if (!source) return "The quoted file was not opened this turn; that source claim remains **unverified**.";
    const code = bodyCitation && !tryParseFenceInfoLocator(info.trim())
      ? body.split("\n").slice(bodyCitation.codeStart).join("\n") : body;
    const base = source.startLine ?? 1;
    const grounded = groundCodeCitation(source.content, code,
      locator.startLine == null ? undefined : locator.startLine - base + 1,
      locator.endLine == null ? undefined : locator.endLine - base + 1);
    let start = grounded.grounded ? grounded.startLine : undefined;
    let end = grounded.grounded ? grounded.endLine : undefined;
    if (start == null || end == null) {
      const js = /\.(?:[cm]?[jt]sx?)$/.test(source.path);
      const fileTokens = tokens(source.content, js), snippetTokens = tokens(code, js);
      const matches: Array<{ start: number; end: number }> = [];
      // Indentation is control flow in languages such as Python. Only repair
      // token-equivalent formatting in JavaScript/TypeScript bodies.
      if (js && snippetTokens.length >= 8) {
        for (let i = 0; i <= fileTokens.length - snippetTokens.length; i++) {
          if (!snippetTokens.every((token, n) => token.value === fileTokens[i + n]!.value)) continue;
          const first = fileTokens[i]!.offset, last = fileTokens[i + snippetTokens.length - 1]!.offset;
          matches.push({ start: source.content.slice(0, first).split("\n").length,
            end: source.content.slice(0, last).split("\n").length });
        }
      }
      const match = matches.length === 1 ? matches[0]
        : matches.find(candidate => candidate.start + base - 1 === locator.startLine);
      start = match?.start; end = match?.end;
    }
    if (start == null || end == null || end - start > 120) {
      return "The quoted excerpt did not match the opened source; that citation remains **unverified**.";
    }
    const lines = source.content.replace(/\r\n/g, "\n").split("\n");
    return `\`\`\`${start + base - 1}:${end + base - 1}:${source.path}\n${lines.slice(start - 1, end).join("\n")}\n\`\`\``;
  });
}

/** Opened enum references establish the labels used there, not a full catalog. */
export function blastEnumValueGuard(evidence: BlastRadiusEvidence): (sentence: string) => boolean {
  const members = new Map<string, Set<string>>();
  for (const source of evidence.sourceFiles ?? []) {
    for (const match of source.content.matchAll(/\b([A-Z][\w$]*)\.([A-Z][A-Z\d_]*)\b/g)) {
      const values = members.get(match[1]!) ?? new Set<string>();
      values.add(match[2]!); members.set(match[1]!, values);
    }
  }
  const statuses = new Set([...members].filter(([name]) => /Status$|StateGroup$/.test(name)).flatMap(([, values]) => [...values]));
  const entities = new Map<string, Set<string>>();
  const addEntity = (entity: string, type: string) => {
    const values = entities.get(entity.toLowerCase()) ?? new Set<string>();
    for (const value of members.get(type) ?? []) values.add(value);
    entities.set(entity.toLowerCase(), values);
  };
  for (const name of members.keys()) {
    if (/(?:Status|Group|Type|Role)$/.test(name)) addEntity(name.replace(/(?:Status|Group|Type|Role)$/, ""), name);
  }
  for (const source of evidence.sourceFiles ?? []) {
    for (const match of source.content.matchAll(/\b([\w$]+(?:\??\.[\w$]+)*)\.(?:status|signingStatus|readStatus|group|type|role)\s*(?:===|!==|==|!=|=)\s*([A-Z][\w$]*)\.([A-Z][A-Z\d_]*)\b/g)) {
      addEntity(match[1]!.split(".").at(-1)!, match[2]!);
    }
  }
  const acronyms = new Set(["API", "APIs", "SQL", "HTTP", "HTTPS", "UI", "IDE", "PR", "CI", "DB", "SCIP", "SSO"]);
  return sentence => {
    for (const match of sentence.matchAll(/\b([A-Z][\w$]*)\.([A-Z][A-Z\d_]*)\b/g)) {
      if (members.has(match[1]!) && !members.get(match[1]!)!.has(match[2]!)) return true;
    }
    if (!statuses.size) return false;
    for (const match of sentence.matchAll(/\b[A-Z][A-Z\d_]*[`*]?(?:\s*(?:,|or|and|\/)\s*[`*]?[A-Z][A-Z\d_]*[`*]?)*\s+(envelopes?|documents?|recipients?|fields?|states?|statuses?)\b/g)) {
      const labels = match[0].match(/\b[A-Z][A-Z\d_]*\b/g) ?? [];
      const noun = match[1]!.replace(/s$/, "");
      const allowed = entities.get(noun) ?? statuses;
      if (labels.some(label => !allowed.has(label) && !acronyms.has(label))) return true;
    }
    return false;
  };
}
