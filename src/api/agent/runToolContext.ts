import { CandidateLedger } from "./candidateLedger";
import { gatherRequest } from "./gatherRequest";
import type { RepoTarget } from "../../workspace/indexedRepoWorkspaceTypes";
import type { AgentToolContext } from "./agentToolContext";
import type { LocalSearchResult } from "../../indexing/types";
import { isApiRejectAsk } from "./searchQuery";
import { LOCATE_PREFETCH_MIN_MS, requiredEvidenceDeadlineAt } from "../../config/responseDeadline";
import { normalizeRequestedPath, resolveRepoFileScope, repoFileScopeAllowsPath } from "./requestedRepoFiles";

/** Each turn owns its target and tool state, even when another chat starts. */
export function createRunToolContext(
  ctx: AgentToolContext,
  target: RepoTarget,
  diagnostic?: (event: Record<string, unknown>) => void
): AgentToolContext {
  const locked = Object.freeze({ ...target });
  const scope = resolveRepoFileScope(ctx.researchQuery ?? "");
  const allows = (path: string) => repoFileScopeAllowsPath(scope, path);
  const candidateLedger = new CandidateLedger();
  const reads = new Map<string, ReturnType<NonNullable<AgentToolContext["readRemoteFile"]>>>();
  const rejectEvidenceDeadline =
    ctx.gatherStartedAt !== undefined && isApiRejectAsk(ctx.researchQuery ?? "")
      ? requiredEvidenceDeadlineAt(ctx.gatherStartedAt)
      : undefined;
  const evidenceGatherOptions = rejectEvidenceDeadline === undefined
    ? undefined
    : { deadlineAt: rejectEvidenceDeadline };
  const indexSearchReserveMs = ctx.findFiles || ctx.searchCodeHost
    ? LOCATE_PREFETCH_MIN_MS
    : 0;
  const trace = (stage: string, details: Record<string, unknown>) =>
    diagnostic?.({ ...details, stage, repoId: locked.repoId, resolvedBranch: locked.branch });
  return {
    ...ctx,
    repoTarget: locked,
    candidateLedger,
    indexBackend: new Proxy(ctx.indexBackend, {
      get(backend, property) {
        if (property === "search") return async (repoId: string, pattern: string, options?: Parameters<typeof backend.search>[2]) => {
          // Keep a bounded slice for filename/code-host fallback after a slow index.
          const result = await gatherRequest<LocalSearchResult>(ctx, "index-search", () => backend.search(repoId, pattern, options), {
            source: "fallback",
            hits: [],
            symbols: [],
            stale: false,
            availability: "timed_out"
          }, { reserveMs: indexSearchReserveMs });
          return { ...result, hits: result.hits.filter(hit => allows(hit.fileName)), symbols: result.symbols.filter(symbol => allows(symbol.file)) };
        };
        if (property === "isEnabledForRepo") return (repoId?: string) =>
          gatherRequest(ctx, "index-ready", () => backend.isEnabledForRepo(repoId), false, evidenceGatherOptions);
        const value = Reflect.get(backend, property);
        return typeof value === "function" ? value.bind(backend) : value;
      }
    }),
    onDiagnostic: (event) => trace(String(event.stage ?? "retrieval"), event),
    listDirectory: ctx.listDirectory && (async (input) => {
      const result = await gatherRequest(ctx, "directory", () => ctx.listDirectory!({ ...input, repoId: locked.repoId, target: locked }), undefined);
      if (!result) throw new Error("Directory evidence unavailable");
      return result;
    }),
    getBlame: ctx.getBlame && (async (input) => {
      if (!allows(input.path)) throw new Error("File excluded by the user's source restriction");
      const result = await gatherRequest(ctx, "blame", () => ctx.getBlame!({ ...input, repoId: locked.repoId, target: locked }), undefined);
      if (!result) throw new Error("Blame evidence unavailable");
      return result;
    }),
    readRemoteFile: ctx.readRemoteFile && (async (input) => {
      if (!allows(input.path)) {
        trace("remote-read", { path: input.path, outcome: "excluded" });
        return undefined;
      }
      const startedAt = Date.now();
      try {
        const key = input.path.replace(/^\/+/, "");
        let pending = reads.get(key);
        const cacheHit = pending !== undefined;
        if (!pending) {
          pending = gatherRequest(ctx, "remote-read", () => ctx.readRemoteFile!({ ...input, repoId: locked.repoId, target: locked }), undefined, evidenceGatherOptions);
          reads.set(key, pending);
        }
        const result = await pending;
        if (ctx.searchSignal?.aborted) return undefined;
        if (result && (normalizeRequestedPath(result.path) !== normalizeRequestedPath(key) ||
            (result.repoId !== undefined && result.repoId !== locked.repoId) ||
            (result.branch !== undefined && result.branch !== locked.branch))) {
          trace("remote-read", { path: input.path, outcome: "target-mismatch" });
          return undefined;
        }
        candidateLedger.record(locked.repoId ?? "", key, ctx.researchQuery ?? "", result?.content?.trim() ? "untested" : "unavailable");
        trace("remote-read", { path: input.path, returnedPath: result?.path, outcome: result?.content?.trim() ? "body" : "empty", bodyChars: result?.content?.length ?? 0, cacheHit, elapsedMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        trace("remote-read", { path: input.path, outcome: "error", elapsedMs: Date.now() - startedAt });
        throw error;
      }
    }),
    findFiles: ctx.findFiles && (async (input) => {
      const startedAt = Date.now();
      trace("filename-search-start", { query: input.query });
      try {
        const paths = await gatherRequest(ctx, "filename-search", () => ctx.findFiles!({ ...input, repoId: locked.repoId, target: locked, onDiagnostic: (event) => trace(String(event.stage), event) }), [], evidenceGatherOptions);
        trace("filename-search", { query: input.query, outcome: paths.length ? "paths" : "empty", paths, elapsedMs: Date.now() - startedAt });
        return paths.filter(allows);
      } catch (error) {
        trace("filename-search", { query: input.query, outcome: "error", code: (error as { code?: string }).code, elapsedMs: Date.now() - startedAt });
        throw error;
      }
    }),
    searchCodeHost: ctx.searchCodeHost && (async (input) => {
      try {
        const hits = await gatherRequest(ctx, "host-search", () => ctx.searchCodeHost!({ ...input, repoId: locked.repoId, target: locked }), [], evidenceGatherOptions);
        trace("host-search", { query: input.query, outcome: hits.length ? "paths" : "empty", paths: hits.map((hit) => hit.path) });
        return hits.filter(hit => allows(hit.path));
      } catch (error) {
        const details = error as { code?: unknown; status?: unknown };
        trace("host-search", { query: input.query, outcome: "error", code: typeof details.code === "string" ? details.code : undefined, status: typeof details.status === "number" ? details.status : undefined });
        throw error;
      }
    })
  };
}
