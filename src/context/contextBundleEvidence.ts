import type { IntegrationChatProvider } from "../chat/types";
import { filterRepoSummaryInfraWarnings } from "../prompts/repoSummarySourceLabels";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport } from "../types/ownership";

export type RepoSummaryEvidence = {
  repository?: Record<string, unknown>;
  manifest?: { fileCount?: number; languages?: string[]; entryPoints?: string[] };
  entryFiles?: Array<{ path: string; content?: string; truncated?: boolean }>;
  recentCommits?: Array<{ sha: string; author: string; message: string }>;
  treeOverview?: unknown;
  confluence?: ConfluenceSearchEvidence;
  jira?: JiraSearchEvidence;
  slack?: SlackSearchEvidence;
  teams?: TeamsSearchEvidence;
  notion?: NotionSearchEvidence;
  googleDocs?: GoogleDocsSearchEvidence;
  ownershipReport?: OwnershipReport;
  relatedOwnership?: { owner?: string; path?: string; completeness?: string };
  dependencyGraph?: {
    entryFile?: string;
    directDependents?: string[];
    edgeCount?: number;
    indexedFileCount?: number;
    source?: string;
  };
  source?: string;
  warnings?: string[];
};

export type BlastRadiusEvidence = {
  file?: string;
  directDependents?: string[];
  transitiveDependents?: string[];
  dependentDetails?: Array<{ path: string; depth: number; source: string }>;
  docsReferences?: Array<{ path: string; depth: number; source: string }>;
  openPullRequests?: Array<{
    number: number;
    title: string;
    state: string;
    merged: boolean;
    author?: string;
    updatedAt: string;
    htmlUrl?: string;
  }>;
  recentChanges?: Array<{
    number: number;
    title: string;
    state: string;
    author?: string;
    updatedAt: string;
    htmlUrl?: string;
    kind: "pull_request" | "commit";
  }>;
  testFiles?: Array<{ path: string; source: string }>;
  publicExports?: Array<{ symbol: string; kind: string; line: number }>;
  ciWorkflows?: Array<{ path: string; matchedPath: string }>;
  crossRepoConsumers?: Array<{ repoId: string; path: string; source: string }>;
  jiraSearch?: JiraSearchEvidence;
  confluenceSearch?: ConfluenceSearchEvidence;
  notionSearch?: NotionSearchEvidence;
  googleDocsSearch?: GoogleDocsSearchEvidence;
  teamsSearch?: TeamsSearchEvidence;
  ownersByFile?: Array<{ file: string; owner: string; source: string }>;
  slackSearch?: SlackSearchEvidence;
  graphMeta?: {
    edgeCount?: number;
    lastIndexedAt?: string;
    source?: string;
    lightningEnabled?: boolean;
  };
  dependencyGraph?: Record<string, unknown>;
  includeTransitive?: boolean;
  localFiles?: { files?: Array<{ path: string }> };
  completeness?: "full" | "partial" | "minimal";
  warnings?: string[];
};

export type KnowledgeGapsEvidence = {
  file?: string;
  jobScan?: {
    foundGaps?: number;
    highPriority?: number;
    mediumPriority?: number;
    lowPriority?: number;
    gaps?: Array<Record<string, unknown>>;
  };
  documentationCoverage?: Record<string, unknown> | null;
  fileStructure?: Record<string, unknown>;
  ownershipReport?: OwnershipReport;
  dependencyGraph?: {
    directDependents?: string[];
    edgeCount?: number;
    source?: string;
  };
  warnings?: string[];
};

export type JiraSearchEvidence = {
  issues: Array<{ key: string; summary: string; status: string; htmlUrl?: string }>;
  error?: string;
  matchStrategy?: string;
};

export type SlackSearchEvidence = {
  messages: Array<{ channelName?: string; userName?: string; text: string; permalink?: string }>;
  error?: string;
  query?: string;
};

export type ConfluenceSearchEvidence = {
  pages: Array<{ id: string; title: string; excerpt?: string; htmlUrl: string }>;
  error?: string;
};

