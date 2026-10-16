import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";

export type UnderstandSourceFile = {
  path: string;
  content: string;
  repoId?: string;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
};
export type UnderstandRole = "request handler" | "authentication" | "input validation" | "persistence";
export type UnderstandFocusCoverage = {
  requested: UnderstandRole[];
  /** These obligations are not mechanically proved from filenames or framework syntax. */
  missing: UnderstandRole[];
  sourceBodiesAvailable?: boolean;
};

/** Components are obligations, not a count of search hits. No repository-specific paths. */
export function understandRequestedRoles(focus: string | undefined): UnderstandRole[] {
  if (!focus) return [];
  const roles: UnderstandRole[] = [];
  if (/\bauth(?:entication|orization)?\b/i.test(focus)) roles.push("authentication");
  if (/\b(?:validat\w*|invalid inputs?)\b/i.test(focus)) roles.push("input validation");
  if (/\b(?:persist\w*|stor(?:e|es|ed|age|ing)|sav(?:e|es|ed|ing))\b/i.test(focus)) roles.push("persistence");
  if (roles.length < 2 || !/\b(?:backend|api|server|request)\b/i.test(focus)) return [];
  if (/\b(?:creat\w*|writ\w*|updat\w*)\b/i.test(focus)) roles.unshift("request handler");
  return roles;
}

export function understandDomainQuery(focus: string): string | undefined {
  const noun = focus.match(/\b(?:create|creates|creating|update|updates|write|writes)\s+(?:an?\s+|the\s+)?([a-z][a-z0-9_-]*)/i)?.[1] ??
    focus.match(/\b([a-z][a-z0-9_-]*)\s+(?:creation|validation|persistence)\b/i)?.[1];
  return noun && !/^(?:input|request|data|backend|api)$/i.test(noun)
    ? noun.toLowerCase().replace(/s$/, "") : undefined;
}

export function understandFocusQueries(focus: string | undefined): string[] | undefined {
  const roles = understandRequestedRoles(focus);
  if (!roles.length || !focus) return undefined;
  return [...new Set([understandDomainQuery(focus) ?? focus, ...roles.filter(role => role !== "request handler")])].slice(0, 4);
}

const SOURCE_NOISE = /(?:^|\/)(?:node_modules|dist|build|vendor|\.(?:git|hg|svn|cache))(?:\/|$)|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

/** Eligibility is independent of programming language and directory conventions.
 * A path is a discovery hint, never proof that it implements a backend role. */
export function isUnderstandBackendSource(path: string): boolean {
  return Boolean(path.trim()) && !SOURCE_NOISE.test(path);
}

const FOCUS_STOP_WORDS = new Set("the this that which what where how with from into before after should would could files file first read joining team work components handle request backend three and for are does have".split(" "));
function focusTerms(focus: string): string[] {
  return [...new Set((focus.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])
    .filter(term => !FOCUS_STOP_WORDS.has(term)))].slice(0, 24);
}

export function rankUnderstandSourcePaths(paths: string[], focus: string, _family?: string): string[] {
  const terms = focusTerms(focus);
  const score = (path: string) => {
    const tokens = new Set(path.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/));
    return terms.reduce((total, term) => total + Number(tokens.has(term)), 0);
  };
  return [...new Set(paths)].filter(isUnderstandBackendSource)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** Retain complete original lines. Relevance chooses windows, not semantic truth.
 * No AST/framework-specific method names, invented source, or reset line offsets. */
export function understandSourceWindows(file: UnderstandSourceFile, focus = ""): UnderstandSourceFile[] {
  const lines = file.content.split("\n");
  const firstLine = file.startLine ?? 1;
  if (file.content.length <= 12_000) return [{ ...file, startLine: firstLine, endLine: firstLine + lines.length - 1 }];
  const terms = focusTerms(focus);
  const candidates: Array<{start: number; end: number; score: number}> = [];
  for (let start = 0; start < lines.length; start += 60) {
    const end = Math.min(start + 100, lines.length);
    const text = lines.slice(start, end).join("\n").toLowerCase();
    candidates.push({ start, end, score: terms.reduce((total, term) => total + Number(text.includes(term)), 0) });
  }
  const ranges = [candidates[0], ...candidates.slice(1).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, 2)]
    .filter((range): range is NonNullable<typeof range> => Boolean(range)).sort((a, b) => a.start - b.start);
  let retainedChars = 0;
  const windows: UnderstandSourceFile[] = [];
  let priorEnd = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, priorEnd);
    let end = range.end;
    while (end > start && retainedChars + lines.slice(start, end).join("\n").length > 24_000) end--;
    if (end <= start) continue;
    const content = lines.slice(start, end).join("\n");
    retainedChars += content.length;
    priorEnd = end;
    windows.push({ ...file, content, startLine: firstLine + start, endLine: firstLine + end - 1, truncated: true });
  }
  return windows;
}

