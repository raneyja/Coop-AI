import { extractNamedSourceFiles } from "./searchQuery";

export type RequestedRepoFile = {
  requestedPath: string;
  path?: string;
  repoId: string;
  branch?: string;
  status: "read" | "unavailable" | "ambiguous";
  candidates?: string[];
  reason?: string;
};

export function normalizeRequestedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
}

export type RepoFileReference = { requestedPath: string; exact: boolean };
export type RepoFileScope = { excludedFiles: RepoFileReference[] };

function fileReferences(query: string, named = extractNamedSourceFiles(query), rootAgentsDefault = true): RepoFileReference[] {
  const occurrences: Array<RepoFileReference & { index: number }> = [];
  for (const ref of named) {
    const requestedPath = normalizeRequestedPath(ref);
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokens = new RegExp(`(?:^|[\\s\`\"'(\\[])((?:/|\\./)?${escaped})(?=$|[\\s\`\"')\\],:;!?]|\\.(?:\\s|$))`, "g");
    let token: RegExpExecArray | null;
    let found = false;
    while ((token = tokens.exec(query)) !== null) {
      found = true;
      const index = token.index + token[0].indexOf(token[1]);
      const explicitRoot = /\broot\s+(?:file\s+)?[`"']?$/i.test(query.slice(0, index));
      occurrences.push({ requestedPath, index, exact: token[1].includes("/") || explicitRoot ||
        (rootAgentsDefault && requestedPath === "AGENTS.md") });
    }
    // Implicit project-guideline requests have no filename token.
    if (!found) occurrences.push({ requestedPath, index: query.length, exact: ref.includes("/") ||
      (rootAgentsDefault && requestedPath === "AGENTS.md") });
  }
  const seen = new Set<string>();
  return occurrences.sort((a, b) => a.index - b.index).flatMap(({ requestedPath, exact }) => {
    const key = `${exact}:${requestedPath}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ requestedPath, exact }];
  });
}

const FILE_COMMAND = "(?:read(?:ing)?|quote|quoting|use|using|open(?:ing)?|include|including|fetch(?:ing)?|inspect(?:ing)?|consult(?:ing)?|search(?:ing)?|show(?:ing)?|cite|citing|explain(?:ing)?|describe|describing|state|stating|list(?:ing)?|summari[sz]e|summari[sz]ing|compare|comparing)";

