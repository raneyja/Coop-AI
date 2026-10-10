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
export type UnderstandFocusCoverage = { requested: UnderstandRole[]; missing: UnderstandRole[] };

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
  const noun = focus.match(/\b([a-z][a-z0-9_-]*)\s+(?:creation|validation|persistence)\b/i)?.[1] ??
    focus.match(/\b(?:create|creates|creating|update|updates|write|writes)\s+(?:an?\s+|the\s+)?([a-z][a-z0-9_-]*)/i)?.[1];
  return noun && !/^(?:input|request|data|backend|api)$/i.test(noun)
    ? noun.toLowerCase().replace(/s$/, "") : undefined;
}

export function understandFocusQueries(focus: string | undefined): string[] | undefined {
  const roles = understandRequestedRoles(focus);
  if (!roles.length || !focus) return undefined;
  return [...new Set([
    understandDomainQuery(focus) ?? "handler",
    ...(roles.includes("authentication") ? ["authentication"] : []),
    ...(roles.includes("input validation") ? ["serializer"] : []),
    ...(roles.includes("persistence") ? ["model"] : [])
  ])];
}

export function isUnderstandBackendSource(path: string): boolean {
  return /\.(?:py|ts|js|go|rb|rs|java|php|cs)$/i.test(path) &&
    !/(?:^|\/)(?:web|frontend|components|hooks|stores|tests?|migrations|node_modules)(?:\/|$)/i.test(path) &&
    !/(?:\.test|\.spec|\.types|\.d)\.[tj]s$/i.test(path);
}

function pathRole(path: string, role: UnderstandRole): boolean {
  if (!isUnderstandBackendSource(path)) return false;
  if (role === "request handler") return /(?:^|\/)(?:views?|controllers?|handlers?|routes?|server)(?:\/|[._-])|(?:handler|controller|route|endpoint|service)s?\.[^.]+$/i.test(path) && !/\/urls\//.test(path);
  if (role === "input validation") return /serializ|validat|schema/i.test(path);
  if (role === "persistence") return /(?:^|\/)(?:models?|repositories|persistence|db)(?:\/|[._-])|(?:repository|persistence|model)\.[^.]+$/i.test(path);
  return /auth|middleware|(?:^|\/)base\./i.test(path);
}