export type TeamsSearchEvidence = {
  messages: Array<{ text: string; fromUserName?: string }>;
  error?: string;
};

export type NotionSearchEvidence = {
  pages: Array<{ id: string; title: string; url?: string }>;
  error?: string;
};

export type GoogleDocsSearchEvidence = {
  documents: Array<{ id: string; title: string; url?: string }>;
  error?: string;
};

import {
  codePathsFromDependentDetails,
  filterJobDependentsForFile,
  splitBlastRadiusDependents,
  asGraphEdgeSource,
  type BlastRadiusDependentDetail
} from "../engines/blastRadiusDependentsFallback";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function mergeFromBundle<T>(bundle: unknown[], pick: (data: Record<string, unknown>) => T | undefined): T | undefined {
  for (const entry of bundle) {
    const data = asRecord(asRecord(entry).data);
    const picked = pick(data);
    if (picked) {
      return picked;
    }
  }
  return undefined;
}

export function decisionTimelineFromBundle(bundle: unknown[]): DecisionTimeline | undefined {
  for (const entry of bundle) {
    const data = asRecord(asRecord(entry).data);
    if (asRecord(entry).type === "decision_history" && data.timeline) {
      return data.timeline as DecisionTimeline;
    }
  }
  return undefined;
}

export function ownershipReportFromBundle(bundle: unknown[]): OwnershipReport | undefined {
  for (const entry of bundle) {
    const data = asRecord(asRecord(entry).data);
    if (data.report) {
      return data.report as OwnershipReport;
    }
  }
  return undefined;
}

export function repoSummaryFromBundle(bundle: unknown[]): RepoSummaryEvidence | undefined {
  const merged: RepoSummaryEvidence = {};
  for (const entry of bundle) {
    const data = asRecord(asRecord(entry).data);
    const type = asRecord(entry).type;
    if (data.repository) merged.repository = data.repository as Record<string, unknown>;
    if (data.manifest) merged.manifest = data.manifest as RepoSummaryEvidence["manifest"];
    if (Array.isArray(data.entryFiles)) merged.entryFiles = data.entryFiles as RepoSummaryEvidence["entryFiles"];
    if (data.treeOverview) merged.treeOverview = data.treeOverview;
    if (data.source) merged.source = String(data.source);
    if (Array.isArray(data.warnings)) merged.warnings = data.warnings as string[];
    if (data.confluenceSearch) {
      merged.confluence = {
        pages: (asRecord(data.confluenceSearch).pages as ConfluenceSearchEvidence["pages"]) ?? [],
        error: asRecord(data.confluenceSearch).error as string | undefined
      };
    }
    if (data.jiraSearch) {
      merged.jira = {
        issues: (asRecord(data.jiraSearch).issues as JiraSearchEvidence["issues"]) ?? [],
        error: asRecord(data.jiraSearch).error as string | undefined,
        matchStrategy: asRecord(data.jiraSearch).matchStrategy as string | undefined
      };
    }
    if (data.slackSearch) {
      merged.slack = {
        messages: (asRecord(data.slackSearch).messages as SlackSearchEvidence["messages"]) ?? [],
        error: asRecord(data.slackSearch).error as string | undefined,
        query: asRecord(data.slackSearch).query as string | undefined
      };
    }
    if (data.teamsSearch) {
      merged.teams = {
        messages: (asRecord(data.teamsSearch).messages as TeamsSearchEvidence["messages"]) ?? [],
        error: asRecord(data.teamsSearch).error as string | undefined
      };
    }
    if (data.notionSearch) {
      merged.notion = {
        pages: (asRecord(data.notionSearch).pages as NotionSearchEvidence["pages"]) ?? [],
        error: asRecord(data.notionSearch).error as string | undefined
      };
    }
    if (data.googleDocsSearch) {
      merged.googleDocs = {
        documents: (asRecord(data.googleDocsSearch).documents as GoogleDocsSearchEvidence["documents"]) ?? [],
        error: asRecord(data.googleDocsSearch).error as string | undefined
      };
    }
    if (type === "ownership" && data.report) {
      const report = data.report as OwnershipReport;
      merged.ownershipReport = report;
      const primary = report.scores.find((score) => score.tier === "primary");
      const fallback = report.scores[0];
      merged.relatedOwnership = {
        owner: primary?.owner ?? fallback?.owner,
        path: report.path,
        completeness: report.completeness
      };
    }
    if (type === "dependencies") {
      const directDependents = Array.isArray(data.directDependents) ? (data.directDependents as string[]) : [];
      const graphMeta = data.graphMeta as RepoSummaryEvidence["dependencyGraph"] | undefined;
      merged.dependencyGraph = {
        entryFile: data.file ? String(data.file) : merged.dependencyGraph?.entryFile,
        directDependents,
        edgeCount: graphMeta?.edgeCount ?? merged.dependencyGraph?.edgeCount,
        source: graphMeta?.source ?? merged.dependencyGraph?.source
      };
    }
  }
  if (merged.dependencyGraph && merged.manifest?.fileCount !== undefined) {
    merged.dependencyGraph.indexedFileCount = merged.manifest.fileCount;
  }
  const confluence = confluenceSearchFromBundle(bundle);
  if (confluence && !merged.confluence) merged.confluence = confluence;
  const jira = jiraSearchFromBundle(bundle);
  if (jira && !merged.jira) merged.jira = jira;
  const slack = slackSearchFromBundle(bundle);
  if (slack && !merged.slack) merged.slack = slack;
  const teams = teamsSearchFromBundle(bundle);
  if (teams && !merged.teams) merged.teams = teams;
  const notion = notionSearchFromBundle(bundle);
  if (notion && !merged.notion) merged.notion = notion;
  const googleDocs = googleDocsSearchFromBundle(bundle);
  if (googleDocs && !merged.googleDocs) merged.googleDocs = googleDocs;
  if (merged.warnings?.length) {
    merged.warnings = filterRepoSummaryInfraWarnings(merged.warnings);
    if (merged.warnings.length === 0) {
      delete merged.warnings;
    }
  }
  return merged.entryFiles?.length ||
    merged.manifest ||
    merged.repository ||
    merged.confluence ||
    merged.jira ||
    merged.slack ||
    merged.teams ||
    merged.notion ||
    merged.googleDocs
    ? merged
    : undefined;
}

