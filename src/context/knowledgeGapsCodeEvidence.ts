import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { extractNamedSourceFiles } from "../api/agent/searchQuery";
import { isOnboardingNoisePath } from "./onboardingSearchQueries";
import {
  knowledgeGapsFilenameQueries,
  knowledgeGapsFocusUsesSelectedFile,
  openFileRelatedToGapsFocus
} from "./knowledgeGapsFocus";

export type KnowledgeGapsSourceWindow = {
  path: string;
  repoId: string;
  content: string;
  startLine: number;
  truncated?: boolean;
  enclosingClass?: string;
};
export type KnowledgeGapsCodeEvidence = {
  focusSearchPaths: string[];
  focusFiles: KnowledgeGapsSourceWindow[];
};

/** Work limits apply to every topic and repository, including concurrent leads. */
export const KNOWLEDGE_GAPS_SOURCE_POLICY = {
  primaryFiles: 4, linkedFiles: 2, candidatesPerQuery: 30,
  fullFileChars: 14_000, windowChars: 8_000, windowsPerFile: 2,
  maxSourceChars: 96_000
} as const;

/** Rank discovered paths only. A filename is a lead, never an established rule. */
export function rankKnowledgeGapsCodePaths(paths: string[], focus: string): string[] {
  const terms = knowledgeGapsFilenameQueries(focus);
  const score = (path: string): number => {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? lower;
    let rank = terms.filter(term => lower.includes(term)).length;
    rank += terms.filter(term => base.includes(term)).length;
    if (isOnboardingNoisePath(path)) rank -= 100;
    return rank;
  };
  return [...new Set(paths)].filter(path => path.trim())
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

/** Keep bounded original lines around user-term matches; excerpts prove no semantics. */
export function knowledgeGapsSourceWindows(
  file: { path: string; repoId: string; content: string; truncated?: boolean },
  focus: string
): KnowledgeGapsSourceWindow[] {
  if (file.content.length <= KNOWLEDGE_GAPS_SOURCE_POLICY.fullFileChars) return [{ ...file, startLine: 1 }];
  const lines = file.content.split("\n");
  const terms = knowledgeGapsFilenameQueries(focus);
  let anchors: Array<{ index: number; score: number }> = [];
  // Scan once and retain only a fixed number of leads; never sort every match
  // or rescan the full file for every line as source volume grows.
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const score = terms.filter(term => lower.includes(term)).length;
    if (!score) return;
    const nearby = anchors.findIndex(anchor => Math.abs(anchor.index - index) < 110);
    if (nearby >= 0) {
      if (score > anchors[nearby].score) anchors[nearby] = { index, score };
    } else anchors.push({ index, score });
    anchors = anchors.sort((a,b) => b.score - a.score || a.index - b.index).slice(0, 8);
  });
  const ranges: Array<{ start: number; end: number }> = [];
  const fitEnd = (start: number, limit: number): number => {
    let end = start, chars = 0;
    while (end < limit) {
      const added = lines[end].length + (end > start ? 1 : 0);
      if (chars + added > KNOWLEDGE_GAPS_SOURCE_POLICY.windowChars) break;
      chars += added; end++;
    }
    return end;
  };
  for (const anchor of anchors) {
    if (ranges.some(range => anchor.index >= range.start && anchor.index < range.end)) continue;
    let start = Math.max(0, anchor.index - 12);
    let limit = Math.min(lines.length, anchor.index + 110);
    for (const range of ranges) {
      if (range.end <= anchor.index) start = Math.max(start, range.end);
      else if (range.start > anchor.index) limit = Math.min(limit, range.start);
    }
    let end = fitEnd(start, limit);
    if (end <= anchor.index) { start = anchor.index; end = fitEnd(start, limit); }
    if (end <= start) continue; // A single over-budget line cannot be quoted partially.
    ranges.push({ start, end });
    if (ranges.length === KNOWLEDGE_GAPS_SOURCE_POLICY.windowsPerFile) break;
  }
  if (!ranges.length) {
    const end = fitEnd(0, Math.min(80, lines.length));
    if (end) ranges.push({ start: 0, end });
  }
  return ranges.sort((a, b) => a.start - b.start).map(range => ({
    path: file.path, repoId: file.repoId, startLine: range.start + 1,
    content: lines.slice(range.start, range.end).join("\n"), truncated: true
  }));
}

