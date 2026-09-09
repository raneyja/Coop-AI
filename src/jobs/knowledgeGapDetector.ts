import type { DependencyEdge, FileNode, OwnershipEntry, RepositoryGraph } from "../cache/graphCache";
import { isKnowledgeGapHighValuePath, knowledgeGapAreaPriority } from "./knowledgeGapPathRank";
import type { KnowledgeGapScanCoverage } from "../context/knowledgeGapScanCoverage";

const MAX_GAPS = 80;
const MAX_OWNER_GAPS = 8;
const MAX_ORPHAN_AREAS = 8;
const MAX_MISSING_DOCS = 8;
const MAX_STALE = 10;
const HIGH_FAN_IN = 3;
const STALE_DAYS = 365;

export type DetectedKnowledgeGap = {
  file?: string;
  type: string;
  priority: "high" | "medium" | "low";
  message: string;
};

export type KnowledgeGapDetection = {
  gaps: DetectedKnowledgeGap[];
  scanCoverage: KnowledgeGapScanCoverage;
  scannedFileCount: number;
};

function daysSince(value: Date | string | undefined): number {
  if (!value) {
    return 0;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function isHighValueSourcePath(path: string): boolean {
  return isKnowledgeGapHighValuePath(path);
}

function isDocPath(path: string): boolean {
  const n = path.replace(/\\/g, "/").toLowerCase();
  return n.endsWith(".md") || n.includes("/docs/") || /(^|\/)docs\//.test(n);
}

function areaKey(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? path;
}

function dirnameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "" : normalized.slice(0, idx);
}

function hasNearbyDocs(filePath: string, docPaths: string[]): boolean {
  const dir = dirnameOf(filePath);
  const area = areaKey(filePath);
  return docPaths.some((doc) => {
    const docDir = dirnameOf(doc);
    const sameDirReadme =
      Boolean(dir) && docDir === dir && /(^|\/)readme\.md$/i.test(doc);
    return (
      sameDirReadme ||
      Boolean(dir && isDocPath(doc) && doc.startsWith(`${dir}/`)) ||
      doc.toLowerCase().startsWith(`docs/${area.toLowerCase()}`)
    );
  });
}

function inboundCounts(edges: DependencyEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return counts;
}

/**
 * Evidence-backed absences — not “every markdown file is a gap.”
 * Empty / missing graphs are `scan_incomplete`, never a healthy zero.
 */
export function detectRepoKnowledgeGaps(
  graph: Pick<RepositoryGraph, "fileTree" | "dependencies" | "owners"> | undefined,
  params?: { file?: string }
): KnowledgeGapDetection {
  if (!graph || graph.fileTree.length === 0) {
    return { gaps: [], scanCoverage: "scan_incomplete", scannedFileCount: 0 };
  }

  const focusFile = params?.file?.trim();
  const files = focusFile ? graph.fileTree.filter((file) => file.path === focusFile) : graph.fileTree;
  if (focusFile && files.length === 0) {
    return { gaps: [], scanCoverage: "scan_incomplete", scannedFileCount: 0 };
  }

  const ownersByFile = new Map(graph.owners.map((owner) => [owner.file, owner]));
  const inbound = inboundCounts(graph.dependencies);
  const docPaths = graph.fileTree.map((file) => file.path).filter(isDocPath);
  const gaps: DetectedKnowledgeGap[] = [];

  pushOwnerGaps(files, ownersByFile, inbound, gaps);
  pushMissingDocsGaps(files, inbound, docPaths, graph.dependencies.length > 0, gaps);
  if (graph.dependencies.length > 0) {
    pushOrphanAreaGaps(files, inbound, graph.fileTree.length, gaps);
  }
  pushStaleHighValueGaps(files, gaps);

  const sliced = gaps.slice(0, MAX_GAPS);
  const coverage: KnowledgeGapScanCoverage =
    sliced.length > 0
      ? "gaps_found"
      : graph.dependencies.length === 0
        ? "scan_incomplete"
        : "no_structured_gaps";
  return {
    gaps: sliced,
    scanCoverage: coverage,
    scannedFileCount: files.length
  };
}

function rankHighValueFiles(
  files: FileNode[],
  inbound: Map<string, number>
): FileNode[] {
  return files
    .filter((file) => isHighValueSourcePath(file.path))
    .map((file) => ({
      file,
      fanIn: inbound.get(file.path) ?? 0,
      areaScore: knowledgeGapAreaPriority(file.path)
    }))
    .sort((a, b) => b.fanIn - a.fanIn || b.areaScore - a.areaScore)
    .map((entry) => entry.file);
}

function pushOwnerGaps(
  files: FileNode[],
  ownersByFile: Map<string, OwnershipEntry>,
  inbound: Map<string, number>,
  gaps: DetectedKnowledgeGap[]
): void {
  const seenAreas = new Set<string>();
  for (const file of rankHighValueFiles(files, inbound)) {
    if (gaps.filter((gap) => gap.type === "missing_owner").length >= MAX_OWNER_GAPS) {
      break;
    }
    const owner = ownersByFile.get(file.path);
    if (owner && owner.primaryOwner && owner.primaryOwner !== "unknown") {
      continue;
    }
    const area = areaKey(file.path);
    if (seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    gaps.push({
      file: file.path,
      type: "missing_owner",
      priority: "high",
      message: `No clear code owner for ${area}`
    });
  }
}

function pushMissingDocsGaps(
  files: FileNode[],
  inbound: Map<string, number>,
  docPaths: string[],
  hasDependencyEdges: boolean,
  gaps: DetectedKnowledgeGap[]
): void {
  const ranked = rankHighValueFiles(files, inbound).map((file) => ({
    file,
    fanIn: inbound.get(file.path) ?? 0
  }));
  const pool = hasDependencyEdges
    ? ranked.filter((entry) => entry.fanIn >= HIGH_FAN_IN)
    : ranked;

  const seenAreas = new Set<string>();
  for (const { file, fanIn } of pool) {
    if (gaps.filter((gap) => gap.type === "missing_docs").length >= MAX_MISSING_DOCS) {
      break;
    }
    if (hasNearbyDocs(file.path, docPaths)) {
      continue;
    }
    const area = areaKey(file.path);
    if (seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    gaps.push({
      file: file.path,
      type: "missing_docs",
      priority: "medium",
      message: hasDependencyEdges
        ? `Heavily used code in ${area} has no nearby docs`
        : `No nearby docs under ${area}`
    });
  }
}

function pushOrphanAreaGaps(
  files: FileNode[],
  inbound: Map<string, number>,
  treeSize: number,
  gaps: DetectedKnowledgeGap[]
): void {
  if (treeSize <= 20) {
    return;
  }
  const seenAreas = new Set<string>();
  for (const file of files) {
    if (gaps.filter((gap) => gap.type === "orphaned_file").length >= MAX_ORPHAN_AREAS) {
      break;
    }
    if (!isHighValueSourcePath(file.path)) {
      continue;
    }
    if ((inbound.get(file.path) ?? 0) > 0) {
      continue;
    }
    const area = areaKey(file.path);
    if (seenAreas.has(area)) {
      continue;
    }
    seenAreas.add(area);
    gaps.push({
      file: file.path,
      type: "orphaned_file",
      priority: "medium",
      message: `No inbound dependencies detected under ${area}`
    });
  }
}

function pushStaleHighValueGaps(files: FileNode[], gaps: DetectedKnowledgeGap[]): void {
  let staleCount = 0;
  for (const file of files) {
    if (staleCount >= MAX_STALE) {
      break;
    }
    if (!isHighValueSourcePath(file.path)) {
      continue;
    }
    const staleDays = daysSince(file.lastModified);
    if (staleDays <= STALE_DAYS) {
      continue;
    }
    staleCount += 1;
    gaps.push({
      file: file.path,
      type: "stale_file",
      priority: "low",
      message: `Not modified in ${staleDays} days`
    });
  }
}