export function blastRadiusFromBundle(bundle: unknown[]): BlastRadiusEvidence | undefined {
  const merged: BlastRadiusEvidence = {};
  for (const entry of bundle) {
    const data = asRecord(asRecord(entry).data);
    const type = asRecord(entry).type;
    if (type === "dependencies" || data.report || data.directDependents) {
      if (data.file) merged.file = String(data.file);
      if (Array.isArray(data.directDependents)) merged.directDependents = data.directDependents as string[];
      if (Array.isArray(data.transitiveDependents)) {
        merged.transitiveDependents = data.transitiveDependents as string[];
      }
      if (Array.isArray(data.dependentDetails)) {
        merged.dependentDetails = data.dependentDetails as BlastRadiusEvidence["dependentDetails"];
      }
      if (Array.isArray(data.docsReferences)) {
        merged.docsReferences = data.docsReferences as BlastRadiusEvidence["docsReferences"];
      }
      if (Array.isArray(data.openPullRequests)) {
        merged.openPullRequests = data.openPullRequests as BlastRadiusEvidence["openPullRequests"];
      }
      if (Array.isArray(data.recentChanges)) {
        merged.recentChanges = data.recentChanges as BlastRadiusEvidence["recentChanges"];
      }
      if (Array.isArray(data.testFiles)) {
        merged.testFiles = data.testFiles as BlastRadiusEvidence["testFiles"];
      }
      if (Array.isArray(data.publicExports)) {
        merged.publicExports = data.publicExports as BlastRadiusEvidence["publicExports"];
      }
      if (Array.isArray(data.ciWorkflows)) {
        merged.ciWorkflows = data.ciWorkflows as BlastRadiusEvidence["ciWorkflows"];
      }
      if (Array.isArray(data.crossRepoConsumers)) {
        merged.crossRepoConsumers = data.crossRepoConsumers as BlastRadiusEvidence["crossRepoConsumers"];
      }
      if (Array.isArray(data.ownersByFile)) {
        merged.ownersByFile = data.ownersByFile as BlastRadiusEvidence["ownersByFile"];
      }
      if (data.slackSearch) merged.slackSearch = data.slackSearch as SlackSearchEvidence;
      if (data.jiraSearch) merged.jiraSearch = data.jiraSearch as JiraSearchEvidence;
      if (data.confluenceSearch) {
        merged.confluenceSearch = data.confluenceSearch as ConfluenceSearchEvidence;
      }
      if (data.notionSearch) merged.notionSearch = data.notionSearch as NotionSearchEvidence;
      if (data.googleDocsSearch) {
        merged.googleDocsSearch = data.googleDocsSearch as GoogleDocsSearchEvidence;
      }
      if (data.teamsSearch) merged.teamsSearch = data.teamsSearch as TeamsSearchEvidence;
      if (data.graphMeta) merged.graphMeta = data.graphMeta as BlastRadiusEvidence["graphMeta"];
      if (data.dependencyGraph) merged.dependencyGraph = data.dependencyGraph as Record<string, unknown>;
      if (data.includeTransitive !== undefined) merged.includeTransitive = Boolean(data.includeTransitive);
      if (data.localFiles) merged.localFiles = data.localFiles as BlastRadiusEvidence["localFiles"];
      if (data.completeness) merged.completeness = data.completeness as BlastRadiusEvidence["completeness"];
      if (Array.isArray(data.warnings)) merged.warnings = data.warnings as string[];
    }
    if (data.jiraSearch && !merged.jiraSearch) {
      merged.jiraSearch = data.jiraSearch as JiraSearchEvidence;
    }
    if (data.confluenceSearch && !merged.confluenceSearch) {
      merged.confluenceSearch = data.confluenceSearch as ConfluenceSearchEvidence;
    }
    if (data.slackSearch && !merged.slackSearch) {
      merged.slackSearch = data.slackSearch as SlackSearchEvidence;
    }
    if (data.notionSearch && !merged.notionSearch) {
      merged.notionSearch = data.notionSearch as NotionSearchEvidence;
    }
    if (data.googleDocsSearch && !merged.googleDocsSearch) {
      merged.googleDocsSearch = data.googleDocsSearch as GoogleDocsSearchEvidence;
    }
    if (data.teamsSearch && !merged.teamsSearch) {
      merged.teamsSearch = data.teamsSearch as TeamsSearchEvidence;
    }
    const lightning = asRecord(data.lightning);
    if (Array.isArray(lightning.dependents) && !merged.directDependents?.length) {
      merged.directDependents = lightning.dependents as string[];
      merged.graphMeta = {
        ...merged.graphMeta,
        source: String(lightning.dependentsSource ?? "lightning")
      };
    }
    const jobScan = asRecord(data.jobScan);
    if (jobScan.source === "dependency-graph-job" && Array.isArray(jobScan.dependentsSample)) {
      const targetFile = merged.file ?? (data.file ? String(data.file) : "");
      const filtered = filterJobDependentsForFile(
        jobScan.dependentsSample as Array<{ from?: string; to?: string }>,
        targetFile
      );
      const sample =
        filtered.length > 0
          ? filtered
          : (jobScan.dependentsSample as Array<{ from?: string; to?: string }>)
              .map((edge) => edge.from)
              .filter(Boolean) as string[];
      if (sample.length > 0 && !merged.directDependents?.length) {
        merged.directDependents = sample;
        merged.graphMeta = {
          ...merged.graphMeta,
          source: filtered.length > 0 ? "scip" : merged.graphMeta?.source ?? "remote"
        };
      }
      merged.graphMeta = {
        ...merged.graphMeta,
        edgeCount: Number(jobScan.edgeCount ?? 0),
        lastIndexedAt: String(jobScan.lastIndexedAt ?? "")
      };
    }
  }
  const jira = jiraSearchFromBundle(bundle);
  if (jira && !merged.jiraSearch) {
    merged.jiraSearch = jira;
  }
  const confluence = confluenceSearchFromBundle(bundle);
  if (confluence && !merged.confluenceSearch) {
    merged.confluenceSearch = confluence;
  }
  const notion = notionSearchFromBundle(bundle);
  if (notion && !merged.notionSearch) {
    merged.notionSearch = notion;
  }
  const googleDocs = googleDocsSearchFromBundle(bundle);
  if (googleDocs && !merged.googleDocsSearch) {
    merged.googleDocsSearch = googleDocs;
  }
  const teams = teamsSearchFromBundle(bundle);
  if (teams && !merged.teamsSearch) {
    merged.teamsSearch = teams;
  }
  const slack = slackSearchFromBundle(bundle);
  if (slack && !merged.slackSearch) {
    merged.slackSearch = slack;
  }
  finalizeBlastRadiusDependents(merged);
  const hasSignals =
    merged.file ||
    merged.directDependents?.length ||
    merged.transitiveDependents?.length ||
    merged.dependentDetails?.length ||
    merged.docsReferences?.length ||
    merged.openPullRequests?.length ||
    merged.recentChanges?.length ||
    merged.testFiles?.length ||
    merged.publicExports?.length ||
    merged.ciWorkflows?.length ||
    merged.crossRepoConsumers?.length ||
    merged.jiraSearch ||
    merged.confluenceSearch ||
    merged.notionSearch ||
    merged.googleDocsSearch ||
    merged.teamsSearch ||
    merged.ownersByFile?.length ||
    merged.slackSearch ||
    merged.localFiles?.files?.length ||
    merged.graphMeta ||
    merged.warnings?.length;
  return hasSignals ? merged : undefined;
}

