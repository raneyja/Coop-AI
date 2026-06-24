import React, { useMemo, useState } from "react";
import type { IntegrationChatProvider } from "../chat/types";
import type {
  BlastRadiusEvidence,
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  RepoSummaryEvidence,
  SlackSearchEvidence,
  TeamsSearchEvidence
} from "../context/contextBundleEvidence";
import {
  blastRadiusSourceLabelCodeowners,
  blastRadiusSourceLabelConfluence,
  blastRadiusSourceLabelDependencies,
  blastRadiusSourceLabelDocsReferences,
  blastRadiusSourceLabelJira,
  blastRadiusSourceLabelLocalFiles,
  blastRadiusSourceLabelOpenPrs,
  blastRadiusSourceLabelPublicApi,
  blastRadiusSourceLabelRecentChanges,
  blastRadiusSourceLabelSlack,
  blastRadiusSourceLabelNotion,
  blastRadiusSourceLabelGoogleDocs,
  blastRadiusSourceLabelTeams,
  blastRadiusSourceLabelTests
} from "../prompts/blastRadiusSourceLabels";
import { integrationSourceLabel } from "../prompts/integrationSourceLabels";
import {
  knowledgeGapsSourceLabelConfluence,
  knowledgeGapsSourceLabelDependencies,
  knowledgeGapsSourceLabelGoogleDocs,
  knowledgeGapsSourceLabelJira,
  knowledgeGapsSourceLabelNotion,
  knowledgeGapsSourceLabelOwnership,
  knowledgeGapsSourceLabelScan,
  knowledgeGapsSourceLabelSlack,
  knowledgeGapsSourceLabelTeams
} from "../prompts/knowledgeGapsSourceLabels";
import { groupDependentsByTopLevelFolder, asGraphEdgeSource } from "../engines/blastRadiusDependentsFallback";
import {
  filterRepoSummaryInfraWarnings,
  repoSummarySourceLabelConfluence,
  repoSummarySourceLabelEntryFiles,
  repoSummarySourceLabelGoogleDocs,
  repoSummarySourceLabelJira,
  repoSummarySourceLabelManifest,
  repoSummarySourceLabelNotion,
  repoSummarySourceLabelOwnership,
  repoSummarySourceLabelSlack,
  repoSummarySourceLabelTeams
} from "../prompts/repoSummarySourceLabels";
import { ownershipTierLabel } from "../prompts/ownershipSourceLabels";
import { evidenceSectionDomId, EvidenceCardShell, type EvidenceCardSource } from "./EvidenceCardShell";
import {
  EvidenceConnectionGroup,
  EvidenceConnectionStack,
  EvidenceDerivedGroup,
  type EvidenceConnectionKey
} from "./EvidenceConnectionGroups";
import {
  summarizeBlastRadius,
  summarizeIntegrationSearch,
  summarizeKnowledgeGaps,
  summarizeRepoSummary,
  filterDetailWarnings
} from "./evidenceCardSummary";
import type { EvidenceActionContext } from "./evidenceCardActionHandler";
import {
  IntegrationResultCollapsible,
  IntegrationResultText
} from "./components/IntegrationResultCard";
import type { ConflictSummary } from "./types";
import {
  IntegrationSourceChip,
  type IntegrationSourceId
} from "./components/IntegrationSourceBrand";
import { isIntegrationConnectedForSources, type IntegrationSearchEvidenceLike } from "./integrationEvidenceVisibility";

