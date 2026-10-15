import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import type { ReviewedSourceWindow } from "../prompts/sourceCitationIntegrity";
import type { SourceClaimFact } from "./sourceClaimReview";
import { isRemoteTrustedBlastGraphSource } from "../engines/blastRadiusDependentsFallback";
import { streamSourceReviewedEvidence } from "./sourceBackedActionReview";

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const relativePath = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim())
  && !value.startsWith("/") && !value.split(/[\\/]/).includes("..");
const paths = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter(relativePath))] : [];

/** Admit only typed current-turn remote summary fields. No prompt/history
 * scraping, architecture summaries, earlier answers, or local disk evidence. */
export function snapshotUnderstandClaimEvidence(summary: RepoSummaryEvidence | undefined,
  identity: {owner?: string; repo?: string; branch?: string}): {windows: ReviewedSourceWindow[]; facts: SourceClaimFact[]} {
  if (!identity.owner?.trim() || !identity.repo?.trim() || !identity.branch?.trim()) {
    throw new Error("Source review requires a selected repository and branch.");
  }
  const scope = `${identity.owner}/${identity.repo}@${identity.branch}`;
  const windows: ReviewedSourceWindow[] = [];
  for (const file of summary?.entryFiles ?? []) {
    if (!relativePath(file.path) || !file.content?.trim()) continue;
    const startLine = file.startLine ?? 1;
    if (!Number.isSafeInteger(startLine) || startLine < 1) continue;
    const endLine = startLine + file.content.split("\n").length - 1;
    if (file.endLine !== undefined && file.endLine !== endLine) continue;
    // Legacy prefix truncation lacks proof of complete original source lines.
    if (file.truncated && (file.startLine === undefined || file.endLine === undefined)) continue;
    windows.push({path: file.path, content: file.content, startLine});
  }
  const facts: SourceClaimFact[] = [{kind: "sample", scope: `${scope}: inspected source coverage only; never complete repository/behavior coverage.`,
    value: {reviewedPaths: [...new Set(windows.map(window => window.path))], windowCount: windows.length}}];
  const inventory = summary?.repoInventory;
  if (inventory && ["index-stats", "manifest", "tree"].includes(inventory.source ?? "")
    && (!inventory.branch || inventory.branch === identity.branch)) {
    const value = {source: inventory.source,
      ...(inventory.branch ? {branch: inventory.branch} : {branchReported: false}),
      ...(count(inventory.fileCount) ? {fileCount: inventory.fileCount} : {}),
      ...(count(inventory.lineCount) ? {lineCount: inventory.lineCount} : {})};
    if ("fileCount" in value || "lineCount" in value) facts.push({kind: "inventory",
      scope: `${scope}: canonical measured indexed inventory; only fields present are available totals. An unreported indexed branch does not establish active-branch totals or inspected implementation coverage.`, value});
  }
  const tree = summary?.treeOverview;
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    const listing = tree as {topLevelDirs?: unknown; topLevelFiles?: unknown};
    const directories = paths(listing.topLevelDirs), files = paths(listing.topLevelFiles);
    if (directories.length || files.length) facts.push({kind: "tree",
      scope: `${scope}: listed top-level paths only; not file bodies, runtime roles, or recursive coverage.`,
      value: {directories, files}});
  }
  if (summary?.manifest) facts.push({kind: "sample",
    scope: `${scope}: retrieval manifest sample; never repository totals, implementation roles, or exhaustive coverage.`,
    value: {...(count(summary.manifest.fileCount) ? {sampleEntryCount: summary.manifest.fileCount} : {}),
      entryPaths: paths(summary.manifest.entryPoints)}});
  const graph = summary?.dependencyGraph;
  if (graph && relativePath(graph.entryFile) && isRemoteTrustedBlastGraphSource(graph.source)) {
    facts.push({kind: "dependency", scope: `${scope}: admitted remote relationships only; no behavioral effects or exhaustive coverage.`,
      value: {entryFile: graph.entryFile, source: graph.source, directDependents: paths(graph.directDependents)}});
  }
  return {windows, facts};
}

export function streamSourceReviewedUnderstand(options: Omit<Parameters<typeof streamSourceReviewedEvidence>[0], "windows" | "facts"> & {
  summary?: RepoSummaryEvidence;
}): ReturnType<typeof streamSourceReviewedEvidence> {
  return streamSourceReviewedEvidence({...options,
    ...snapshotUnderstandClaimEvidence(options.summary, options.request.context)});
}