function finalizeBlastRadiusDependents(merged: BlastRadiusEvidence): void {
  const source = asGraphEdgeSource(merged.graphMeta?.source);
  let details: BlastRadiusDependentDetail[] | undefined = merged.dependentDetails?.map((entry) => ({
    path: entry.path,
    depth: entry.depth,
    source: asGraphEdgeSource(entry.source)
  }));
  if (!details?.length && (merged.directDependents?.length || merged.transitiveDependents?.length)) {
    details = [
      ...(merged.directDependents ?? []).map((path) => ({ path, depth: 1, source })),
      ...(merged.transitiveDependents ?? []).map((path) => ({ path, depth: 2, source }))
    ];
  }
  if (!details?.length) {
    merged.docsReferences = merged.docsReferences ?? [];
    return;
  }
  if (merged.docsReferences?.length) {
    const seen = new Set(details.map((entry) => entry.path));
    for (const entry of merged.docsReferences) {
      if (!seen.has(entry.path)) {
        details.push({
          path: entry.path,
          depth: entry.depth,
          source: asGraphEdgeSource(entry.source)
        });
      }
    }
  }

  const split = splitBlastRadiusDependents(details);
  const codePaths = codePathsFromDependentDetails(split.codeDependentDetails);
  merged.directDependents = codePaths.directDependents;
  merged.transitiveDependents = codePaths.transitiveDependents;
  merged.dependentDetails = split.codeDependentDetails;
  merged.docsReferences = split.docsReferences;
}