/** Focused remote discovery starts before scans/integrations can spend the gather budget. */
export async function gatherKnowledgeGapsCodeEvidence(options: {
  target: RepoTarget;
  workspace: Pick<IndexedRepoWorkspace, "findFiles" | "readFile">;
  focus: string;
  namedPaths?: string[];
  selectedFile?: string;
  deadlineAt: number;
  signal?: AbortSignal;
  onDiagnostic?: (event: Record<string, unknown>) => void;
  onRead?: (path: string) => void;
  searchFocus?: () => Promise<Array<{ path: string }>>;
}): Promise<KnowledgeGapsCodeEvidence> {
  const evidence: KnowledgeGapsCodeEvidence = { focusSearchPaths: [], focusFiles: [] };
  let finished = false;
  if (!options.target.repoId || options.signal?.aborted) return evidence;
  const policy = KNOWLEDGE_GAPS_SOURCE_POLICY;
  const named = [...new Set([...extractNamedSourceFiles(options.focus), ...(options.namedPaths ?? [])])].slice(0, policy.primaryFiles);
  const selected = options.selectedFile && openFileRelatedToGapsFocus(options.selectedFile, options.focus)
    ? options.selectedFile : undefined;
  const reads = new Map<string, Promise<void>>();
  const bodies = new Map<string, string>();
  const read = (rawPath: string, linked = false): Promise<void> => {
    const path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const existing = reads.get(path);
    if (existing) return existing;
    if (finished || options.signal?.aborted || Date.now() >= options.deadlineAt ||
      reads.size >= policy.primaryFiles + (linked ? policy.linkedFiles : 0)) return Promise.resolve();
    if (!evidence.focusSearchPaths.includes(path)) evidence.focusSearchPaths.push(path);
    const pending = (async () => {
      options.onRead?.(path);
      try {
        const file = await options.workspace.readFile(options.target, path);
        if (finished) return;
        if (!file || file.origin !== "remote" || !file.content.trim() || file.repoId !== options.target.repoId || file.path !== path) return;
        const windows = knowledgeGapsSourceWindows(file, options.focus);
        if (!windows.length) return;
        bodies.set(file.path, file.content);
        evidence.focusFiles.push(...windows);
        options.onDiagnostic?.({ stage: "gaps-source-read", path: file.path,
          repoId: file.repoId, branch: options.target.branch, bodyChars: file.content.length,
          windows: evidence.focusFiles.filter(window => window.path === file.path).map(window => ({ startLine: window.startLine, chars: window.content.length })) });
      } catch { /* Unavailable body is a coverage limit, never absence. */ }
    })();
    reads.set(path, pending);
    return pending;
  };
  const work = (async () => {
    if (named.length) { await Promise.all(named.map(path => read(path))); return; }
    if (selected && knowledgeGapsFocusUsesSelectedFile(options.focus)) {
      // An explicit selected-file audit has the same scope as a named-file ask.
      await read(selected);
      return;
    }
    const selectedRead = selected ? read(selected) : Promise.resolve();
    const semantic = Promise.resolve().then(() => options.searchFocus?.() ?? []).catch(() => []);
    const filenameSearch = async () => {
      const hits = await Promise.all(knowledgeGapsFilenameQueries(options.focus).map(async query => {
        try {
          return await options.workspace.findFiles(options.target, query, {
            limit: policy.candidatesPerQuery, onDiagnostic: options.onDiagnostic,
            rankPaths: paths => rankKnowledgeGapsCodePaths(paths, options.focus)
          }).then(hits => (hits ?? []).slice(0, policy.candidatesPerQuery));
        } catch { return []; }
      }));
      const ranked = rankKnowledgeGapsCodePaths(hits.flat().map(hit => hit.path), options.focus);
      await Promise.all(ranked.slice(0, policy.primaryFiles).map(path => read(path)));
    };
    await Promise.all([selectedRead, filenameSearch()]);
    if (!evidence.focusFiles.length) {
      const hits = (await semantic).slice(0, policy.candidatesPerQuery * 4);
      await Promise.all(rankKnowledgeGapsCodePaths(hits.map(hit => hit.path), options.focus)
        .slice(0, policy.primaryFiles - reads.size).map(path => read(path)));
    }
    // Literal relative imports are bounded discovery leads, not proof of a
    // runtime binding. Package aliases and ambiguous filenames remain unknown.
    const linkedPaths = [...new Set([...bodies].flatMap(([path,content]) =>
      [...content.matchAll(/(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/g)].flatMap(match => {
        if (!match[1].startsWith(".")) return [];
        const parts = path.split("/").slice(0, -1);
        for (const part of match[1].split("/")) {
          if (part === ".") continue;
          if (part === "..") { if (!parts.length) return []; parts.pop(); }
          else parts.push(part);
        }
        return [parts.join("/")];
      })
    ))].sort().slice(0, policy.linkedFiles);
    await Promise.all(linkedPaths.map(async linkedPath => {
      if (finished || Date.now() >= options.deadlineAt) return;
      try {
        const hits = await options.workspace.findFiles(options.target, linkedPath, { limit: 10 });
        const escaped = linkedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matcher = new RegExp(`^${escaped}${linkedPath.split("/").pop()?.includes(".") ? "" : "(?:\\.[^/.]+)?"}$`);
        const exact = [...new Set((hits ?? []).slice(0, 10).map(hit => hit.path)
          .filter(path => matcher.test(path)))];
        if (exact.length === 1) await read(exact[0], true);
      } catch { /* An unavailable helper remains outside reviewed evidence. */ }
    }));
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>(resolve => {
    onStop = () => { finished = true; resolve(); };
    options.signal?.addEventListener("abort", onStop, {once: true});
  });
  await Promise.race([work, stopped, new Promise<void>(resolve => {
    timer = setTimeout(resolve, Math.max(0, options.deadlineAt - Date.now()));
  })]);
  if (timer) clearTimeout(timer);
  if (onStop) options.signal?.removeEventListener("abort", onStop);
  finished = true;
  // Snapshot completed reads. Late work cannot mutate a synthesized/abandoned turn.
  // Completion order is network timing, not relevance or evidence quality.
  const orderedPaths = rankKnowledgeGapsCodePaths(evidence.focusFiles.map(file => file.path), options.focus);
  if (selected && orderedPaths.includes(selected)) {
    orderedPaths.splice(orderedPaths.indexOf(selected), 1);
    orderedPaths.unshift(selected);
  }
  return { focusSearchPaths: [...evidence.focusSearchPaths], focusFiles: [...evidence.focusFiles].sort((a,b) =>
    orderedPaths.indexOf(a.path) - orderedPaths.indexOf(b.path) || a.startLine - b.startLine) };
}