/** Language-neutral evidence availability. Every requested behavior remains
 * semantically unreviewed until synthesis/claim validation checks its source.
 * Empty source is the only condition this helper can reject mechanically. */
export function understandFocusCoverage(focus: string | undefined, files: UnderstandSourceFile[]): UnderstandFocusCoverage {
  const requested = understandRequestedRoles(focus);
  return { requested, missing: [...requested], sourceBodiesAvailable: files.some(file => Boolean(file.content.trim())) };
}

export function understandIncompleteFocusMessage(coverage: UnderstandFocusCoverage): string | undefined {
  if (!coverage.requested.length || coverage.sourceBodiesAvailable) return undefined;
  return `No source bodies were attached for ${coverage.requested.join(", ")}, so those implementations remain unverified in this turn.`;
}

/** Discover and read through the canonical remote workspace within the shared gather deadline. */
export async function gatherUnderstandSourceEvidence(options: {
  workspace: Pick<IndexedRepoWorkspace, "findFiles" | "readFile">;
  target: RepoTarget;
  focus: string;
  deadlineAt: number;
  signal?: AbortSignal;
  onRead?: (path: string) => void;
  onDiagnostic?: (event: Record<string, unknown>) => void;
}): Promise<{ entryFiles: UnderstandSourceFile[]; focusSearchPaths: string[] }> {
  const files: UnderstandSourceFile[] = [];
  const paths: string[] = [];
  const reads = new Map<string, Promise<void>>();
  let finished = false;
  const available = () => !finished && !options.signal?.aborted && Date.now() < options.deadlineAt;
  const read = (path: string): Promise<void> => {
    if (reads.has(path)) return reads.get(path)!;
    if (!available() || reads.size >= 8) return Promise.resolve();
    paths.push(path);
    const pending = (async () => {
      options.onRead?.(path);
      try {
        const file = await options.workspace.readFile(options.target, path);
        if (finished || options.signal?.aborted || !file || file.origin !== "remote" || file.repoId !== options.target.repoId || !file.content.trim()) return;
        const windows = understandSourceWindows(file, options.focus);
        files.push(...windows);
        options.onDiagnostic?.({ stage: "understand-source-read", path: file.path, repoId: file.repoId,
          branch: options.target.branch, bodyChars: file.content.length,
          windows: windows.map(window => ({ startLine: window.startLine, endLine: window.endLine })) });
      } catch { /* A read miss remains an explicit coverage limit. */ }
    })();
    reads.set(path, pending);
    return pending;
  };
  const find = async (query: string, family?: string): Promise<string[]> => {
    if (!available()) return [];
    try {
      const hits = await options.workspace.findFiles(options.target, query, { limit: 100,
        acceptPath: isUnderstandBackendSource,
        rankPaths: candidates => rankUnderstandSourcePaths(candidates, options.focus, family),
        onDiagnostic: options.onDiagnostic });
      return rankUnderstandSourcePaths((hits ?? []).map(hit => hit.path), options.focus, family);
    } catch { return []; }
  };
  const work = (async () => {
    const queries = understandFocusQueries(options.focus) ?? [options.focus];
    // Each independent topic gets a chance to read evidence as it finishes;
    // one slow search cannot prevent completed siblings from being retained.
    await Promise.all(queries.map(async query => {
      const candidates = await find(query);
      await Promise.all(candidates.slice(0, 2).map(read));
    }));
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([work, new Promise<void>(resolve => {
      timer = setTimeout(resolve, Math.max(0, options.deadlineAt - Date.now()));
      onAbort = () => { finished = true; resolve(); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    })]);
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
  return { entryFiles: [...files], focusSearchPaths: [...paths] };
}