export function rankUnderstandSourcePaths(paths: string[], focus: string, family?: string): string[] {
  const domain = understandDomainQuery(focus);
  const score = (path: string) => {
    const base = path.split("/").pop() ?? path;
    let value = domain && path.toLowerCase().includes(domain) ? 30 : 0;
    if (domain && base.split(".")[0].toLowerCase() === domain) value += 15;
    if (/\/(?:views?|controllers?|handlers?)\//.test(path)) value += 12;
    if (/\/(?:serializers?|validators?)\//.test(path)) value += 10;
    if (/\/urls\//.test(path)) value -= 30;
    if (family && path.startsWith(family)) value += 60;
    return value;
  };
  return [...new Set(paths)].filter(isUnderstandBackendSource)
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** Source excerpts retain complete original lines, including late create/validate/save methods. */
export function understandSourceWindows(file: UnderstandSourceFile): UnderstandSourceFile[] {
  const lines = file.content.split("\n");
  if (file.content.length <= 10_000) return [{ ...file, startLine: 1, endLine: lines.length }];
  const anchors = lines.map((line, index) => ({ index, score:
    /\b(?:def|function)\s+(?:create|post|validate|save|authenticate)\s*\(/.test(line) ? 30 :
    /authentication_classes\s*=|permission_classes\s*=/.test(line) ? 20 :
    /\b(?:objects\.create|serializer\.save|is_valid|ValidationError|\.parse\(|\.insert\(|\.create\()/.test(line) ? 10 : 0
  })).filter(item => item.score).sort((a, b) => b.score - a.score || a.index - b.index);
  const ranges = [{ start: 0, end: Math.min(75, lines.length) }];
  const first = anchors[0]?.index;
  let classStart = -1;
  if (first !== undefined) {
    for (let index = first; index >= 0; index--) {
      if (/^class\s+/.test(lines[index])) { classStart = index; break; }
    }
  }
  const classEnd = classStart < 0 ? -1 : lines.findIndex((line, index) => index > classStart && /^class\s+/.test(line));
  if (classStart >= 75) ranges.push({ start: classStart, end: Math.min(classStart + 20, lines.length) });
  for (const anchor of anchors) {
    // Do not spend the excerpt budget on another class's unrelated create method.
    if (classStart >= 0 && (anchor.index < classStart || (classEnd >= 0 && anchor.index >= classEnd))) continue;
    // A declaration at the end of the header is not its implementation.
    if (ranges.some(range => anchor.index >= range.start && anchor.index + Math.min(60, lines.length - anchor.index) <= range.end)) continue;
    const start = Math.max(0, anchor.index - 12);
    let end = Math.min(lines.length, anchor.index + 125);
    while (end > anchor.index + 1 && lines.slice(start, end).join("\n").length > 8_000) end--;
    ranges.push({ start, end });
    if (ranges.length === 3) break;
  }
  return ranges.sort((a, b) => a.start - b.start).map(range => ({ ...file,
    content: lines.slice(range.start, range.end).join("\n"),
    startLine: range.start + 1, endLine: range.end, truncated: true
  }));
}

/** Filenames/routes alone never establish a component's behavior. */
export function understandFocusCoverage(focus: string | undefined, files: UnderstandSourceFile[]): UnderstandFocusCoverage {
  const requested = understandRequestedRoles(focus);
  const windows = files.filter(file => isUnderstandBackendSource(file.path) && file.content.trim());
  const grouped = new Map<string, string[]>();
  for (const file of windows) grouped.set(file.path, [...(grouped.get(file.path) ?? []), file.content]);
  const bodies = [...grouped].map(([path, content]) => ({path, content: content.join("\n")}));
  const handlers = bodies.filter(file => pathRole(file.path, "request handler") &&
    /\brequest\.(?:data|body)|req\.body/.test(file.content) && /\b(?:is_valid|serializer\.save|\.parse\(|\.create\(|\.insert\()/.test(file.content));
  const validatorNames = handlers.flatMap(file => [...file.content.matchAll(/\b([A-Z]\w*(?:Serializer|Validator|Schema))\s*\(/g)].map(match => match[1]));
  const validators = bodies.filter(file => validatorNames.some(name => new RegExp(`\\bclass\\s+${name}\\b`).test(file.content)));
  const baseNames = handlers.flatMap(file => [...file.content.matchAll(/\bclass\s+\w+\((\w+)\)/g)].map(match => match[1]));
  const authBindings = bodies.filter(file => handlers.some(handler => handler.path === file.path) ||
    baseNames.some(name => new RegExp(`\\bclass\\s+${name}\\b`).test(file.content)));
  const established = (role: UnderstandRole) => bodies.some(file => {
    const text = file.content;
    if (role === "request handler") return handlers.some(handler => handler.path === file.path);
    if (role === "authentication") {
      if (!authBindings.some(binding => binding.path === file.path)) return false;
      const bound = text.match(/authentication_classes\s*=\s*[\[(]([^\])]+)[\])]/)?.[1].match(/[A-Za-z_]\w*/g) ?? [];
      return bound.some(name => bodies.some(source => new RegExp(`\\bclass\\s+${name}\\b`).test(source.content) &&
        /\bdef\s+authenticate\s*\(|\bclass\s+\w+\(SessionAuthentication\)/.test(source.content)));
    }
    if (role === "input validation") return validators.some(validator => validator.path === file.path) &&
      windows.some(window => window.path === file.path && /\bdef\s+validate\w*\s*\([^\n]*\):\s*\n[ \t]+\S|raise\s+(?:\w+\.)?ValidationError|throw\s+new\s+ValidationError|safeParse\(|\.parse\(/.test(window.content));
    if (!validators.some(validator => validator.path === file.path) && !handlers.some(handler => handler.path === file.path)) return false;
    return /\bobjects\.create\(|\b(?:prisma|db|tx)\.\w+\.create\(|\bINSERT INTO\b|\bsuper\([^\n]*\)\.save\(/.test(text);
  });
  return { requested, missing: requested.filter(role => !established(role)) };
}

export function understandIncompleteFocusMessage(coverage: UnderstandFocusCoverage): string | undefined {
  if (!coverage.missing.length) return undefined;
  return `The attached source does not establish ${coverage.missing.join(", ")}, so I can’t verify the requested backend flow or give a reliable reading list. Those implementations remain unverified in this turn.`;
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
  const bodies = new Map<string, string>();
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
        bodies.set(file.path, file.content);
        const windows = understandSourceWindows(file);
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
        excludeClientUi: true, acceptPath: isUnderstandBackendSource,
        rankPaths: candidates => rankUnderstandSourcePaths(candidates, options.focus, family),
        onDiagnostic: options.onDiagnostic });
      return rankUnderstandSourcePaths((hits ?? []).map(hit => hit.path), options.focus, family);
    } catch { return []; }
  };
  const work = (async () => {
    const auth = find("authentication");
    const domainPaths = await find(understandDomainQuery(options.focus) ?? "handler");
    const handler = domainPaths.find(path => pathRole(path, "request handler"));
    const family = handler ? handler.split(/\/(?:views?|controllers?|handlers?)\//)[0] + "/" : undefined;
    const ranked = rankUnderstandSourcePaths(domainPaths, options.focus, handler ? family : undefined);
    const seeds = [handler, ranked.find(path => pathRole(path, "input validation")), ranked.find(path => pathRole(path, "persistence"))]
      .filter((path): path is string => Boolean(path));
    const primary = Promise.all([
      ...seeds.map(read),
      ...(["input validation", "persistence"] as const).filter(role => !ranked.some(path => pathRole(path, role)))
        .map(async role => {
          const candidates = await find(role === "input validation" ? "serializer" : "model", family);
          const path = candidates.find(candidate => pathRole(candidate, role));
          if (path) await read(path);
        })
    ]);
    const authPaths = rankUnderstandSourcePaths(await auth, options.focus, handler ? family : undefined);
    const authRead = authPaths[0] ? read(authPaths[0]) : Promise.resolve();
    await Promise.all([primary, authRead]);
    // Follow actual Python module imports, including base-view authentication bindings.
    // Resolution uses discovered paths; no guessed host paths are read.
    const modules = [...new Set([...bodies.values()].flatMap(body =>
      [...body.matchAll(/^from\s+([\w.]+)\s+import\s+([^\n]+)/gm)]
        .filter(match => /base|auth/.test(match[1]) || /Authentication|BaseAPIView|BaseViewSet/.test(match[2]))
        .map(match => match[1])
    ))].slice(0, 3);
    await Promise.all(modules.map(async module => {
      const tail = module.split(".").pop()!;
      const discovered = await find(tail, handler ? family : undefined);
      const suffix = module.replace(/\./g, "/") + ".py";
      const exact = discovered.find(path => path.endsWith(suffix));
      if (exact) await read(exact);
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