/** Negative commands constrain their file objects, not filenames in later prose. */
function excludedFileListLength(text: string): number | undefined {
  let start = text.length - text.trimStart().length;
  const command = new RegExp(`^(?:(?:and|or)\\s+)?${FILE_COMMAND}\\s+`, "i");
  let action: RegExpExecArray | null;
  while ((action = command.exec(text.slice(start))) !== null) start += action[0].length;
  const objectEnd = (offset: number): number | undefined => {
    const modifiers = /^(?:(?:the|any|root|files?|for|from|of|in|code|contents?|body|text|source|evidence)\s+)*/i.exec(text.slice(offset))!;
    const tokenStart = offset + modifiers[0].length;
    const token = /^[`"'(\[]*[\w./-]+[`"')\]]*(?=$|[\s,:;!?])/.exec(text.slice(tokenStart));
    if (!token || !extractNamedSourceFiles(token[0]).length) return undefined;
    return tokenStart + token[0].length;
  };
  let end = objectEnd(start);
  if (end === undefined) return undefined;
  for (;;) {
    const separator = /^(?:\s*,\s*(?:(?:and|or|nor)\s+)?|\s+(?:and|or|nor)\s+|\s*[&|]\s*|\s+)/i.exec(text.slice(end));
    if (!separator) break;
    const next = objectEnd(end + separator[0].length);
    if (next === undefined) break;
    end = next;
  }
  return end;
}

/** Parse negative file clauses before resolving paths or accepting planner tools. */
export function resolveRepoFileScope(query: string): RepoFileScope {
  const text = query.replace(/’/g, "'")
    .replace(/\bbut\s+not\b/gi, "excluding")
    .replace(/,\s*not\b/gi, ", excluding");
  const excluded = new Map<string, RepoFileReference>();
  // Dots inside paths stay intact. Sentence boundaries and new commands end
  // a restriction; comma/and-separated filename lists remain in that restriction.
  for (const clause of text.split(/[;!?\n]|\.\s+|\b(?:but|then)\b/i)) {
    const negative = new RegExp(`(?:^|[\\s,(])(?:(?:do not|don't|never|must not|not to|no)\\s+${FILE_COMMAND}|(?:exclude|excluding|except|without|avoid|avoiding|omit|omitting|ignore|ignoring|no))(?=\\s)`, "gi");
    let match: RegExpExecArray | null;
    while ((match = negative.exec(clause)) !== null) {
      const start = match.index + match[0].length;
      const rest = clause.slice(start);
      if (/\bno$/i.test(match[0])) {
        const firstToken = rest.trimStart().split(/\s|[,;!?]/, 1)[0].replace(/^[`"']+|[`"'.]+$/g, "");
        if (!extractNamedSourceFiles(firstToken).length) continue;
      }
      const length = excludedFileListLength(rest);
      if (length === undefined) continue;
      const restricted = rest.slice(0, length);
      for (const ref of fileReferences(restricted, extractNamedSourceFiles(restricted), false)) {
        excluded.set(`${ref.exact ? "path" : "basename"}:${ref.requestedPath}`, ref);
      }
    }
  }
  return { excludedFiles: [...excluded.values()] };
}

/** An explicit path excludes that path; a basename excludes every matching file. */
export function repoFileScopeAllowsPath(scope: RepoFileScope, path: string): boolean {
  const normalized = normalizeRequestedPath(path);
  const basename = normalized.split("/").pop();
  return !scope.excludedFiles.some(ref => ref.exact
    ? normalized === ref.requestedPath
    : basename === ref.requestedPath);
}

/** Explicit paths are exact; a bare basename is a discovery request. */
export function requestedRepoFiles(query: string): RepoFileReference[] {
  const scope = resolveRepoFileScope(query);
  const named = extractNamedSourceFiles(query);
  if (!named.includes("AGENTS.md") && /\b(?:project|repository|repo|team)\s+(?:instructions?|guidelines?|rules)\b/i.test(query)) {
    named.push("AGENTS.md");
  }
  const allowed = fileReferences(query, named).filter(ref => !scope.excludedFiles.some(excluded =>
    excluded.exact ? ref.exact && ref.requestedPath === excluded.requestedPath :
      ref.requestedPath.split("/").pop() === excluded.requestedPath));
  const unique = new Map<string, RepoFileReference>();
  for (const ref of allowed) {
    if (!unique.has(ref.requestedPath) || ref.exact) unique.set(ref.requestedPath, ref);
  }
  return [...unique.values()];
}

export function formatRequestedFileOutcomes(files: RequestedRepoFile[]): string {
  return [
    "Requested repository file evidence (each requirement is independent):",
    JSON.stringify({ requestedFiles: files }),
    "Answer each part only from its read body. For unavailable files, say the body could not be verified; this does not prove absence. For ambiguous basenames, show the candidate paths and ask which one. Never fill a missing part from project guidance, memory, another file, or a search snippet. Cite only the read paths with their actual line numbers."
  ].join("\n");
}

export function isRequestedFileQuestion(query: string): boolean {
  return requestedRepoFiles(query).length > 0 &&
    /\b(?:read|quote|list|state|whether|what|explain|summari[sz]e|compare|show|describe|rules?|guidelines?|instructions?)\b/i.test(query);
}

/** A targetless remote chip can answer itself, but cannot resolve other files. */
export function requestedFilesNeedRepoSelection(query: string, context: {
  owner?: string; repo?: string; file?: string; fileSource?: string
}): boolean {
  if ((context.file && context.fileSource !== "remote") ||
    (context.owner?.trim() && context.repo?.trim()) || !isRequestedFileQuestion(query)) return false;
  const file = context.file ? normalizeRequestedPath(context.file) : undefined;
  return requestedRepoFiles(query).some((ref) => !file || (ref.requestedPath !== file &&
    (ref.exact || ref.requestedPath !== file.split("/").pop())));
}
