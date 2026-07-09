import type { DependencyEdge, GraphQueryResult, OwnershipEntry } from "../cache/graphCache";
import type { GraphQueryApi } from "./graphQuery";
import type { ChatOrgPlan } from "./types";

export const INLINE_GRAPH_TIMEOUT_MS = 250;
const MAX_DEPENDENTS = 5;
const MAX_IMPORTS = 5;
const MAX_SNIPPET_FILES = 2;
const MAX_SNIPPET_LINES = 2;
const MAX_SNIPPET_LINE_CHARS = 120;

export type InlineGraphSliceResult =
  | { status: "ok"; block: string }
  | { status: "degraded" }
  | { status: "skipped" };

export type InlineGraphFileSnippetFetcher = (input: {
  orgId?: string;
  repoId: string;
  path: string;
}) => Promise<string | undefined>;

export type InlineGraphContextDeps = {
  graphQuery?: GraphQueryApi;
  fetchFileSnippet?: InlineGraphFileSnippetFetcher;
};

type GraphSliceData = {
  file: string;
  dependents: DependencyEdge[];
  imports: DependencyEdge[];
  ownership?: OwnershipEntry;
  snippets?: Record<string, string>;
};

export async function fetchInlineGraphSlice(
  deps: InlineGraphContextDeps,
  options: { repoId: string; file: string; plan: ChatOrgPlan; orgId?: string }
): Promise<InlineGraphSliceResult> {
  if (!deps.graphQuery) {
    return { status: "degraded" };
  }

  const deadline = Date.now() + INLINE_GRAPH_TIMEOUT_MS;
  try {
    const slice = await withDeadline(
      fetchSliceData(deps, options.repoId, options.file, options.orgId, deadline),
      deadline
    );
    if (!slice) {
      return { status: "degraded" };
    }
    return { status: "ok", block: formatInlineGraphBlock(slice) };
  } catch {
    return { status: "degraded" };
  }
}

async function fetchSliceData(
  deps: InlineGraphContextDeps,
  repoId: string,
  file: string,
  orgId: string | undefined,
  deadline: number
): Promise<GraphSliceData | undefined> {
  const graphQuery = deps.graphQuery!;
  const [dependentsResult, importsResult, ownershipResult] = await Promise.all([
    graphQuery.queryGraph({
      repoId,
      query: "getDependents",
      filters: { file }
    }) as Promise<GraphQueryResult<DependencyEdge[]> | undefined>,
    graphQuery.queryGraph({
      repoId,
      query: "getImports",
      filters: { file }
    }) as Promise<GraphQueryResult<DependencyEdge[]> | undefined>,
    graphQuery.queryGraph({
      repoId,
      query: "getOwnership",
      filters: { file }
    }) as Promise<GraphQueryResult<OwnershipEntry | undefined> | undefined>
  ]);

  if (!dependentsResult && !importsResult && !ownershipResult) {
    return undefined;
  }

  const slice: GraphSliceData = {
    file,
    dependents: dependentsResult?.data ?? [],
    imports: importsResult?.data ?? [],
    ownership: ownershipResult?.data
  };

  if (deps.fetchFileSnippet && remainingMs(deadline) > 15) {
    const snippets = await fetchDependencySnippets(deps.fetchFileSnippet, slice, repoId, orgId, deadline);
    if (Object.keys(snippets).length > 0) {
      slice.snippets = snippets;
    }
  }

  return slice;
}

async function fetchDependencySnippets(
  fetchFileSnippet: InlineGraphFileSnippetFetcher,
  slice: Pick<GraphSliceData, "dependents" | "imports">,
  repoId: string,
  orgId: string | undefined,
  deadline: number
): Promise<Record<string, string>> {
  const paths = pickSnippetPaths(slice);
  if (paths.length === 0) {
    return {};
  }

  const snippets: Record<string, string> = {};
  await Promise.all(
    paths.map(async (path) => {
      if (remainingMs(deadline) <= 5) {
        return;
      }
      const content = await fetchFileSnippet({ orgId, repoId, path });
      const snippet = formatSnippetLines(content);
      if (snippet) {
        snippets[path] = snippet;
      }
    })
  );
  return snippets;
}

export function pickSnippetPaths(slice: Pick<GraphSliceData, "dependents" | "imports">): string[] {
  const paths: string[] = [];
  for (const edge of slice.dependents) {
    const path = edge.from?.trim();
    if (path && !paths.includes(path)) {
      paths.push(path);
    }
    if (paths.length >= MAX_SNIPPET_FILES) {
      return paths;
    }
  }
  for (const edge of slice.imports) {
    const path = edge.to?.trim();
    if (path && !paths.includes(path)) {
      paths.push(path);
    }
    if (paths.length >= MAX_SNIPPET_FILES) {
      break;
    }
  }
  return paths;
}

export function formatSnippetLines(content: string | undefined, maxLines = MAX_SNIPPET_LINES): string {
  if (!content?.trim()) {
    return "";
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines)
    .map((line) =>
      line.length > MAX_SNIPPET_LINE_CHARS ? `${line.slice(0, MAX_SNIPPET_LINE_CHARS)}…` : line
    );
  return lines.join(" | ");
}

export function formatInlineGraphBlock(slice: GraphSliceData): string {
  const lines = ["GRAPH:", `file: ${slice.file}`];

  if (slice.dependents.length > 0) {
    lines.push("dependents:");
    for (const edge of slice.dependents.slice(0, MAX_DEPENDENTS)) {
      lines.push(`  - ${edge.from} (${edge.type})`);
      appendSnippetLine(lines, edge.from, slice.snippets);
    }
  }

  if (slice.imports.length > 0) {
    lines.push("imports:");
    for (const edge of slice.imports.slice(0, MAX_IMPORTS)) {
      lines.push(`  - ${edge.to} (${edge.type})`);
      appendSnippetLine(lines, edge.to, slice.snippets);
    }
  }

  if (slice.ownership?.primaryOwner) {
    lines.push(`owner: ${slice.ownership.primaryOwner}`);
  }

  return lines.join("\n");
}

function appendSnippetLine(
  lines: string[],
  path: string,
  snippets: Record<string, string> | undefined
): void {
  const snippet = snippets?.[path];
  if (snippet) {
    lines.push(`    snippet: ${snippet}`);
  }
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const timeoutMs = remainingMs(deadline);
  if (timeoutMs <= 0) {
    return Promise.reject(new Error("inline graph context timed out"));
  }
  return withTimeout(promise, timeoutMs);
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