export function knowledgeGapsFromBundle(bundle: unknown[]): KnowledgeGapsEvidence | undefined {
  const merged: KnowledgeGapsEvidence = {};
  for (const entry of bundle) {
    const record = asRecord(entry);
    const data = asRecord(record.data);
    const type = record.type;
    if (type === "knowledge_gaps" || data.jobScan || data.documentationCoverage !== undefined || data.fileStructure) {
      if (data.file) merged.file = String(data.file);
      if (data.jobScan) {
        merged.jobScan = data.jobScan as KnowledgeGapsEvidence["jobScan"];
        const scanWarning = asRecord(data.jobScan).warning;
        if (typeof scanWarning === "string" && scanWarning.trim()) {
          merged.warnings = [...(merged.warnings ?? []), scanWarning.trim()];
        }
      }
      if (data.documentationCoverage !== undefined) {
        merged.documentationCoverage = data.documentationCoverage as Record<string, unknown> | null;
      }
      if (data.fileStructure) merged.fileStructure = data.fileStructure as Record<string, unknown>;
    }
    if (type === "ownership" && data.report) {
      merged.ownershipReport = data.report as OwnershipReport;
      if (!merged.file) {
        const path = merged.ownershipReport.path;
        if (path) merged.file = path;
      }
    }
    if (type === "dependencies") {
      const graph: NonNullable<KnowledgeGapsEvidence["dependencyGraph"]> = {
        ...merged.dependencyGraph
      };
      if (Array.isArray(data.directDependents)) {
        graph.directDependents = data.directDependents as string[];
      }
      const graphMeta = asRecord(data.graphMeta);
      if (graphMeta.edgeCount !== undefined) {
        graph.edgeCount = Number(graphMeta.edgeCount);
      }
      if (graphMeta.source) {
        graph.source = String(graphMeta.source);
      }
      merged.dependencyGraph = graph;
    }
    if (Array.isArray(data.warnings)) {
      merged.warnings = [...(merged.warnings ?? []), ...(data.warnings as string[])];
    }
  }
  const hasSignals =
    merged.file ||
    merged.jobScan ||
    merged.documentationCoverage !== undefined ||
    merged.fileStructure ||
    merged.ownershipReport ||
    merged.dependencyGraph !== undefined ||
    merged.warnings?.length;
  return hasSignals ? merged : undefined;
}

