import type { IndexBackend } from "../indexing/indexBackend";
import type { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { remainingContextGatherBudgetMs } from "../config/responseDeadline";
import {
  asGraphEdgeSource,
  extractDefinedNamesFromSource,
  extractExportNamesFromSource,
  isRemoteTrustedBlastGraphSource,
  rankCodeDependentsByRisk,
  resolveNamedBlastSymbols,
  searchDependentsFallback,
  splitBlastRadiusDependents,
  verifyRemoteFilesMentionNamedSymbol,
  type BlastRadiusDependentDetail
} from "../engines/blastRadiusDependentsFallback";
import type { BlastRadiusEvidence } from "./contextBundleEvidence";

export type BlastRadiusSourceFile = {
  path: string;
  repoId: string;
  branch?: string;
  role: "target" | "dependent";
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
};

const MAX_CALLER_READS = 3;
const MAX_SOURCE_CHARS = 32_000;

/** Core Blast evidence first. Every body is selected-ref remote evidence, never workspace disk. */
export async function gatherBlastRadiusSourceEvidence(options: {
  workspace: Pick<IndexedRepoWorkspace, "readFile">;
  indexBackend: IndexBackend;
  target: RepoTarget;
  file: string;
  askText?: string;
  selectedSymbol?: string;
  startedAt: number;
  signal?: AbortSignal;
  onRead?: (file: BlastRadiusSourceFile) => void;
}): Promise<BlastRadiusEvidence> {
  const evidence: BlastRadiusEvidence = {
    file: options.file, directDependents: [], transitiveDependents: [],
    sourceFiles: [], sourceEvidenceGathered: true, completeness: "minimal"
  };
  const budgetMs = remainingContextGatherBudgetMs(options.startedAt);
  if (!options.target.repoId || budgetMs <= 0 || options.signal?.aborted) return evidence;

  let settled = false;
  const canGather = () => !settled && !options.signal?.aborted &&
    remainingContextGatherBudgetMs(options.startedAt) > 0;
  const reads = new Map<string, Promise<string | undefined>>();
  const read = (path: string, role: BlastRadiusSourceFile["role"]): Promise<string | undefined> => {
    const existing = reads.get(path);
    if (existing) return existing;
    if (role === "dependent" && reads.size >= MAX_CALLER_READS + 1) return Promise.resolve(undefined);
    if (!canGather()) return Promise.resolve(undefined);
    const pending = options.workspace.readFile(options.target, path).then(file => {
      if (!file?.content?.trim() || file.origin !== "remote" ||
          file.repoId !== options.target.repoId || file.path !== path || settled || options.signal?.aborted) return undefined;
      // Keep line boundaries intact; a truncated body never proves absence of upstream guards.
      const lines = file.content.split("\n");
      let chars = 0;
      let end = 0;
      while (end < lines.length && chars + lines[end].length + 1 <= MAX_SOURCE_CHARS) {
        chars += lines[end].length + 1;
        end++;
      }
      if (!end) return undefined;
      const source: BlastRadiusSourceFile = {
        path, repoId: file.repoId, branch: options.target.branch, role,
        content: lines.slice(0, end).join("\n"), startLine: 1, endLine: end,
        truncated: Boolean(file.truncated || end < lines.length)
      };
      evidence.sourceFiles!.push(source);
      options.onRead?.(source);
      return source.content;
    }).catch(() => undefined);
    reads.set(path, pending);
    return pending;
  };
  const setDependents = (details: BlastRadiusDependentDetail[], source: string): void => {
    if (settled || options.signal?.aborted) return;
    const split = splitBlastRadiusDependents(details);
    evidence.dependentDetails = split.codeDependentDetails;
    evidence.docsReferences = split.docsReferences;
    evidence.directDependents = split.codeDependentDetails.map(entry => entry.path);
    evidence.graphMeta = { source };
    evidence.completeness = evidence.directDependents.length ? "partial" : "minimal";
  };
  const load = async (): Promise<void> => {
    // Do not wait for secondary owners/PRs/transitive expansion before opening callers.
    const targetRead = read(options.file, "target");
    let details: BlastRadiusDependentDetail[] = [];
    try {
      const graph = await options.indexBackend.dependents(options.target.repoId!, options.file);
      if (isRemoteTrustedBlastGraphSource(graph.source)) {
        details = [...new Set(graph.dependents)].filter(path => path !== options.file)
          .map(path => ({ path, depth: 1, source: asGraphEdgeSource(graph.source) }));
        setDependents(details, graph.source);
      }
    } catch { /* An index miss is a coverage limit, not proof of safety. */ }

    const callerReads = rankCodeDependentsByRisk(splitBlastRadiusDependents(details).codeDependentDetails, MAX_CALLER_READS)
      .map(entry => read(entry.path, "dependent"));
    const targetBody = await targetRead;
    const named = resolveNamedBlastSymbols(options.askText, {
      file: options.file, selectedSymbol: options.selectedSymbol,
      definedNames: extractDefinedNamesFromSource(targetBody ?? "")
    });
    if (!settled && !options.signal?.aborted) evidence.namedAskSymbols = named.length ? named : undefined;
    if (!details.length && canGather()) {
      const fallback = await searchDependentsFallback(options.indexBackend, options.target.repoId!, options.file, {
        remoteOnly: true, maxPatterns: 4, namedAskSymbols: named,
        symbols: named.length ? named : extractExportNamesFromSource(targetBody ?? ""),
        readRemoteFile: path => read(path, "dependent"), shouldAbort: () => !canGather()
      });
      if (isRemoteTrustedBlastGraphSource(fallback.source)) {
        details = fallback.dependents;
        setDependents(details, fallback.source);
        callerReads.push(...rankCodeDependentsByRisk(splitBlastRadiusDependents(details).codeDependentDetails, MAX_CALLER_READS)
          .map(entry => read(entry.path, "dependent")));
      }
    }
    await Promise.all(callerReads);
    if (named.length && details.length && canGather()) {
      const confirmed = await verifyRemoteFilesMentionNamedSymbol(details, named,
        path => read(path, "dependent"), { maxFiles: MAX_CALLER_READS, shouldAbort: () => !canGather() });
      setDependents(confirmed, evidence.graphMeta?.source ?? "remote");
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveStop: (() => void) | undefined;
  const stop = new Promise<void>(resolve => { resolveStop = resolve; timer = setTimeout(resolve, budgetMs); });
  const onAbort = (): void => { settled = true; resolveStop?.(); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([load(), stop]);
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
  return evidence;
}