export function RepoSummaryEvidenceCard({
  evidence,
  owner,
  repo,
  branch,
  artifactId,
  conflicts,
  actionContext
}: {
  evidence: RepoSummaryEvidence;
  owner: string;
  repo: string;
  branch?: string;
  artifactId: string;
  conflicts?: ConflictSummary[];
  actionContext: EvidenceActionContext;
}): React.ReactElement {
  const [expanded, setExpanded] = useState({
    manifest: true,
    entry: true,
    confluence: true,
    jira: true,
    slack: true,
    teams: true,
    notion: true,
    googleDocs: true,
    ownership: true
  });
  const meta = [`${owner}/${repo}`, branch].filter(Boolean).join(" · ");
  const entryCount = evidence.entryFiles?.length ?? 0;
  const confluenceCount = evidence.confluence?.pages?.length ?? 0;
  const jiraCount = evidence.jira?.issues?.length ?? 0;
  const slackCount = evidence.slack?.messages?.length ?? 0;
  const teamsCount = evidence.teams?.messages?.length ?? 0;
  const notionCount = evidence.notion?.pages?.length ?? 0;
  const googleDocsCount = evidence.googleDocs?.documents?.length ?? 0;

  const summary = useMemo(
    () => summarizeRepoSummary(evidence, owner, repo),
    [evidence, owner, repo]
  );

  const userWarnings = useMemo(() => {
    const filtered = filterRepoSummaryInfraWarnings(evidence.warnings);
    return filterWarningsNotInLimitations(filtered, summary.limitations);
  }, [evidence.warnings, summary.limitations]);

  const sources = useMemo(() => {
    const list: EvidenceCardSource[] = [
      { provider: "github", detail: `${entryCount} anchor file${entryCount === 1 ? "" : "s"}` }
    ];
    if (isIntegrationConnectedForSources(evidence.confluence)) list.push({ provider: "confluence", detail: `${confluenceCount} page(s)` });
    if (isIntegrationConnectedForSources(evidence.jira)) list.push({ provider: "jira", detail: `${jiraCount} issue(s)` });
    if (isIntegrationConnectedForSources(evidence.slack)) list.push({ provider: "slack", detail: `${slackCount} message(s)` });
    if (isIntegrationConnectedForSources(evidence.teams)) list.push({ provider: "teams", detail: `${teamsCount} message(s)` });
    if (isIntegrationConnectedForSources(evidence.notion)) list.push({ provider: "notion", detail: `${notionCount} page(s)` });
    if (isIntegrationConnectedForSources(evidence.googleDocs)) list.push({ provider: "google-docs", detail: `${googleDocsCount} doc(s)` });
    return list;
  }, [entryCount, evidence.confluence, evidence.jira, evidence.slack, evidence.teams, evidence.notion, evidence.googleDocs, confluenceCount, jiraCount, slackCount, teamsCount, notionCount, googleDocsCount]);

  const ownershipScores = evidence.ownershipReport?.scores ?? [];
  const ownershipPrimary = ownershipScores.find((score) => score.tier === "primary");
  const ownershipSecondary = ownershipScores.filter((score) => score.tier !== "primary");
  const ownershipPath = evidence.ownershipReport?.path ?? evidence.relatedOwnership?.path;
  const dependencyLine = formatRepoDependencyGraph(evidence.dependencyGraph);

  return (
    <EvidenceCardShell
      artifactId={artifactId}
      title="Repository overview"
      meta={meta}
      sources={sources}
      summary={summary}
      actionContext={actionContext}
      conflicts={conflicts}
    >
      <EvidenceConnectionStack>
        <EvidenceConnectionGroup
          connection="github"
          briefSummary={
            entryCount > 0
              ? {
                  title: `Anchor files (${entryCount})`,
                  sourceLabel: repoSummarySourceLabelEntryFiles()
                }
              : undefined
          }
        >
          {(evidence.manifest || evidence.repository) && (
            <IntegrationResultCollapsible
              title="Repository manifest"
              sourceLabel={repoSummarySourceLabelManifest()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelManifest())}
              open={expanded.manifest}
              onToggle={() => setExpanded((state) => ({ ...state, manifest: !state.manifest }))}
            >
              {evidence.repository ? (
                <IntegrationResultText muted>
                  {[
                    evidence.repository.description ? String(evidence.repository.description) : undefined,
                    evidence.repository.language ? `Language: ${String(evidence.repository.language)}` : undefined,
                    evidence.repository.defaultBranch
                      ? `Default branch: ${String(evidence.repository.defaultBranch)}`
                      : undefined
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </IntegrationResultText>
              ) : null}
              {evidence.manifest?.fileCount !== undefined ? (
                <IntegrationResultText muted>Indexed files: {evidence.manifest.fileCount}</IntegrationResultText>
              ) : null}
            </IntegrationResultCollapsible>
          )}

          {entryCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Anchor files (${entryCount})`}
              sourceLabel={repoSummarySourceLabelEntryFiles()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelEntryFiles())}
              open={expanded.entry}
              onToggle={() => setExpanded((state) => ({ ...state, entry: !state.entry }))}
            >
              <IntegrationResultText muted>
                Key README, package, and entry-point files we loaded to anchor the repo-wide summary (up to six).
              </IntegrationResultText>
              <ul className="mt-2 space-y-1">
                {evidence.entryFiles!.slice(0, 12).map((file) => (
                  <li key={file.path} className="coop-result-text">
                    <code>{file.path}</code>
                    {file.truncated ? " (truncated)" : ""}
                  </li>
                ))}
                {entryCount > 12 ? (
                  <IntegrationResultText muted>+ {entryCount - 12} more anchor files in bundle</IntegrationResultText>
                ) : null}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {ownershipPrimary || ownershipSecondary.length > 0 ? (
            <IntegrationResultCollapsible
              title={`File ownership — ${ownershipPath ?? "active file"}`}
              sourceLabel={repoSummarySourceLabelOwnership()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelOwnership())}
              open={expanded.ownership}
              onToggle={() => setExpanded((state) => ({ ...state, ownership: !state.ownership }))}
            >
              {ownershipPrimary ? (
                <IntegrationResultText>
                  Primary: @{ownershipPrimary.owner}
                  {ownershipPrimary.commitCount ? ` · ${ownershipPrimary.commitCount} commits (6mo)` : ""}
                </IntegrationResultText>
              ) : null}
              {ownershipSecondary.length > 0 ? (
                <IntegrationResultText muted>
                  {ownershipPrimary ? "Also" : "Contributors"}:{" "}
                  {ownershipSecondary
                    .slice(0, 4)
                    .map((score) => `@${score.owner}${score.tier === "secondary" ? " (secondary)" : ""}`)
                    .join(", ")}
                </IntegrationResultText>
              ) : null}
            </IntegrationResultCollapsible>
          ) : ownershipPath ? (
            <IntegrationResultText muted>
              No ownership scores for {ownershipPath} in this fetch — run Find Owner for commit history and CODEOWNERS.
            </IntegrationResultText>
          ) : null}

          {dependencyLine ? <IntegrationResultText muted>{dependencyLine}</IntegrationResultText> : null}

          <TreeOverviewSection treeOverview={evidence.treeOverview} />
        </EvidenceConnectionGroup>

        {isIntegrationConnectedForSources(evidence.confluence) ? (
          <EvidenceConnectionGroup connection="confluence">
            <IntegrationResultCollapsible
              title={`Architecture pages (${confluenceCount})`}
              sourceLabel={repoSummarySourceLabelConfluence()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelConfluence())}
              open={expanded.confluence}
              onToggle={() => setExpanded((state) => ({ ...state, confluence: !state.confluence }))}
            >
              {evidence.confluence.error ? (
                <IntegrationResultText muted>{evidence.confluence.error}</IntegrationResultText>
              ) : confluenceCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.confluence.pages.slice(0, 10).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Confluence pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.jira) ? (
          <EvidenceConnectionGroup connection="jira">
            <IntegrationResultCollapsible
              title={`Epics (${jiraCount})`}
              sourceLabel={repoSummarySourceLabelJira()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelJira())}
              open={expanded.jira}
              onToggle={() => setExpanded((state) => ({ ...state, jira: !state.jira }))}
            >
              {evidence.jira.error ? (
                <IntegrationResultText muted>{evidence.jira.error}</IntegrationResultText>
              ) : jiraCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.jira.issues.slice(0, 10).map((issue) => (
                    <li key={issue.key} className="coop-result-text">
                      <strong>{issue.key}</strong> ({issue.status}): {issue.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Jira issues.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.slack) ? (
          <EvidenceConnectionGroup connection="slack">
            <IntegrationResultCollapsible
              title={`Discussions (${slackCount})`}
              sourceLabel={repoSummarySourceLabelSlack()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelSlack())}
              open={expanded.slack}
              onToggle={() => setExpanded((state) => ({ ...state, slack: !state.slack }))}
            >
              {evidence.slack.error ? (
                <IntegrationResultText muted>{evidence.slack.error}</IntegrationResultText>
              ) : slackCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.slack.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.channelName ? `#${message.channelName}` : "Slack"}: {message.text.slice(0, 160)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Slack discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.teams) ? (
          <EvidenceConnectionGroup connection="teams">
            <IntegrationResultCollapsible
              title={`Discussions (${teamsCount})`}
              sourceLabel={repoSummarySourceLabelTeams()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelTeams())}
              open={expanded.teams}
              onToggle={() => setExpanded((state) => ({ ...state, teams: !state.teams }))}
            >
              {evidence.teams.error ? (
                <IntegrationResultText muted>{evidence.teams.error}</IntegrationResultText>
              ) : teamsCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.teams.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.fromUserName ?? "Teams"}: {message.text.slice(0, 160)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Teams discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.notion) ? (
          <EvidenceConnectionGroup connection="notion">
            <IntegrationResultCollapsible
              title={`Pages (${notionCount})`}
              sourceLabel={repoSummarySourceLabelNotion()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelNotion())}
              open={expanded.notion}
              onToggle={() => setExpanded((state) => ({ ...state, notion: !state.notion }))}
            >
              {evidence.notion.error ? (
                <IntegrationResultText muted>{evidence.notion.error}</IntegrationResultText>
              ) : notionCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.notion.pages.slice(0, 10).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Notion pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.googleDocs) ? (
          <EvidenceConnectionGroup connection="google-docs">
            <IntegrationResultCollapsible
              title={`Documents (${googleDocsCount})`}
              sourceLabel={repoSummarySourceLabelGoogleDocs()}
              sectionDomId={evidenceSectionDomId(artifactId, repoSummarySourceLabelGoogleDocs())}
              open={expanded.googleDocs}
              onToggle={() => setExpanded((state) => ({ ...state, googleDocs: !state.googleDocs }))}
            >
              {evidence.googleDocs.error ? (
                <IntegrationResultText muted>{evidence.googleDocs.error}</IntegrationResultText>
              ) : googleDocsCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.googleDocs.documents.slice(0, 10).map((doc) => (
                    <li key={doc.id} className="coop-result-text">
                      {doc.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Google Docs.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {userWarnings.length > 0 ? (
          <EvidenceDerivedGroup title="Warnings">
            {userWarnings.map((warning) => (
              <IntegrationResultText key={warning} muted>
                · {warning}
              </IntegrationResultText>
            ))}
          </EvidenceDerivedGroup>
        ) : null}
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

function formatRepoDependencyGraph(
  graph: RepoSummaryEvidence["dependencyGraph"] | undefined
): string | undefined {
  if (!graph) {
    return undefined;
  }

  if (graph.directDependents?.length) {
    const entryFile = graph.entryFile ?? "this file";
    return `${graph.directDependents.length} file(s) import ${entryFile}${graph.source ? ` (${graph.source})` : ""}`;
  }

  if (graph.edgeCount) {
    const entryPart = graph.entryFile ? ` for ${graph.entryFile}` : "";
    return `${graph.edgeCount} dependency edge(s) in org graph${entryPart}`;
  }

  return undefined;
}

function TreeOverviewSection({
  treeOverview
}: {
  treeOverview: RepoSummaryEvidence["treeOverview"];
}): React.ReactElement | null {
  if (!treeOverview || typeof treeOverview !== "object") {
    return null;
  }
  const tree = treeOverview as {
    topLevelDirs?: string[];
    topLevelFiles?: string[];
    srcEntries?: { topLevelDirs?: string[]; topLevelFiles?: string[] };
  };
  const dirs = tree.topLevelDirs ?? [];
  const files = tree.topLevelFiles ?? [];
  if (dirs.length === 0 && files.length === 0) {
    return null;
  }
  const [open, setOpen] = useState(false);
  return (
    <IntegrationResultCollapsible
      title="Top-level layout"
      subtitle={`${dirs.length} director${dirs.length === 1 ? "y" : "ies"} · ${files.length} file${files.length === 1 ? "" : "s"}`}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <div className="coop-tree-layout-grid">
        <div>
          <p className="coop-result-row-label">Directories</p>
          <ul className="coop-tree-layout-list">
            {dirs.length ? dirs.map((dir) => <li key={dir}><code>{dir}/</code></li>) : <li className="coop-result-text--muted">None</li>}
          </ul>
        </div>
        <div>
          <p className="coop-result-row-label">Root files</p>
          <ul className="coop-tree-layout-list">
            {files.length ? files.map((file) => <li key={file}><code>{file}</code></li>) : <li className="coop-result-text--muted">None</li>}
          </ul>
        </div>
      </div>
      {tree.srcEntries ? (
        <div className="mt-3">
          <p className="coop-result-row-label">src/</p>
          <IntegrationResultText muted>
            {(tree.srcEntries.topLevelDirs ?? []).length
              ? `Dirs: ${(tree.srcEntries.topLevelDirs ?? []).join(", ")}`
              : null}
            {(tree.srcEntries.topLevelDirs ?? []).length && (tree.srcEntries.topLevelFiles ?? []).length
              ? " · "
              : null}
            {(tree.srcEntries.topLevelFiles ?? []).length
              ? `Files: ${(tree.srcEntries.topLevelFiles ?? []).join(", ")}`
              : null}
          </IntegrationResultText>
        </div>
      ) : null}
    </IntegrationResultCollapsible>
  );
}

export function BlastRadiusEvidenceCard({
  evidence,
  file,
  artifactId,
  conflicts,
  actionContext
}: {
  evidence: BlastRadiusEvidence;
  file: string;
  artifactId: string;
  conflicts?: ConflictSummary[];
  actionContext: EvidenceActionContext;
}): React.ReactElement {
  const [expanded, setExpanded] = useState({
    graph: false,
    docs: false,
    tests: false,
    api: false,
    recent: false,
    prs: false,
    owners: false,
    slack: false,
    jira: false,
    confluence: false,
    notion: false,
    googleDocs: false,
    teams: false,
    ci: false,
    crossRepo: false,
    local: false
  });
  const directCount = evidence.directDependents?.length ?? 0;
  const transitiveCount = evidence.transitiveDependents?.length ?? 0;
  const prCount = evidence.openPullRequests?.length ?? 0;
  const slackCount = evidence.slackSearch?.messages?.length ?? 0;
  const localCount = evidence.localFiles?.files?.length ?? 0;
  const testCount = evidence.testFiles?.length ?? 0;
  const exportCount = evidence.publicExports?.length ?? 0;
  const recentCount = evidence.recentChanges?.length ?? 0;
  const jiraCount = evidence.jiraSearch?.issues?.length ?? 0;
  const confluenceCount = evidence.confluenceSearch?.pages?.length ?? 0;
  const notionCount = evidence.notionSearch?.pages?.length ?? 0;
  const googleDocsCount = evidence.googleDocsSearch?.documents?.length ?? 0;
  const teamsCount = evidence.teamsSearch?.messages?.length ?? 0;
  const ciCount = evidence.ciWorkflows?.length ?? 0;
  const crossRepoCount = evidence.crossRepoConsumers?.length ?? 0;
  const docsCount = evidence.docsReferences?.length ?? 0;
  const detailEntries = evidence.dependentDetails ?? [];

  const codeDirectDetails = useMemo(() => {
    const fromDetails = detailEntries.filter((entry) => entry.depth === 1);
    if (fromDetails.length > 0) {
      return fromDetails.map((entry) => ({
        path: entry.path,
        depth: entry.depth,
        source: asGraphEdgeSource(entry.source)
      }));
    }
    return (evidence.directDependents ?? []).map((path) => ({
      path,
      depth: 1,
      source: asGraphEdgeSource(evidence.graphMeta?.source)
    }));
  }, [detailEntries, evidence.directDependents, evidence.graphMeta?.source]);

  const codeTransitiveDetails = useMemo(() => {
    const fromDetails = detailEntries.filter((entry) => entry.depth > 1);
    if (fromDetails.length > 0) {
      return fromDetails.map((entry) => ({
        path: entry.path,
        depth: entry.depth,
        source: asGraphEdgeSource(entry.source)
      }));
    }
    return (evidence.transitiveDependents ?? []).map((path) => ({
      path,
      depth: 2,
      source: asGraphEdgeSource(evidence.graphMeta?.source)
    }));
  }, [detailEntries, evidence.transitiveDependents, evidence.graphMeta?.source]);

  const groupedCodeDirect = useMemo(
    () => groupDependentsByTopLevelFolder(codeDirectDetails),
    [codeDirectDetails]
  );

  const summary = useMemo(
    () => summarizeBlastRadius(evidence, file),
    [evidence, file]
  );
  const targetMeta = summary.target ?? file;

  const inlineWarnings = useMemo(
    () => filterWarningsNotInLimitations(evidence.warnings, summary.limitations),
    [evidence.warnings, summary.limitations]
  );

  const sources = useMemo(() => {
    const list: EvidenceCardSource[] = [];
    if (directCount || transitiveCount) {
      list.push({ provider: "github", detail: `${directCount + transitiveCount} code dependent(s)` });
    }
    if (docsCount) {
      list.push({ provider: "github", detail: `${docsCount} docs reference(s)` });
    }
    if (prCount) list.push({ provider: "github", detail: `${prCount} open PR(s)` });
    if (evidence.ownersByFile?.length) list.push({ provider: "github", detail: "CODEOWNERS" });
    if (isIntegrationConnectedForSources(evidence.slackSearch)) {
      list.push({ provider: "slack", detail: `${slackCount} message(s)` });
    }
    if (isIntegrationConnectedForSources(evidence.jiraSearch)) {
      list.push({ provider: "jira", detail: `${jiraCount} issue(s)` });
    }
    if (isIntegrationConnectedForSources(evidence.confluenceSearch)) {
      list.push({ provider: "confluence", detail: `${confluenceCount} page(s)` });
    }
    if (isIntegrationConnectedForSources(evidence.notionSearch)) {
      list.push({ provider: "notion", detail: `${notionCount} page(s)` });
    }
    if (isIntegrationConnectedForSources(evidence.googleDocsSearch)) {
      list.push({ provider: "google-docs", detail: `${googleDocsCount} doc(s)` });
    }
    if (isIntegrationConnectedForSources(evidence.teamsSearch)) {
      list.push({ provider: "teams", detail: `${teamsCount} message(s)` });
    }
    if (list.length === 0) list.push({ provider: "github", detail: "Limited graph" });
    return list;
  }, [
    directCount,
    transitiveCount,
    docsCount,
    prCount,
    evidence.ownersByFile,
    evidence.slackSearch,
    evidence.jiraSearch,
    evidence.confluenceSearch,
    evidence.notionSearch,
    evidence.googleDocsSearch,
    evidence.teamsSearch,
    slackCount,
    jiraCount,
    confluenceCount,
    notionCount,
    googleDocsCount,
    teamsCount
  ]);

  return (
    <EvidenceCardShell
      artifactId={artifactId}
      title="Blast radius"
      meta={targetMeta}
      sources={sources}
      summary={summary}
      actionContext={actionContext}
      statusTone={evidence.completeness === "full" ? "default" : evidence.completeness === "partial" ? "partial" : "minimal"}
      conflicts={conflicts}
    >
      <EvidenceConnectionStack>
        <EvidenceConnectionGroup
          connection="github"
          briefSummary={{
            title: `Code dependents (${directCount + transitiveCount})`,
            sourceLabel: blastRadiusSourceLabelDependencies()
          }}
        >
          <IntegrationResultCollapsible
            title={`Code dependents (${directCount + transitiveCount})`}
            sourceLabel={blastRadiusSourceLabelDependencies()}
            sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelDependencies())}
            open={expanded.graph}
            onToggle={() => setExpanded((state) => ({ ...state, graph: !state.graph }))}
          >
            {directCount > 0 ? (
              <>
                <IntegrationResultText muted>Direct ({directCount})</IntegrationResultText>
                {groupedCodeDirect.map((group) => (
                  <div key={group.label} className="mt-2">
                    <IntegrationResultText muted>{group.label}</IntegrationResultText>
                    <ul className="space-y-1">
                      {group.entries.slice(0, 15).map((dep) => (
                        <li key={dep.path} className="coop-result-text">
                          <code>{dep.path}</code>
                          {dep.source ? ` · ${dep.source}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            ) : (
              <IntegrationResultText muted>Impact unverified — no direct code dependents in index.</IntegrationResultText>
            )}
            {transitiveCount > 0 ? (
              <>
                <IntegrationResultText muted className="mt-2">
                  Transitive ({transitiveCount})
                </IntegrationResultText>
                <ul className="space-y-1">
                  {codeTransitiveDetails.slice(0, 10).map((dep) => (
                    <li key={dep.path} className="coop-result-text">
                      <code>{dep.path}</code>
                      {dep.depth > 1 ? ` · depth ${dep.depth}` : ""}
                      {dep.source ? ` · ${dep.source}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {evidence.graphMeta?.source ? (
              <IntegrationResultText muted>Graph source: {evidence.graphMeta.source}</IntegrationResultText>
            ) : null}
          </IntegrationResultCollapsible>

          {docsCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Docs references (${docsCount})`}
              sourceLabel={blastRadiusSourceLabelDocsReferences()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelDocsReferences())}
              open={expanded.docs}
              onToggle={() => setExpanded((state) => ({ ...state, docs: !state.docs }))}
            >
              <IntegrationResultText muted>
                Markdown, docs, README, and type-definition references — not runtime importers.
              </IntegrationResultText>
              <ul className="space-y-1 mt-2">
                {evidence.docsReferences!.slice(0, 12).map((entry) => (
                  <li key={entry.path} className="coop-result-text">
                    <code>{entry.path}</code> · {entry.source}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {testCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Tests (${testCount})`}
              sourceLabel={blastRadiusSourceLabelTests()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelTests())}
              open={expanded.tests}
              onToggle={() => setExpanded((state) => ({ ...state, tests: !state.tests }))}
            >
              <ul className="space-y-1">
                {evidence.testFiles!.slice(0, 10).map((entry) => (
                  <li key={entry.path} className="coop-result-text">
                    <code>{entry.path}</code> · {entry.source}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {exportCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Public API (${exportCount})`}
              sourceLabel={blastRadiusSourceLabelPublicApi()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelPublicApi())}
              open={expanded.api}
              onToggle={() => setExpanded((state) => ({ ...state, api: !state.api }))}
            >
              <ul className="space-y-1">
                {evidence.publicExports!.slice(0, 10).map((entry) => (
                  <li key={`${entry.symbol}-${entry.line}`} className="coop-result-text">
                    {entry.symbol} ({entry.kind}, line {entry.line})
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {recentCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Recent changes (${recentCount})`}
              sourceLabel={blastRadiusSourceLabelRecentChanges()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelRecentChanges())}
              open={expanded.recent}
              onToggle={() => setExpanded((state) => ({ ...state, recent: !state.recent }))}
            >
              <ul className="space-y-1">
                {evidence.recentChanges!.slice(0, 10).map((change) => (
                  <li key={change.number} className="coop-result-text">
                    #{change.number} ({change.state}): {change.title}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {prCount > 0 ? (
            <IntegrationResultCollapsible
              title={`Open pull requests (${prCount})`}
              sourceLabel={blastRadiusSourceLabelOpenPrs()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelOpenPrs())}
              open={expanded.prs}
              onToggle={() => setExpanded((state) => ({ ...state, prs: !state.prs }))}
            >
              <ul className="space-y-1">
                {evidence.openPullRequests!.slice(0, 10).map((pr) => (
                  <li key={pr.number} className="coop-result-text">
                    #{pr.number} ({pr.state}): {pr.title}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {evidence.ownersByFile?.length ? (
            <IntegrationResultCollapsible
              title="Owners to notify"
              sourceLabel={blastRadiusSourceLabelCodeowners()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelCodeowners())}
              open={expanded.owners}
              onToggle={() => setExpanded((state) => ({ ...state, owners: !state.owners }))}
            >
              <ul className="space-y-1">
                {evidence.ownersByFile.map((entry) => (
                  <li key={entry.file} className="coop-result-text">
                    <code>{entry.file}</code> — @{entry.owner}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}
        </EvidenceConnectionGroup>

        {localCount > 0 ? (
          <EvidenceConnectionGroup connection="workspace">
            <IntegrationResultCollapsible
              title={`Local files (${localCount})`}
              sourceLabel={blastRadiusSourceLabelLocalFiles()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelLocalFiles())}
              open={expanded.local}
              onToggle={() => setExpanded((state) => ({ ...state, local: !state.local }))}
            >
              <ul className="space-y-1">
                {evidence.localFiles!.files!.slice(0, 10).map((entry) => (
                  <li key={entry.path} className="coop-result-text">
                    <code>{entry.path}</code>
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.slackSearch) ? (
          <EvidenceConnectionGroup connection="slack">
            <IntegrationResultCollapsible
              title={`Discussions (${slackCount})`}
              sourceLabel={blastRadiusSourceLabelSlack()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelSlack())}
              open={expanded.slack}
              onToggle={() => setExpanded((state) => ({ ...state, slack: !state.slack }))}
            >
              {evidence.slackSearch.error ? (
                <IntegrationResultText muted>{evidence.slackSearch.error}</IntegrationResultText>
              ) : slackCount > 0 ? (
                <ul className="space-y-2">
                  {evidence.slackSearch.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.channelName ? `#${message.channelName}` : "Slack"}: {message.text.slice(0, 200)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Slack discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.jiraSearch) ? (
          <EvidenceConnectionGroup connection="jira">
            <IntegrationResultCollapsible
              title={`Jira (${jiraCount})`}
              sourceLabel={blastRadiusSourceLabelJira()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelJira())}
              open={expanded.jira}
              onToggle={() => setExpanded((state) => ({ ...state, jira: !state.jira }))}
            >
              {evidence.jiraSearch.error ? (
                <IntegrationResultText muted>{evidence.jiraSearch.error}</IntegrationResultText>
              ) : jiraCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.jiraSearch.issues.slice(0, 8).map((issue) => (
                    <li key={issue.key} className="coop-result-text">
                      {issue.key}: {issue.summary} ({issue.status})
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Jira issues.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.confluenceSearch) ? (
          <EvidenceConnectionGroup connection="confluence">
            <IntegrationResultCollapsible
              title={`Confluence (${confluenceCount})`}
              sourceLabel={blastRadiusSourceLabelConfluence()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelConfluence())}
              open={expanded.confluence}
              onToggle={() => setExpanded((state) => ({ ...state, confluence: !state.confluence }))}
            >
              {evidence.confluenceSearch.error ? (
                <IntegrationResultText muted>{evidence.confluenceSearch.error}</IntegrationResultText>
              ) : confluenceCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.confluenceSearch.pages.slice(0, 8).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                      {page.excerpt ? ` — ${page.excerpt.slice(0, 100)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Confluence pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.notionSearch) ? (
          <EvidenceConnectionGroup connection="notion">
            <IntegrationResultCollapsible
              title={`Notion (${notionCount})`}
              sourceLabel={blastRadiusSourceLabelNotion()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelNotion())}
              open={expanded.notion}
              onToggle={() => setExpanded((state) => ({ ...state, notion: !state.notion }))}
            >
              {evidence.notionSearch.error ? (
                <IntegrationResultText muted>{evidence.notionSearch.error}</IntegrationResultText>
              ) : notionCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.notionSearch.pages.slice(0, 8).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Notion pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.googleDocsSearch) ? (
          <EvidenceConnectionGroup connection="google-docs">
            <IntegrationResultCollapsible
              title={`Google Docs (${googleDocsCount})`}
              sourceLabel={blastRadiusSourceLabelGoogleDocs()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelGoogleDocs())}
              open={expanded.googleDocs}
              onToggle={() => setExpanded((state) => ({ ...state, googleDocs: !state.googleDocs }))}
            >
              {evidence.googleDocsSearch.error ? (
                <IntegrationResultText muted>{evidence.googleDocsSearch.error}</IntegrationResultText>
              ) : googleDocsCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.googleDocsSearch.documents.slice(0, 8).map((doc) => (
                    <li key={doc.id} className="coop-result-text">
                      {doc.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Google Docs.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(evidence.teamsSearch) ? (
          <EvidenceConnectionGroup connection="teams">
            <IntegrationResultCollapsible
              title={`Teams (${teamsCount})`}
              sourceLabel={blastRadiusSourceLabelTeams()}
              sectionDomId={evidenceSectionDomId(artifactId, blastRadiusSourceLabelTeams())}
              open={expanded.teams}
              onToggle={() => setExpanded((state) => ({ ...state, teams: !state.teams }))}
            >
              {evidence.teamsSearch.error ? (
                <IntegrationResultText muted>{evidence.teamsSearch.error}</IntegrationResultText>
              ) : teamsCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.teamsSearch.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.fromUserName ?? "Teams"}: {message.text.slice(0, 200)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Teams discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {ciCount > 0 ? (
          <EvidenceDerivedGroup title="CI workflows">
            <ul className="space-y-1">
              {evidence.ciWorkflows!.slice(0, 6).map((entry) => (
                <li key={entry.path} className="coop-result-text">
                  <code>{entry.path}</code> → {entry.matchedPath}
                </li>
              ))}
            </ul>
          </EvidenceDerivedGroup>
        ) : null}

        {crossRepoCount > 0 ? (
          <EvidenceDerivedGroup title="Cross-repo consumers">
            <ul className="space-y-1">
              {evidence.crossRepoConsumers!.slice(0, 6).map((entry) => (
                <li key={`${entry.repoId}-${entry.path}`} className="coop-result-text">
                  {entry.repoId}: <code>{entry.path}</code> · {entry.source}
                </li>
              ))}
            </ul>
          </EvidenceDerivedGroup>
        ) : null}

        {inlineWarnings.length > 0 ? (
          <EvidenceDerivedGroup title="Warnings">
            {inlineWarnings.map((warning) => (
              <IntegrationResultText key={warning} muted>
                · {warning}
              </IntegrationResultText>
            ))}
          </EvidenceDerivedGroup>
        ) : null}
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

export function KnowledgeGapsEvidenceCard({
  evidence,
  confluence,
  jira,
  slack,
  notion,
  googleDocs,
  teams,
  file,
  artifactId,
  conflicts,
  actionContext
}: {
  evidence: KnowledgeGapsEvidence;
  confluence?: ConfluenceSearchEvidence;
  jira?: JiraSearchEvidence;
  slack?: SlackSearchEvidence;
  notion?: NotionSearchEvidence;
  googleDocs?: GoogleDocsSearchEvidence;
  teams?: TeamsSearchEvidence;
  file?: string;
  artifactId: string;
  conflicts?: ConflictSummary[];
  actionContext: EvidenceActionContext;
}): React.ReactElement {
  const [expanded, setExpanded] = useState({
    scan: true,
    confluence: true,
    jira: true,
    slack: true,
    notion: true,
    googleDocs: true,
    teams: true,
    ownership: true,
    dependencies: true
  });
  const pageCount = confluence?.pages?.length ?? 0;
  const jiraCount = jira?.issues?.length ?? 0;
  const slackCount = slack?.messages?.length ?? 0;
  const notionCount = notion?.pages?.length ?? 0;
  const googleDocsCount = googleDocs?.documents?.length ?? 0;
  const teamsCount = teams?.messages?.length ?? 0;
  const ownerCount = evidence.ownershipReport?.scores?.length ?? 0;
  const depCount = evidence.dependencyGraph?.directDependents?.length ?? 0;

  const summary = useMemo(
    () => summarizeKnowledgeGaps(evidence, file, confluence, jira, slack, notion, googleDocs, teams),
    [evidence, file, confluence, jira, slack, notion, googleDocs, teams]
  );
  const targetMeta = summary.target ?? file;

  const inlineWarnings = useMemo(
    () => filterWarningsNotInLimitations(evidence.warnings, summary.limitations),
    [evidence.warnings, summary.limitations]
  );

  const sources = useMemo(() => {
    const list: EvidenceCardSource[] = [{ provider: "github", detail: "Repo scan" }];
    if (evidence.jobScan) list.push({ provider: "github", detail: "Gap scan" });
    if (isIntegrationConnectedForSources(confluence)) list.push({ provider: "confluence", detail: `${pageCount} page(s)` });
    if (isIntegrationConnectedForSources(jira)) list.push({ provider: "jira", detail: `${jiraCount} issue(s)` });
    if (isIntegrationConnectedForSources(slack)) list.push({ provider: "slack", detail: `${slackCount} message(s)` });
    if (isIntegrationConnectedForSources(notion)) list.push({ provider: "notion", detail: `${notionCount} page(s)` });
    if (isIntegrationConnectedForSources(googleDocs)) list.push({ provider: "google-docs", detail: `${googleDocsCount} doc(s)` });
    if (isIntegrationConnectedForSources(teams)) list.push({ provider: "teams", detail: `${teamsCount} message(s)` });
    if (evidence.ownershipReport) list.push({ provider: "github", detail: `${ownerCount} owner score(s)` });
    if (evidence.dependencyGraph) {
      list.push({
        provider: "github",
        detail: `${depCount || evidence.dependencyGraph?.edgeCount || 0} dependent(s)`
      });
    }
    return list;
  }, [
    evidence.jobScan,
    confluence,
    jira,
    slack,
    pageCount,
    jiraCount,
    slackCount,
    notion,
    googleDocs,
    notionCount,
    googleDocsCount,
    teams,
    teamsCount,
    ownerCount,
    depCount,
    evidence.ownershipReport,
    evidence.dependencyGraph
  ]);

  return (
    <EvidenceCardShell
      artifactId={artifactId}
      title="Knowledge gaps"
      meta={targetMeta ?? "Repository-wide scan"}
      sources={sources}
      summary={summary}
      actionContext={actionContext}
      conflicts={conflicts}
    >
      <EvidenceConnectionStack>
        <EvidenceConnectionGroup
          connection="github"
          briefSummary={
            evidence.jobScan
              ? {
                  title: `Background gap scan (${evidence.jobScan.foundGaps ?? evidence.jobScan.gaps?.length ?? 0})`,
                  sourceLabel: knowledgeGapsSourceLabelScan()
                }
              : evidence.ownershipReport
                ? {
                    title: `Ownership signals (${ownerCount})`,
                    sourceLabel: knowledgeGapsSourceLabelOwnership()
                  }
                : evidence.dependencyGraph
                  ? {
                      title: `Dependencies (${depCount || evidence.dependencyGraph?.edgeCount || 0})`,
                      sourceLabel: knowledgeGapsSourceLabelDependencies()
                    }
                  : undefined
          }
        >
          {evidence.jobScan ? (
            <IntegrationResultCollapsible
              title={`Background gap scan (${evidence.jobScan.foundGaps ?? evidence.jobScan.gaps?.length ?? 0})`}
              sourceLabel={knowledgeGapsSourceLabelScan()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelScan())}
              open={expanded.scan}
              onToggle={() => setExpanded((state) => ({ ...state, scan: !state.scan }))}
            >
              <IntegrationResultText muted>
                Found {evidence.jobScan.foundGaps ?? evidence.jobScan.gaps?.length ?? 0} gaps — high / medium / low:{" "}
                {evidence.jobScan.highPriority ?? 0} / {evidence.jobScan.mediumPriority ?? 0} /{" "}
                {evidence.jobScan.lowPriority ?? 0}
              </IntegrationResultText>
              {evidence.jobScan.gaps?.length ? (
                <ul className="mt-2 space-y-1">
                  {evidence.jobScan.gaps.slice(0, 10).map((gap, index) => (
                    <li key={index} className="coop-result-text">
                      {gap.file ? <code>{String(gap.file)}</code> : null}{" "}
                      {String(gap.type ?? "gap")}: {String(gap.message ?? gap.summary ?? "")}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No structured gaps in this scan pass.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          ) : null}

          {evidence.ownershipReport ? (
            <IntegrationResultCollapsible
              title={`Ownership signals (${ownerCount})`}
              sourceLabel={knowledgeGapsSourceLabelOwnership()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelOwnership())}
              open={expanded.ownership}
              onToggle={() => setExpanded((state) => ({ ...state, ownership: !state.ownership }))}
            >
              {ownerCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.ownershipReport!.scores.slice(0, 8).map((score) => (
                    <li key={score.owner} className="coop-result-text">
                      @{score.owner} — {ownershipTierLabel(score.tier)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No ownership scores for this path.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          ) : null}

          {evidence.dependencyGraph ? (
            <IntegrationResultCollapsible
              title={`Dependencies (${depCount || evidence.dependencyGraph?.edgeCount || 0})`}
              sourceLabel={knowledgeGapsSourceLabelDependencies()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelDependencies())}
              open={expanded.dependencies}
              onToggle={() => setExpanded((state) => ({ ...state, dependencies: !state.dependencies }))}
            >
              {depCount > 0 ? (
                <ul className="space-y-1">
                  {evidence.dependencyGraph!.directDependents!.slice(0, 12).map((dep) => (
                    <li key={dep} className="coop-result-text">
                      <code>{dep}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>
                  Indexed edges: {evidence.dependencyGraph?.edgeCount ?? 0}
                  {evidence.dependencyGraph?.source ? ` (${evidence.dependencyGraph.source})` : ""}
                </IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          ) : null}
        </EvidenceConnectionGroup>

        {isIntegrationConnectedForSources(confluence) ? (
          <EvidenceConnectionGroup connection="confluence">
            <IntegrationResultCollapsible
              title={`Pages (${pageCount})`}
              sourceLabel={knowledgeGapsSourceLabelConfluence()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelConfluence())}
              open={expanded.confluence}
              onToggle={() => setExpanded((state) => ({ ...state, confluence: !state.confluence }))}
            >
              {confluence.error ? (
                <IntegrationResultText muted>{confluence.error}</IntegrationResultText>
              ) : pageCount > 0 ? (
                <ul className="space-y-1">
                  {confluence.pages.slice(0, 12).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                      {page.excerpt ? ` — ${page.excerpt.slice(0, 100)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Confluence pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(jira) ? (
          <EvidenceConnectionGroup connection="jira">
            <IntegrationResultCollapsible
              title={`Issues (${jiraCount})`}
              sourceLabel={knowledgeGapsSourceLabelJira()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelJira())}
              open={expanded.jira}
              onToggle={() => setExpanded((state) => ({ ...state, jira: !state.jira }))}
            >
              {jira.error ? (
                <IntegrationResultText muted>{jira.error}</IntegrationResultText>
              ) : jiraCount > 0 ? (
                <ul className="space-y-1">
                  {jira.issues.slice(0, 12).map((issue) => (
                    <li key={issue.key} className="coop-result-text">
                      <strong>{issue.key}</strong> ({issue.status}): {issue.summary}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Jira issues.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(slack) ? (
          <EvidenceConnectionGroup connection="slack">
            <IntegrationResultCollapsible
              title={`Discussions (${slackCount})`}
              sourceLabel={knowledgeGapsSourceLabelSlack()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelSlack())}
              open={expanded.slack}
              onToggle={() => setExpanded((state) => ({ ...state, slack: !state.slack }))}
            >
              {slack.error ? (
                <IntegrationResultText muted>{slack.error}</IntegrationResultText>
              ) : slackCount > 0 ? (
                <ul className="space-y-2">
                  {slack.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.channelName ? `#${message.channelName}` : "Slack"}: {message.text.slice(0, 200)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Slack discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(notion) ? (
          <EvidenceConnectionGroup connection="notion">
            <IntegrationResultCollapsible
              title={`Pages (${notionCount})`}
              sourceLabel={knowledgeGapsSourceLabelNotion()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelNotion())}
              open={expanded.notion}
              onToggle={() => setExpanded((state) => ({ ...state, notion: !state.notion }))}
            >
              {notion.error ? (
                <IntegrationResultText muted>{notion.error}</IntegrationResultText>
              ) : notionCount > 0 ? (
                <ul className="space-y-1">
                  {notion.pages.slice(0, 12).map((page) => (
                    <li key={page.id} className="coop-result-text">
                      {page.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Notion pages.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(googleDocs) ? (
          <EvidenceConnectionGroup connection="google-docs">
            <IntegrationResultCollapsible
              title={`Documents (${googleDocsCount})`}
              sourceLabel={knowledgeGapsSourceLabelGoogleDocs()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelGoogleDocs())}
              open={expanded.googleDocs}
              onToggle={() => setExpanded((state) => ({ ...state, googleDocs: !state.googleDocs }))}
            >
              {googleDocs.error ? (
                <IntegrationResultText muted>{googleDocs.error}</IntegrationResultText>
              ) : googleDocsCount > 0 ? (
                <ul className="space-y-1">
                  {googleDocs.documents.slice(0, 12).map((doc) => (
                    <li key={doc.id} className="coop-result-text">
                      {doc.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Google Docs.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {isIntegrationConnectedForSources(teams) ? (
          <EvidenceConnectionGroup connection="teams">
            <IntegrationResultCollapsible
              title={`Discussions (${teamsCount})`}
              sourceLabel={knowledgeGapsSourceLabelTeams()}
              sectionDomId={evidenceSectionDomId(artifactId, knowledgeGapsSourceLabelTeams())}
              open={expanded.teams}
              onToggle={() => setExpanded((state) => ({ ...state, teams: !state.teams }))}
            >
              {teams.error ? (
                <IntegrationResultText muted>{teams.error}</IntegrationResultText>
              ) : teamsCount > 0 ? (
                <ul className="space-y-2">
                  {teams.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.fromUserName ?? "Teams"}: {message.text.slice(0, 200)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Teams discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {inlineWarnings.length > 0 ? (
          <EvidenceDerivedGroup title="Warnings">
            {inlineWarnings.map((warning) => (
              <IntegrationResultText key={warning} muted>
                · {warning}
              </IntegrationResultText>
            ))}
          </EvidenceDerivedGroup>
        ) : null}
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

function integrationProviderChip(
  provider: IntegrationChatProvider
): EvidenceCardSource {
  return { provider };
}

function integrationProviderConnection(provider: IntegrationChatProvider): EvidenceConnectionKey {
  switch (provider) {
    case "slack":
    case "jira":
    case "teams":
      return provider;
    case "confluence":
      return "confluence";
    case "notion":
      return "notion";
    case "google-docs":
      return "google-docs";
  }
}

export function IntegrationSearchEvidenceCard({
  provider,
  evidence,
  artifactId,
  actionContext
}: {
  provider: IntegrationChatProvider;
  evidence: Record<string, unknown>;
  artifactId: string;
  actionContext: EvidenceActionContext;
}): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const label = integrationSourceLabel(provider);
  const error = evidence.error as string | undefined;
  const summary = useMemo(
    () => summarizeIntegrationSearch(provider, evidence),
    [provider, evidence]
  );

  if (!isIntegrationConnectedForSources(evidence as IntegrationSearchEvidenceLike)) {
    return null;
  }

  return (
    <EvidenceCardShell
      artifactId={artifactId}
      title={`${label.replace("[Sources: ", "").replace("]", "")}`}
      sources={[integrationProviderChip(provider)]}
      summary={summary}
      actionContext={actionContext}
    >
      <EvidenceConnectionStack>
        <EvidenceConnectionGroup
          connection={integrationProviderConnection(provider)}
          briefSummary={{ title: "Search results", sourceLabel: label }}
        >
          <IntegrationResultCollapsible
            title="Search results"
            sourceLabel={label}
            sectionDomId={evidenceSectionDomId(artifactId, label)}
            open={open}
            onToggle={() => setOpen((value) => !value)}
          >
            {error ? (
              <IntegrationResultText muted>{error}</IntegrationResultText>
            ) : (
              <IntegrationSearchResults provider={provider} evidence={evidence} />
            )}
          </IntegrationResultCollapsible>
        </EvidenceConnectionGroup>
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

function IntegrationSearchResults({
  provider,
  evidence
}: {
  provider: IntegrationChatProvider;
  evidence: Record<string, unknown>;
}): React.ReactElement {
  switch (provider) {
    case "jira": {
      const issues = (evidence as JiraSearchEvidence).issues ?? [];
      if (!issues.length) {
        return <IntegrationResultText muted>No matching Jira issues.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-1">
          {issues.slice(0, 15).map((issue) => (
            <li key={issue.key} className="coop-result-text">
              <strong>{issue.key}</strong> ({issue.status}): {issue.summary}
            </li>
          ))}
        </ul>
      );
    }
    case "slack": {
      const messages = (evidence as SlackSearchEvidence).messages ?? [];
      if (!messages.length) {
        return <IntegrationResultText muted>No matching Slack messages.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-2">
          {messages.slice(0, 10).map((message, index) => (
            <li key={index} className="coop-result-text">
              {message.channelName ? `#${message.channelName}` : "Slack"} · {message.userName ?? "unknown"}:{" "}
              {message.text.slice(0, 240)}
            </li>
          ))}
        </ul>
      );
    }
    case "teams": {
      const messages = (evidence as TeamsSearchEvidence).messages ?? [];
      if (!messages.length) {
        return <IntegrationResultText muted>No matching Teams messages.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-2">
          {messages.slice(0, 10).map((message, index) => (
            <li key={index} className="coop-result-text">
              {message.fromUserName ?? "Teams"}: {message.text.slice(0, 240)}
            </li>
          ))}
        </ul>
      );
    }
    case "confluence": {
      const pages = (evidence as ConfluenceSearchEvidence).pages ?? [];
      if (!pages.length) {
        return <IntegrationResultText muted>No matching Confluence pages.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-1">
          {pages.slice(0, 15).map((page) => (
            <li key={page.id} className="coop-result-text">
              {page.title}
              {page.excerpt ? ` — ${page.excerpt.slice(0, 100)}` : ""}
            </li>
          ))}
        </ul>
      );
    }
    case "notion": {
      const pages = (evidence as NotionSearchEvidence).pages ?? [];
      if (!pages.length) {
        return <IntegrationResultText muted>No matching Notion pages.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-1">
          {pages.slice(0, 15).map((page) => (
            <li key={page.id} className="coop-result-text">
              {page.title}
            </li>
          ))}
        </ul>
      );
    }
    case "google-docs": {
      const documents = (evidence as GoogleDocsSearchEvidence).documents ?? [];
      if (!documents.length) {
        return <IntegrationResultText muted>No matching Google Docs.</IntegrationResultText>;
      }
      return (
        <ul className="space-y-1">
          {documents.slice(0, 15).map((doc) => (
            <li key={doc.id} className="coop-result-text">
              {doc.title}
            </li>
          ))}
        </ul>
      );
    }
  }
}

function filterWarningsNotInLimitations(
  warnings: string[] | undefined,
  limitations: string[]
): string[] {
  return filterDetailWarnings(warnings, limitations);
}
