import type { DependencyEdge, GraphQueryResult, OwnershipEntry } from "../cache/graphCache";
import type { GraphQueryApi } from "./graphQuery";
import type { ChatOrgPlan } from "./types";

export const INLINE_GRAPH_TIMEOUT_MS = 150;
const MAX_DEPENDENTS = 5;

export type InlineGraphSliceResult =
  | { status: "ok"; block: string }
  | { status: "degraded" }
  | { status: "skipped" };

export type InlineGraphContextDeps = {
  graphQuery?: GraphQueryApi;
};

type GraphSliceData = {
  file: string;
  dependents: DependencyEdge[];
  ownership?: OwnershipEntry;
};

export async function fetchInlineGraphSlice(
  deps: InlineGraphContextDeps,
  options: { repoId: string; file: string; plan: ChatOrgPlan }
): Promise<InlineGraphSliceResult> {
  if (!deps.graphQuery) {
    return { status: "degraded" };
  }

  try {
    const slice = await withTimeout(fetchSliceData(deps.graphQuery, options.repoId, options.file), INLINE_GRAPH_TIMEOUT_MS);
    if (!slice) {
      return { status: "degraded" };
    }
    return { status: "ok", block: formatInlineGraphBlock(slice) };
  } catch {
    return { status: "degraded" };
  }
}

async function fetchSliceData(
  graphQuery: GraphQueryApi,
  repoId: string,
  file: string
): Promise<GraphSliceData | undefined> {
  const [dependentsResult, ownershipResult] = await Promise.all([
    graphQuery.queryGraph({
      repoId,
      query: "getDependents",
      filters: { file }
    }) as Promise<GraphQueryResult<DependencyEdge[]> | undefined>,
    graphQuery.queryGraph({
      repoId,
      query: "getOwnership",
      filters: { file }
    }) as Promise<GraphQueryResult<OwnershipEntry | undefined> | undefined>
  ]);

  if (!dependentsResult && !ownershipResult) {
    return undefined;
  }

  return {
    file,
    dependents: dependentsResult?.data ?? [],
    ownership: ownershipResult?.data
  };
}

export function formatInlineGraphBlock(slice: GraphSliceData): string {
  const lines = ["GRAPH:", `file: ${slice.file}`];

  if (slice.dependents.length > 0) {
    lines.push("dependents:");
    for (const edge of slice.dependents.slice(0, MAX_DEPENDENTS)) {
      lines.push(`  - ${edge.from} (${edge.type})`);
    }
  }

  if (slice.ownership?.primaryOwner) {
    lines.push(`owner: ${slice.ownership.primaryOwner}`);
  }

  return lines.join("\n");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("inline graph context timed out")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
