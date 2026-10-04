import { CandidateLedger } from "./candidateLedger";
import { gatherRequest } from "./gatherRequest";
import type { RepoTarget } from "../../workspace/indexedRepoWorkspaceTypes";
import type { AgentToolContext } from "./agentToolContext";

/** Each turn owns its target and tool state, even when another chat starts. */
export function createRunToolContext(
  ctx: AgentToolContext,
  target: RepoTarget,
  diagnostic?: (event: Record<string, unknown>) => void
): AgentToolContext {
  const locked = Object.freeze({ ...target });
  const candidateLedger = new CandidateLedger();
  const reads = new Map<string, ReturnType<NonNullable<AgentToolContext["readRemoteFile"]>>>();
  const trace = (stage: string, details: Record<string, unknown>) =>
    diagnostic?.({ ...details, stage, repoId: locked.repoId, resolvedBranch: locked.branch });
  return {
    ...ctx,
    candidateLedger,
    indexBackend: new Proxy(ctx.indexBackend, {
      get(backend, property) {
        if (property === "search") return (repoId: string, pattern: string, options?: Parameters<typeof backend.search>[2]) =>
          gatherRequest(ctx, "index-search", () => backend.search(repoId, pattern, options), { source: "fallback" as const, hits: [], symbols: [], stale: true });
        if (property === "isEnabledForRepo") return (repoId?: string) =>
          gatherRequest(ctx, "index-ready", () => backend.isEnabledForRepo(repoId), false);
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
      const result = await gatherRequest(ctx, "blame", () => ctx.getBlame!({ ...input, repoId: locked.repoId, target: locked }), undefined);
      if (!result) throw new Error("Blame evidence unavailable");
      return result;
    }),
    readRemoteFile: ctx.readRemoteFile && (async (input) => {
      const startedAt = Date.now();
      try {
        const key = input.path.replace(/^\/+/, "");
        let pending = reads.get(key);
        const cacheHit = pending !== undefined;
        if (!pending) {
          pending = gatherRequest(ctx, "remote-read", () => ctx.readRemoteFile!({ ...input, repoId: locked.repoId, target: locked }), undefined);
          reads.set(key, pending);
        }
        const result = await pending;
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
        const paths = await gatherRequest(ctx, "filename-search", () => ctx.findFiles!({ ...input, repoId: locked.repoId, target: locked, onDiagnostic: (event) => trace(String(event.stage), event) }), []);
        trace("filename-search", { query: input.query, outcome: paths.length ? "paths" : "empty", paths, elapsedMs: Date.now() - startedAt });
        return paths;
      } catch (error) {
        trace("filename-search", { query: input.query, outcome: "error", code: (error as { code?: string }).code, elapsedMs: Date.now() - startedAt });
        throw error;
      }
    }),
    searchCodeHost: ctx.searchCodeHost && (async (input) => {
      try {
        const hits = await gatherRequest(ctx, "host-search", () => ctx.searchCodeHost!({ ...input, repoId: locked.repoId, target: locked }), []);
        trace("host-search", { query: input.query, outcome: hits.length ? "paths" : "empty", paths: hits.map((hit) => hit.path) });
        return hits;
      } catch (error) {
        const details = error as { code?: unknown; status?: unknown };
        trace("host-search", { query: input.query, outcome: "error", code: typeof details.code === "string" ? details.code : undefined, status: typeof details.status === "number" ? details.status : undefined });
        throw error;
      }
    })
  };
}