export function jiraSearchFromBundle(bundle: unknown[]): JiraSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.jiraSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      issues: (search.issues as JiraSearchEvidence["issues"]) ?? [],
      error: search.error as string | undefined,
      matchStrategy: search.matchStrategy as string | undefined
    };
  });
}

export function slackSearchFromBundle(bundle: unknown[]): SlackSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.slackSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      messages: (search.messages as SlackSearchEvidence["messages"]) ?? [],
      error: search.error as string | undefined,
      query: search.query as string | undefined
    };
  });
}

export function confluenceSearchFromBundle(bundle: unknown[]): ConfluenceSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.confluenceSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      pages: (search.pages as ConfluenceSearchEvidence["pages"]) ?? [],
      error: search.error as string | undefined
    };
  });
}

export function teamsSearchFromBundle(bundle: unknown[]): TeamsSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.teamsSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      messages: (search.messages as TeamsSearchEvidence["messages"]) ?? [],
      error: search.error as string | undefined
    };
  });
}

export function notionSearchFromBundle(bundle: unknown[]): NotionSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.notionSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      pages: (search.pages as NotionSearchEvidence["pages"]) ?? [],
      error: search.error as string | undefined
    };
  });
}

export function googleDocsSearchFromBundle(bundle: unknown[]): GoogleDocsSearchEvidence | undefined {
  return mergeFromBundle(bundle, (data) => {
    const search = data.googleDocsSearch as Record<string, unknown> | undefined;
    if (!search) return undefined;
    return {
      documents: (search.documents as GoogleDocsSearchEvidence["documents"]) ?? [],
      error: search.error as string | undefined
    };
  });
}

export function integrationSearchFromBundle(
  bundle: unknown[],
  provider: IntegrationChatProvider
): Record<string, unknown> | undefined {
  switch (provider) {
    case "jira":
      return jiraSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    case "slack":
      return slackSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    case "teams":
      return teamsSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    case "confluence":
      return confluenceSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    case "notion":
      return notionSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    case "google-docs":
      return googleDocsSearchFromBundle(bundle) as Record<string, unknown> | undefined;
    default:
      return undefined;
  }
}
