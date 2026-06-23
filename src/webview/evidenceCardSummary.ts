import type { IntegrationChatProvider } from "../chat/types";
import type {
  BlastRadiusEvidence,
  ConfluenceSearchEvidence,
  GoogleDocsSearchEvidence,
  JiraSearchEvidence,
  KnowledgeGapsEvidence,
  NotionSearchEvidence,
  TeamsSearchEvidence,
  RepoSummaryEvidence,
  SlackSearchEvidence
} from "../context/contextBundleEvidence";
import { formatEvidenceStaleness } from "../context/evidenceStaleness";
import {
  blastRadiusSourceLabelCiWorkflows,
  blastRadiusSourceLabelCodeowners,
  blastRadiusSourceLabelConfluence,
  blastRadiusSourceLabelCrossRepo,
  blastRadiusSourceLabelDependencies,
  blastRadiusSourceLabelDocsReferences,
  blastRadiusSourceLabelJira,
  blastRadiusSourceLabelLocalFiles,
  blastRadiusSourceLabelOpenPrs,
  blastRadiusSourceLabelPublicApi,
  blastRadiusSourceLabelRecentChanges,
  blastRadiusSourceLabelSlack,
  blastRadiusSourceLabelTests
} from "../prompts/blastRadiusSourceLabels";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelJira,
  decisionSourceLabelPr,
  decisionSourceLabelSlack,
  decisionSourceLabelTeams
} from "../prompts/decisionSourceLabels";
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
import {
  ownershipSourceLabelCodeowners,
  ownershipSourceLabelGitHub,
  ownershipSourceLabelJira,
  ownershipSourceLabelSlack,
  ownershipSourceLabelSlackDiscussions
} from "../prompts/ownershipSourceLabels";
import {
  repoSummarySourceLabelConfluence,
  repoSummarySourceLabelDependencies,
  repoSummarySourceLabelEntryFiles,
  repoSummarySourceLabelJira,
  repoSummarySourceLabelManifest,
  repoSummarySourceLabelOwnership
} from "../prompts/repoSummarySourceLabels";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport, OwnershipRisk } from "../types/ownership";
import {
  capEvidenceActions,
  type EvidenceRecommendedAction
} from "./evidenceCardActionHandler";
export type {
  EvidenceActionKind,
  EvidenceActionSearchType,
  EvidenceRecommendedAction
} from "./evidenceCardActionHandler";

export type EvidenceQuality = "strong" | "medium" | "weak" | "limited";

export type EvidenceSourceContribution = {
  provider: string;
  label: string;
  contribution: string;
  relevance: "direct" | "supporting" | "background";
  url?: string;
  staleWarning?: string;
};

export type EvidenceCardSummary = {
  target?: string;
  primaryFinding?: string;
  quality: EvidenceQuality;
  qualityReason: string;
  limitations: string[];
  sourceContributions: EvidenceSourceContribution[];
  recommendedActions: EvidenceRecommendedAction[];
};

const WEAK_COMMIT_MESSAGE_RE = /^(wip|fix|update|changes?|misc|tmp|test|merge|refactor)\b/i;

const OWNERSHIP_RISK_LABELS: Record<keyof OwnershipRisk, string> = {
  singlePointOfFailure: "Ownership appears concentrated in one person.",
  expertUnavailable: "Top experts appear unavailable.",
  orphaned: "Recent ownership activity looks stale.",
  highTurnover: "Ownership appears unstable due to high turnover.",
  teamDispersion: "Expertise is spread across many teams."
};

export function summarizeDecisionTimeline(timeline: DecisionTimeline): EvidenceCardSummary {
  const jiraTickets = timeline.jiraTickets ?? [];
  const commit = timeline.originalCommit;
  const linkedPr = timeline.linkedPR;
  const slackThread = timeline.slackThread;
  const teamsThread = timeline.teamsThread;
  const commitSha = commit?.sha.slice(0, 7);
  const hasGoodCommitMessage = commit ? isGoodCommitMessage(commit.message) : false;
  const threadMessageCount =
    (slackThread?.messages.length ?? 0) + (teamsThread?.messages.length ?? 0);
  const linkedPrHasRationale =
    !!linkedPr &&
    ((linkedPr.description?.trim().length ?? 0) >= 20 ||
      linkedPr.reviews.length > 0 ||
      linkedPr.approvers.length > 0);
  const threadHasRationale =
    (threadMessageCount > 0 &&
      (timeline.alternatives.length > 0 ||
        timeline.chronology.length > 1 ||
        hasLongMessage(slackThread?.messages.map((message) => message.text)) ||
        hasLongMessage(teamsThread?.messages.map((message) => message.text)))) ||
    false;
  const hasFallbackOnly = !!timeline.fallbackMessage && !commit;
  const isWeakCommitOnly =
    !!commit &&
    !linkedPr &&
    jiraTickets.length === 0 &&
    !slackThread &&
    !teamsThread &&
    !timeline.fallbackMessage;

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (hasFallbackOnly) {
    quality = "limited";
    qualityReason =
      "Only fallback commit-history text is available, so this trace has very limited decision evidence.";
  } else if (jiraTickets.length > 0 || linkedPrHasRationale || (threadMessageCount > 0 && threadHasRationale)) {
    quality = "strong";
    qualityReason =
      "Linked decision artifacts include explicit rationale from PR, issue, or discussion evidence.";
  } else if (
    !!linkedPr ||
    (commit && hasGoodCommitMessage) ||
    (commit && timeline.chronology.length > 1)
  ) {
    quality = "medium";
    qualityReason =
      "The trace links commit history to adjacent context, but rationale details are still partial.";
  } else if (isWeakCommitOnly) {
    quality = "weak";
    qualityReason =
      "This trace is mostly a single introducing commit with limited surrounding decision context.";
  } else {
    quality = "limited";
    qualityReason = "Evidence is sparse and does not clearly explain why this change was made.";
  }

  const staleness = commit ? formatEvidenceStaleness({ eventDate: commit.date }) : {};
  const rationaleRanking = timeline.rationaleRanking ?? [];
  const commitOnlyRationale =
    rationaleRanking.length > 0
      ? hasCommitOnlyRationale(rationaleRanking)
      : isWeakCommitOnly && hasGoodCommitMessage;
  const evolutionOneLiner = timeline.evolution
    ? describeDecisionEvolution(timeline.evolution)
    : undefined;

  const primaryFinding = hasFallbackOnly
    ? cleanLine(timeline.fallbackMessage)
    : [
        commitSha ? `Introduced in commit ${commitSha}` : undefined,
        linkedPr ? `linked to PR #${linkedPr.number} (${cleanLine(linkedPr.title)})` : undefined,
        jiraTickets.length
          ? `tracked in ${jiraTickets
              .slice(0, 3)
              .map((ticket) => ticket.key)
              .join(", ")}`
          : undefined,
        threadMessageCount > 0 ? `${threadMessageCount} team discussion message(s) add context` : undefined,
        evolutionOneLiner
      ]
        .filter(Boolean)
        .join("; ");

  const limitations = dedupeLimitations([
    !linkedPr ? "No linked pull request was found for this decision trace." : undefined,
    jiraTickets.length === 0 ? "No linked Jira issue was found for this change." : undefined,
    commit && !hasGoodCommitMessage ? "Commit message is terse, so rationale may be underspecified." : undefined,
    commitOnlyRationale
      ? "Rationale is inferred only from commit metadata; no PR, ticket, or discussion evidence was linked."
      : undefined,
    staleness.staleWarning,
    ...timeline.warnings
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [];
  if (commit) {
    const commitLabel = decisionSourceLabelCommit(commit.sha);
    sourceContributions.push({
      provider: "github",
      label: commitLabel,
      contribution: [
        `Commit ${commit.sha.slice(0, 7)} by ${commit.author} introduced the traced code with message "${truncate(cleanLine(commit.message), 120)}".`,
        timeline.introducingDiffSummary?.summary
      ]
        .filter(Boolean)
        .join(" "),
      relevance: relevanceFromRationaleRanking(
        rationaleRanking,
        { sourcePrefix: "commit:", label: commitLabel },
        "direct"
      ),
      url: commit.htmlUrl,
      staleWarning: staleness.staleWarning
    });
  }
  if (linkedPr) {
    const prLabel = decisionSourceLabelPr(linkedPr.number);
    sourceContributions.push({
      provider: "github",
      label: prLabel,
      contribution: `PR #${linkedPr.number} documents "${cleanLine(linkedPr.title)}" with ${linkedPr.reviews.length} review comment(s) and ${linkedPr.approvers.length} approver(s).`,
      relevance: relevanceFromRationaleRanking(
        rationaleRanking,
        { sourcePrefix: "pr:", label: prLabel },
        linkedPrHasRationale ? "direct" : "supporting"
      ),
      url: linkedPr.htmlUrl
    });
  }
  for (const [index, ticket] of jiraTickets.entries()) {
    const jiraLabel = decisionSourceLabelJira(ticket.key);
    sourceContributions.push({
      provider: "jira",
      label: jiraLabel,
      contribution: `Jira ${ticket.key} captures "${cleanLine(ticket.summary)}" and associated acceptance criteria for this change.`,
      relevance: relevanceFromRationaleRanking(
        rationaleRanking,
        { sourcePrefix: "jira:", label: jiraLabel },
        index === 0 ? "direct" : "supporting"
      ),
      url: ticket.htmlUrl
    });
  }
  if (slackThread) {
    const channel = slackThread.channelName ?? slackThread.channelId;
    const slackLabel = decisionSourceLabelSlack(channel);
    sourceContributions.push({
      provider: "slack",
      label: slackLabel,
      contribution: `Slack thread in #${channel} includes ${slackThread.messages.length} message(s) from ${slackThread.participants.length} participant(s).`,
      relevance: relevanceFromRationaleRanking(
        rationaleRanking,
        { sourcePrefix: "slack:", label: slackLabel },
        threadHasRationale ? "direct" : "supporting"
      ),
      url: slackThread.permalink
    });
  }
  if (teamsThread) {
    const teamsLabel = decisionSourceLabelTeams();
    sourceContributions.push({
      provider: "teams",
      label: teamsLabel,
      contribution: `Teams thread includes ${teamsThread.messages.length} message(s) from ${teamsThread.participants.length} participant(s).`,
      relevance: relevanceFromRationaleRanking(
        rationaleRanking,
        { sourcePrefix: "teams:", label: teamsLabel },
        threadHasRationale ? "direct" : "supporting"
      )
    });
  }

  const recommendedActions: EvidenceRecommendedAction[] = dedupeActions([
    commit?.htmlUrl
      ? { label: "Open commit", kind: "open-url", url: commit.htmlUrl }
      : undefined,
    linkedPr?.htmlUrl
      ? { label: "Open PR", kind: "open-url", url: linkedPr.htmlUrl }
      : undefined,
    timeline.file
      ? { label: "Search related PR", kind: "search", path: timeline.file, searchType: "pr" }
      : undefined
  ]);

  return {
    target: timeline.targetLabel ?? timeline.file,
    primaryFinding: primaryFinding || undefined,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

export function summarizeOwnershipReport(
  report: OwnershipReport,
  slackSearch?: SlackSearchEvidence
): EvidenceCardSummary {
  const primary = report.scores.find((score) => score.tier === "primary");
  const fallback = report.scores[0];
  const hasSlackPresence = report.scores.some((score) => !!score.presence);
  const hasIssueSignals = !!report.signals?.issues?.length;

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (
    primary &&
    report.scores.length > 1 &&
    report.completeness !== "minimal" &&
    (report.orgContext || hasSlackPresence || hasIssueSignals)
  ) {
    quality = "strong";
    qualityReason =
      "Ownership is backed by a clear primary owner plus corroborating team or activity signals.";
  } else if (primary || report.scores.length >= 2) {
    quality = "medium";
    qualityReason = "Ownership has a likely lead, but supporting signals are incomplete.";
  } else if (report.scores.length === 1) {
    quality = "weak";
    qualityReason = "Ownership is inferred from a single contributor signal.";
  } else {
    quality = "limited";
    qualityReason = "No scored owners were returned for this path.";
  }

  const primaryFinding = primary
    ? `@${primary.owner} is the primary owner for ${report.path}${primary.commitCount ? ` (${primary.commitCount} recent commit(s))` : ""}.`
      : fallback
      ? `@${fallback.owner} is the top available ownership signal for ${report.path}.`
      : `No clear owner was identified for ${report.path}.`;

  const riskLimitations = (Object.entries(report.risk) as Array<[keyof OwnershipRisk, boolean]>)
    .filter(([, active]) => active)
    .map(([key]) => OWNERSHIP_RISK_LABELS[key]);

  const limitations = dedupeLimitations([
    !primary ? "No explicit primary owner was identified." : undefined,
    report.scores.length === 0 ? "No ownership scores were computed for this path." : undefined,
    !hasSlackPresence && !slackSearch ? "No Slack presence evidence was included for owner availability." : undefined,
    ...riskLimitations,
    ...report.warnings
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [
    {
      provider: "github",
      label: ownershipSourceLabelGitHub(),
      contribution: report.scores.length
        ? `Git history and reviews produced ${report.scores.length} ownership score(s), led by @${(primary ?? fallback)?.owner ?? "unknown"}.`
        : "Git history did not yield a confident owner ranking.",
      relevance: report.scores.length ? "direct" : "background"
    }
  ];

  if (hasSlackPresence) {
    sourceContributions.push({
      provider: "slack",
      label: ownershipSourceLabelSlack(),
      contribution: "Slack presence signals indicate whether top owners are currently active or away.",
      relevance: "supporting"
    });
  }
  if (report.orgContext?.source === "codeowners") {
    sourceContributions.push({
      provider: "github",
      label: ownershipSourceLabelCodeowners(),
      contribution: `CODEOWNERS maps this area to ${report.orgContext.teamName}, which supports escalation routing.`,
      relevance: "supporting",
      url: report.orgContext.htmlUrl
    });
  }
  if (hasIssueSignals) {
    sourceContributions.push({
      provider: "jira",
      label: ownershipSourceLabelJira(),
      contribution: `Issue assignment history contributes ${report.signals?.issues.length ?? 0} ownership signal(s).`,
      relevance: "supporting"
    });
  }
  if (slackSearch) {
    sourceContributions.push({
      provider: "slack",
      label: ownershipSourceLabelSlackDiscussions(),
      contribution: slackSearch.error
        ? `Slack discussion lookup returned an error: ${cleanLine(slackSearch.error)}`
        : `Slack discussion search found ${slackSearch.messages.length} relevant message(s) around this code area.`,
      relevance: slackSearch.messages.length ? "supporting" : "background"
    });
  }

  const recommendedActions = dedupeActions([
    report.path ? { label: "Open target file", kind: "open-file", path: report.path } : undefined,
    report.orgContext?.htmlUrl
      ? { label: `Open ${report.orgContext.teamName}`, kind: "open-url", url: report.orgContext.htmlUrl }
      : undefined
  ]);

  return {
    target: report.path,
    primaryFinding,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

export function summarizeBlastRadius(
  evidence: BlastRadiusEvidence,
  file: string
): EvidenceCardSummary {
  const directCount = evidence.directDependents?.length ?? 0;
  const transitiveCount = evidence.transitiveDependents?.length ?? 0;
  const docsCount = evidence.docsReferences?.length ?? 0;
  const dependentCount = directCount + transitiveCount;
  const prCount = evidence.openPullRequests?.length ?? 0;
  const ownerCount = evidence.ownersByFile?.length ?? 0;
  const testCount = evidence.testFiles?.length ?? 0;
  const exportCount = evidence.publicExports?.length ?? 0;
  const recentCount = evidence.recentChanges?.length ?? 0;
  const graphSource = evidence.graphMeta?.source;
  const lightningDisabled = evidence.graphMeta?.lightningEnabled === false;
  const hasOtherSignals =
    !!evidence.graphMeta ||
    prCount > 0 ||
    ownerCount > 0 ||
    testCount > 0 ||
    exportCount > 0 ||
    recentCount > 0 ||
    (evidence.localFiles?.files?.length ?? 0) > 0;

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (dependentCount > 0 && (prCount > 0 || ownerCount > 0 || testCount > 0)) {
    quality = "strong";
    qualityReason = "Dependency impact is backed by dependents plus active PR, test, or ownership evidence.";
  } else if (dependentCount > 0) {
    quality = "medium";
    qualityReason = "Dependency graph shows impact paths, but owner/release context is limited.";
  } else if (hasOtherSignals) {
    quality = "weak";
    qualityReason = "Supporting signals exist, but no direct dependents were indexed for this file.";
  } else {
    quality = "limited";
    qualityReason = "No dependency or impact evidence was available for this file.";
  }

  const primaryFinding =
    dependentCount > 0
      ? `${file} has ${directCount} code dependent(s)${transitiveCount ? ` and ${transitiveCount} transitive code dependent(s)` : ""}${docsCount ? ` plus ${docsCount} docs/reference hit(s)` : ""}${graphSource ? ` (source: ${graphSource})` : ""}.`
      : docsCount > 0
        ? `${file} has no code dependents in the index, but ${docsCount} docs/reference file(s) mention it.`
        : `Impact unverified — no indexed dependents found for ${file}.`;

  const limitations = dedupeLimitations([
    dependentCount === 0
      ? "Impact unverified — no dependents found in index; do not assume zero blast radius."
      : undefined,
    lightningDisabled ? "Deep index (Lightning Mode) is not enabled for this repository." : undefined,
    ownerCount === 0 ? "No CODEOWNERS mapping was attached for impacted files." : undefined,
    evidence.slackSearch?.error,
    evidence.slackSearch && evidence.slackSearch.messages.length === 0
      ? "No matching Slack discussions were found for this blast radius."
      : undefined,
    evidence.jiraSearch?.error,
    evidence.jiraSearch && evidence.jiraSearch.issues.length === 0
      ? "No matching Jira issues were found for this blast radius."
      : undefined,
    evidence.confluenceSearch?.error,
    evidence.confluenceSearch && evidence.confluenceSearch.pages.length === 0
      ? "No matching Confluence pages were found for this blast radius."
      : undefined,
    ...evidence.warnings ?? []
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [];
  if (dependentCount > 0 || evidence.graphMeta) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelDependencies(),
      contribution:
        dependentCount > 0
          ? `Dependency graph identified ${directCount} direct and ${transitiveCount} transitive code dependent(s)${graphSource ? ` via ${graphSource}` : ""}.`
          : "Dependency graph metadata is present, but this file has no indexed code dependents.",
      relevance: dependentCount > 0 ? "direct" : "background"
    });
  }
  if (docsCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelDocsReferences(),
      contribution: `${docsCount} docs, README, or type-definition file(s) reference this target (not runtime importers).`,
      relevance: "background"
    });
  }
  if (testCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelTests(),
      contribution: `${testCount} test/spec file(s) reference this target.`,
      relevance: "supporting"
    });
  }
  if (exportCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelPublicApi(),
      contribution: `${exportCount} exported symbol(s) may be consumed downstream.`,
      relevance: "direct"
    });
  }
  if (recentCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelRecentChanges(),
      contribution: `${recentCount} recent PR(s) touch this file or direct dependents.`,
      relevance: "supporting"
    });
  }
  if (prCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelOpenPrs(),
      contribution: `${prCount} open pull request(s) suggest active change surfaces near this file.`,
      relevance: "supporting",
      url: evidence.openPullRequests?.[0]?.htmlUrl
    });
  }
  if (ownerCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: blastRadiusSourceLabelCodeowners(),
      contribution: `CODEOWNERS mapped ${ownerCount} impacted file(s) to owners for escalation.`,
      relevance: "supporting"
    });
  }
  if (evidence.slackSearch) {
    sourceContributions.push({
      provider: "slack",
      label: blastRadiusSourceLabelSlack(),
      contribution: evidence.slackSearch.error
        ? `Slack search failed: ${cleanLine(evidence.slackSearch.error)}`
        : `Slack search surfaced ${evidence.slackSearch.messages.length} discussion message(s).`,
      relevance: evidence.slackSearch.messages.length > 0 ? "supporting" : "background",
      url: evidence.slackSearch.messages[0]?.permalink
    });
  }
  if (evidence.jiraSearch) {
    sourceContributions.push({
      provider: "jira",
      label: blastRadiusSourceLabelJira(),
      contribution: evidence.jiraSearch.error
        ? `Jira search failed: ${cleanLine(evidence.jiraSearch.error)}`
        : `Jira search surfaced ${evidence.jiraSearch.issues.length} issue(s).`,
      relevance: evidence.jiraSearch.issues.length > 0 ? "supporting" : "background",
      url: evidence.jiraSearch.issues[0]?.htmlUrl
    });
  }
  if (evidence.confluenceSearch) {
    sourceContributions.push({
      provider: "confluence",
      label: blastRadiusSourceLabelConfluence(),
      contribution: evidence.confluenceSearch.error
        ? `Confluence search failed: ${cleanLine(evidence.confluenceSearch.error)}`
        : `Confluence search surfaced ${evidence.confluenceSearch.pages.length} page(s).`,
      relevance: evidence.confluenceSearch.pages.length > 0 ? "supporting" : "background",
      url: evidence.confluenceSearch.pages[0]?.htmlUrl
    });
  }
  if ((evidence.localFiles?.files?.length ?? 0) > 0) {
    sourceContributions.push({
      provider: "workspace",
      label: blastRadiusSourceLabelLocalFiles(),
      contribution: `${evidence.localFiles?.files?.length ?? 0} local workspace file(s) were included as impact context.`,
      relevance: "background"
    });
  }

  const recommendedActions = capEvidenceActions([
    { label: "Open target file", kind: "open-file", path: file },
    evidence.directDependents?.[0]
      ? { label: "Open top dependent", kind: "open-file", path: evidence.directDependents[0] }
      : undefined,
    lightningDisabled || dependentCount === 0
      ? { label: "Enable Lightning", kind: "open-lightning" }
      : undefined
  ]);

  return {
    target: file,
    primaryFinding,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

export function summarizeKnowledgeGaps(
  evidence: KnowledgeGapsEvidence,
  file?: string,
  confluence?: ConfluenceSearchEvidence,
  jira?: JiraSearchEvidence,
  slack?: SlackSearchEvidence,
  notion?: NotionSearchEvidence,
  googleDocs?: GoogleDocsSearchEvidence,
  teams?: TeamsSearchEvidence
): EvidenceCardSummary {
  const scan = evidence.jobScan;
  const foundGaps = scan?.foundGaps ?? scan?.gaps?.length ?? 0;
  const highPriority = scan?.highPriority ?? 0;
  const confluenceCount = confluence?.pages.length ?? 0;
  const jiraCount = jira?.issues.length ?? 0;
  const slackCount = slack?.messages.length ?? 0;
  const notionCount = notion?.pages.length ?? 0;
  const googleDocsCount = googleDocs?.documents.length ?? 0;
  const teamsCount = teams?.messages.length ?? 0;
  const ownershipCount = evidence.ownershipReport?.scores.length ?? 0;
  const dependentCount = evidence.dependencyGraph?.directDependents?.length ?? 0;
  const externalSignalCount = [
    confluenceCount > 0,
    jiraCount > 0,
    slackCount > 0,
    notionCount > 0,
    googleDocsCount > 0,
    teamsCount > 0
  ].filter(Boolean).length;

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (scan && (highPriority > 0 || externalSignalCount >= 2 || ownershipCount > 0)) {
    quality = "strong";
    qualityReason =
      "Automated gap scan is corroborated by additional documentation or ownership evidence.";
  } else if (scan || externalSignalCount >= 2) {
    quality = "medium";
    qualityReason = "There is useful gap evidence, but coverage across sources is incomplete.";
  } else if (externalSignalCount === 1 || ownershipCount > 0 || dependentCount > 0) {
    quality = "weak";
    qualityReason = "Only a narrow slice of gap evidence is available.";
  } else {
    quality = "limited";
    qualityReason = "No structured gap evidence was attached for this area.";
  }

  const primaryFinding = scan
    ? foundGaps > 0
      ? `${foundGaps} knowledge gap(s) detected${highPriority > 0 ? `, including ${highPriority} high-priority gap(s)` : ""}.`
      : "Automated scan returned no explicit knowledge gaps in this pass."
    : `No automated knowledge-gap scan was attached${file ? ` for ${file}` : ""}.`;

  const limitations = dedupeLimitations([
    !scan ? "No automated knowledge-gap scan results were included." : undefined,
    scan && foundGaps === 0 ? "Structured scan completed with no explicit gaps in this pass." : undefined,
    confluence && confluenceCount === 0 ? "No Confluence documentation pages were found for this scope." : undefined,
    jira && jiraCount === 0 ? "No Jira issues were found to anchor work tracking context." : undefined,
    slack && slackCount === 0 ? "No Slack discussion evidence was found for this area." : undefined,
    notion && notionCount === 0 ? "No Notion pages were found for this scope." : undefined,
    googleDocs && googleDocsCount === 0 ? "No Google Docs were found for this scope." : undefined,
    teams && teamsCount === 0 ? "No Teams discussions were found for this area." : undefined,
    evidence.ownershipReport && ownershipCount === 0
      ? "No ownership scoring was attached, so accountability is unclear."
      : undefined,
    evidence.dependencyGraph &&
    dependentCount === 0 &&
    !evidence.dependencyGraph?.edgeCount
      ? "No dependency-graph data was available for impact context."
      : undefined,
    ...evidence.warnings ?? []
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [];
  if (scan) {
    sourceContributions.push({
      provider: "scan",
      label: knowledgeGapsSourceLabelScan(),
      contribution: `Background scan reported ${foundGaps} gap(s) with priorities ${scan.highPriority ?? 0}/${scan.mediumPriority ?? 0}/${scan.lowPriority ?? 0} (high/medium/low).`,
      relevance: foundGaps > 0 ? "direct" : "supporting"
    });
  }
  if (confluence) {
    sourceContributions.push({
      provider: "confluence",
      label: knowledgeGapsSourceLabelConfluence(),
      contribution: confluence.error
        ? `Confluence lookup returned an error: ${cleanLine(confluence.error)}`
        : `Confluence search returned ${confluenceCount} page(s) for documentation coverage.`,
      relevance: confluenceCount > 0 ? "supporting" : "background",
      url: confluence.pages[0]?.htmlUrl
    });
  }
  if (jira) {
    sourceContributions.push({
      provider: "jira",
      label: knowledgeGapsSourceLabelJira(),
      contribution: jira.error
        ? `Jira lookup returned an error: ${cleanLine(jira.error)}`
        : `Jira search returned ${jiraCount} issue(s) relevant to this scope.`,
      relevance: jiraCount > 0 ? "supporting" : "background",
      url: jira.issues[0]?.htmlUrl
    });
  }
  if (slack) {
    sourceContributions.push({
      provider: "slack",
      label: knowledgeGapsSourceLabelSlack(),
      contribution: slack.error
        ? `Slack search returned an error: ${cleanLine(slack.error)}`
        : `Slack search returned ${slackCount} discussion message(s).`,
      relevance: slackCount > 0 ? "supporting" : "background",
      url: slack.messages[0]?.permalink
    });
  }
  if (notion) {
    sourceContributions.push({
      provider: "notion",
      label: knowledgeGapsSourceLabelNotion(),
      contribution: notion.error
        ? `Notion lookup returned an error: ${cleanLine(notion.error)}`
        : `Notion search returned ${notionCount} page(s) for documentation coverage.`,
      relevance: notionCount > 0 ? "supporting" : "background",
      url: notion.pages[0]?.url
    });
  }
  if (googleDocs) {
    sourceContributions.push({
      provider: "google-docs",
      label: knowledgeGapsSourceLabelGoogleDocs(),
      contribution: googleDocs.error
        ? `Google Docs lookup returned an error: ${cleanLine(googleDocs.error)}`
        : `Google Docs search returned ${googleDocsCount} document(s) for documentation coverage.`,
      relevance: googleDocsCount > 0 ? "supporting" : "background",
      url: googleDocs.documents[0]?.url
    });
  }
  if (teams) {
    sourceContributions.push({
      provider: "teams",
      label: knowledgeGapsSourceLabelTeams(),
      contribution: teams.error
        ? `Teams lookup returned an error: ${cleanLine(teams.error)}`
        : `Teams search returned ${teamsCount} discussion message(s).`,
      relevance: teamsCount > 0 ? "supporting" : "background"
    });
  }
  if (evidence.ownershipReport) {
    sourceContributions.push({
      provider: "github",
      label: knowledgeGapsSourceLabelOwnership(),
      contribution: ownershipCount
        ? `Ownership scoring identified ${ownershipCount} contributor signal(s) for handoff and escalation.`
        : "Ownership evidence was attached but produced no scored owners.",
      relevance: ownershipCount > 0 ? "supporting" : "background"
    });
  }
  if (evidence.dependencyGraph) {
    sourceContributions.push({
      provider: "github",
      label: knowledgeGapsSourceLabelDependencies(),
      contribution: dependentCount
        ? `Dependency graph found ${dependentCount} direct dependent file(s) for impact-aware gap analysis.`
        : `Dependency graph metadata reports ${evidence.dependencyGraph.edgeCount ?? 0} indexed edge(s).`,
      relevance: dependentCount > 0 ? "supporting" : "background"
    });
  }

  const target = file ?? evidence.file;
  const recommendedActions = dedupeActions([
    target ? { label: "Open target file", kind: "open-file", path: target } : undefined,
    target
      ? { label: "Search Confluence", kind: "search", path: target, searchType: "docs" }
      : undefined,
    target
      ? { label: "Search Jira", kind: "search", path: target, searchType: "jira" }
      : undefined
  ]);

  return {
    target,
    primaryFinding,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

export function summarizeRepoSummary(
  evidence: RepoSummaryEvidence,
  owner: string,
  repo: string
): EvidenceCardSummary {
  const manifest = evidence.manifest;
  const hasManifestSignal = !!manifest || !!evidence.repository;
  const entryCount = evidence.entryFiles?.length ?? 0;
  const confluenceCount = evidence.confluence?.pages.length ?? 0;
  const jiraCount = evidence.jira?.issues.length ?? 0;
  const ownershipCount = evidence.ownershipReport?.scores.length ?? 0;
  const hasOwnership = ownershipCount > 0 || !!evidence.relatedOwnership?.owner;
  const dependencyCount = evidence.dependencyGraph?.directDependents?.length ?? 0;
  const externalDocs = confluenceCount + jiraCount;

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (hasManifestSignal && entryCount > 0 && (externalDocs > 0 || hasOwnership)) {
    quality = "strong";
    qualityReason = "Repository structure is grounded in anchor files plus documentation or ownership context.";
  } else if ((hasManifestSignal && entryCount > 0) || (hasManifestSignal && (externalDocs > 0 || hasOwnership))) {
    quality = "medium";
    qualityReason = "Core repository structure is available, but supporting context is partial.";
  } else if (hasManifestSignal || entryCount > 0 || externalDocs > 0 || hasOwnership || dependencyCount > 0) {
    quality = "weak";
    qualityReason = "Only partial repository evidence is available for this summary.";
  } else {
    quality = "limited";
    qualityReason = "Repository summary evidence is very sparse.";
  }

  const entryNames = evidence.entryFiles?.slice(0, 2).map((entry) => entry.path) ?? [];
  const primaryFinding = [
    `${owner}/${repo}`,
    manifest?.fileCount !== undefined ? `${manifest.fileCount} indexed file(s)` : undefined,
    entryCount > 0 ? `${entryCount} anchor file(s)` : undefined,
    entryNames.length ? `entry points include ${entryNames.join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join(" · ");

  const limitations = dedupeLimitations([
    entryCount === 0 ? "No anchor files were attached for architectural grounding." : undefined,
    externalDocs === 0 ? "Confluence and Jira architecture context were not attached." : undefined,
    !hasOwnership ? "Ownership signals are missing for the currently scoped area." : undefined,
    ...evidence.warnings ?? []
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [];
  if (hasManifestSignal) {
    sourceContributions.push({
      provider: "github",
      label: repoSummarySourceLabelManifest(),
      contribution:
        manifest?.fileCount !== undefined
          ? `Repository manifest reports ${manifest.fileCount} indexed file(s) across core languages.`
          : "Repository metadata provides baseline project context.",
      relevance: "direct"
    });
  }
  if (entryCount > 0) {
    sourceContributions.push({
      provider: "github",
      label: repoSummarySourceLabelEntryFiles(),
      contribution: `${entryCount} anchor file(s) were loaded to ground architecture inference in concrete code.`,
      relevance: "direct"
    });
  }
  if (confluenceCount > 0 || evidence.confluence?.error) {
    sourceContributions.push({
      provider: "confluence",
      label: repoSummarySourceLabelConfluence(),
      contribution: evidence.confluence?.error
        ? `Confluence lookup returned an error: ${cleanLine(evidence.confluence.error)}`
        : `Confluence search added ${confluenceCount} architecture page(s).`,
      relevance: confluenceCount > 0 ? "supporting" : "background",
      url: evidence.confluence?.pages[0]?.htmlUrl
    });
  }
  if (jiraCount > 0 || evidence.jira?.error) {
    sourceContributions.push({
      provider: "jira",
      label: repoSummarySourceLabelJira(),
      contribution: evidence.jira?.error
        ? `Jira lookup returned an error: ${cleanLine(evidence.jira.error)}`
        : `Jira search added ${jiraCount} issue(s) tied to repo initiatives.`,
      relevance: jiraCount > 0 ? "supporting" : "background",
      url: evidence.jira?.issues[0]?.htmlUrl
    });
  }
  if (hasOwnership) {
    sourceContributions.push({
      provider: "github",
      label: repoSummarySourceLabelOwnership(),
      contribution: evidence.relatedOwnership?.owner
        ? `Ownership context points to @${evidence.relatedOwnership.owner} for a key scoped path.`
        : `Ownership scoring includes ${ownershipCount} contributor signal(s).`,
      relevance: "supporting"
    });
  }
  if (dependencyCount > 0 || evidence.dependencyGraph?.edgeCount) {
    sourceContributions.push({
      provider: "github",
      label: repoSummarySourceLabelDependencies(),
      contribution: dependencyCount
        ? `Dependency graph found ${dependencyCount} direct dependent(s) from the scoped entry file.`
        : `Dependency graph contains ${evidence.dependencyGraph?.edgeCount ?? 0} indexed edge(s).`,
      relevance: "background"
    });
  }

  const recommendedActions = dedupeActions([
    evidence.entryFiles?.[0]?.path
      ? { label: "Open anchor file", kind: "open-file", path: evidence.entryFiles[0].path }
      : undefined,
    evidence.confluence?.pages[0]?.htmlUrl
      ? { label: "Open architecture page", kind: "open-url", url: evidence.confluence.pages[0].htmlUrl }
      : undefined,
    evidence.entryFiles?.[0]?.path
      ? {
          label: "Find owner",
          kind: "quick-action",
          path: evidence.entryFiles[0].path,
          quickActionId: "find-owner"
        }
      : undefined
  ]);

  return {
    target: `${owner}/${repo}`,
    primaryFinding: primaryFinding || `${owner}/${repo}`,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

export function summarizeIntegrationSearch(
  provider: IntegrationChatProvider,
  evidence: Record<string, unknown>
): EvidenceCardSummary {
  const label = integrationSourceLabel(provider);
  const error = asOptionalString(evidence.error);
  const results = integrationResults(provider, evidence);
  const count = results.length;
  const top = results[0];
  const topUrl = integrationResultUrl(provider, top);

  let quality: EvidenceQuality;
  let qualityReason: string;
  if (error) {
    quality = "limited";
    qualityReason = "Integration search returned an error, so evidence coverage is limited.";
  } else if (count >= 5) {
    quality = "strong";
    qualityReason = "Search returned a broad set of matching integration results.";
  } else if (count >= 1) {
    quality = "medium";
    qualityReason = "Search returned relevant results, but sample size is still small.";
  } else {
    quality = "weak";
    qualityReason = "Search completed but returned no matching results.";
  }

  const primaryFinding = error
    ? `${provider} search failed: ${cleanLine(error)}`
    : count === 0
      ? `No matching ${provider} results were found.`
      : describeTopIntegrationResult(provider, top, count);

  const limitations = dedupeLimitations([
    error ? `Search error: ${cleanLine(error)}` : undefined,
    !error && count === 0 ? `No ${provider} results matched this query.` : undefined,
    !error && count === 1 ? "Only one matching result was found." : undefined
  ]);

  const sourceContributions: EvidenceSourceContribution[] = [
    {
      provider,
      label,
      contribution: error
        ? `The ${provider} connector responded with an error instead of results.`
        : count === 0
          ? `The ${provider} connector ran successfully but returned no matches.`
          : `The ${provider} connector returned ${count} result(s), led by "${describeTopIntegrationLabel(provider, top)}".`,
      relevance: error ? "background" : count > 0 ? "direct" : "supporting",
      url: topUrl
    }
  ];

  const recommendedActions = dedupeActions([
    topUrl ? { label: "Open top result", kind: "open-url", url: topUrl } : undefined,
    { label: "Refine integration search", kind: "search", searchType: "integration" }
  ]);

  return {
    target: provider,
    primaryFinding,
    quality,
    qualityReason,
    limitations,
    sourceContributions,
    recommendedActions
  };
}

function integrationResults(
  provider: IntegrationChatProvider,
  evidence: Record<string, unknown>
): Array<Record<string, unknown>> {
  switch (provider) {
    case "jira":
      return asRecordArray(evidence.issues);
    case "slack":
    case "teams":
      return asRecordArray(evidence.messages);
    case "confluence":
    case "notion":
      return asRecordArray(evidence.pages);
    case "google-docs":
      return asRecordArray(evidence.documents);
    default:
      return [];
  }
}

function integrationResultUrl(
  provider: IntegrationChatProvider,
  result: Record<string, unknown> | undefined
): string | undefined {
  if (!result) {
    return undefined;
  }
  switch (provider) {
    case "jira":
      return asOptionalString(result.htmlUrl);
    case "slack":
      return asOptionalString(result.permalink);
    case "teams":
      return (
        asOptionalString(result.permalink) ??
        asOptionalString(result.webUrl) ??
        asOptionalString(result.url)
      );
    case "confluence":
      return asOptionalString(result.htmlUrl);
    case "notion":
      return asOptionalString(result.url);
    case "google-docs":
      return asOptionalString(result.url);
    default:
      return undefined;
  }
}

function describeTopIntegrationResult(
  provider: IntegrationChatProvider,
  top: Record<string, unknown> | undefined,
  count: number
): string {
  if (!top) {
    return `Found ${count} ${provider} result(s).`;
  }
  switch (provider) {
    case "jira":
      return `Found ${count} Jira issue(s); top hit is ${asOptionalString(top.key) ?? "unknown"}: ${cleanLine(asOptionalString(top.summary) ?? "no summary")}.`;
    case "slack":
      return `Found ${count} Slack message(s); top hit is from ${asOptionalString(top.userName) ?? "unknown"} in ${asOptionalString(top.channelName) ? `#${asOptionalString(top.channelName)}` : "Slack"}: ${truncate(cleanLine(asOptionalString(top.text) ?? ""), 100)}.`;
    case "teams":
      return `Found ${count} Teams message(s); top hit is from ${asOptionalString(top.fromUserName) ?? "unknown"}: ${truncate(cleanLine(asOptionalString(top.text) ?? ""), 100)}.`;
    case "confluence":
      return `Found ${count} Confluence page(s); top hit is "${cleanLine(asOptionalString(top.title) ?? "Untitled page")}".`;
    case "notion":
      return `Found ${count} Notion page(s); top hit is "${cleanLine(asOptionalString(top.title) ?? "Untitled page")}".`;
    case "google-docs":
      return `Found ${count} Google Doc(s); top hit is "${cleanLine(asOptionalString(top.title) ?? "Untitled document")}".`;
  }
}

function describeTopIntegrationLabel(
  provider: IntegrationChatProvider,
  top: Record<string, unknown> | undefined
): string {
  if (!top) {
    return `${provider} result`;
  }
  switch (provider) {
    case "jira":
      return `${asOptionalString(top.key) ?? "unknown issue"} ${cleanLine(asOptionalString(top.summary) ?? "")}`.trim();
    case "slack":
    case "teams":
      return truncate(cleanLine(asOptionalString(top.text) ?? ""), 90) || `${provider} message`;
    case "confluence":
    case "notion":
    case "google-docs":
      return cleanLine(asOptionalString(top.title) ?? `${provider} page`);
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
}

function hasLongMessage(messages?: Array<string | undefined>): boolean {
  return (messages ?? []).some((message) => (message?.trim().length ?? 0) >= 80);
}

function hasCommitOnlyRationale(
  ranking: NonNullable<DecisionTimeline["rationaleRanking"]>
): boolean {
  const rationaleEntries = ranking.filter((entry) => entry.role === "rationale");
  if (rationaleEntries.length === 0) {
    return false;
  }
  return rationaleEntries.every((entry) => entry.source.startsWith("commit:"));
}

function describeDecisionEvolution(
  evolution: NonNullable<DecisionTimeline["evolution"]>
): string {
  const base = `${evolution.commitCountSinceIntroduction} commit(s) touched this file since introduction`;
  const actor = evolution.lastModifiedAuthor ? ` by ${evolution.lastModifiedAuthor}` : "";
  const date = evolution.lastModifiedAt ? ` on ${formatShortDate(evolution.lastModifiedAt)}` : "";
  return `${base}; last modified${actor}${date}.`;
}

function formatShortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().slice(0, 10);
}

function relevanceFromRationaleRanking(
  ranking: NonNullable<DecisionTimeline["rationaleRanking"]>,
  matcher: { sourcePrefix: string; label: string },
  fallback: EvidenceSourceContribution["relevance"]
): EvidenceSourceContribution["relevance"] {
  const normalizedLabel = normalizeRationaleLabel(matcher.label);
  const matched = ranking.find(
    (entry) =>
      entry.source.startsWith(matcher.sourcePrefix) ||
      normalizeRationaleLabel(entry.label) === normalizedLabel
  );
  if (!matched) {
    return fallback;
  }
  return matched.role === "rationale"
    ? "direct"
    : matched.role === "provenance"
      ? "supporting"
      : "background";
}

function normalizeRationaleLabel(label: string): string {
  return label
    .replace(/^\[Sources:\s*/i, "")
    .replace(/\]$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGoodCommitMessage(message: string): boolean {
  const trimmed = cleanLine(message);
  const wordCount = trimmed.split(" ").filter(Boolean).length;
  return wordCount >= 6 && trimmed.length >= 30 && !WEAK_COMMIT_MESSAGE_RE.test(trimmed);
}

export function sourceContributionChipDetail(label: string | undefined): string | undefined {
  if (!label?.trim()) {
    return undefined;
  }
  const trimmed = label.trim();
  const citationMatch = trimmed.match(/^\[Sources:\s*(.+)\]$/i);
  return citationMatch ? citationMatch[1].trim() : trimmed;
}

export function limitationsOverlap(a: string, b: string): boolean {
  const aKey = limitationTopicKey(a);
  const bKey = limitationTopicKey(b);
  if (aKey === bKey) {
    return true;
  }
  const al = cleanLine(a).toLowerCase();
  const bl = cleanLine(b).toLowerCase();
  return al === bl || al.includes(bl) || bl.includes(al);
}

export function filterDetailWarnings(warnings: string[] | undefined, limitations: string[]): string[] {
  if (!warnings?.length) {
    return [];
  }
  if (!limitations.length) {
    return warnings;
  }
  return warnings.filter((warning) => !limitations.some((limitation) => limitationsOverlap(warning, limitation)));
}

export function dedupeLimitations(values: Array<string | undefined>): string[] {
  const seenTopics = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = cleanLine(value);
    if (!normalized) {
      continue;
    }
    const topic = limitationTopicKey(normalized);
    if (seenTopics.has(topic)) {
      continue;
    }
    seenTopics.add(topic);
    deduped.push(normalized);
  }
  return deduped;
}

function limitationTopicKey(text: string): string {
  const normalized = cleanLine(text).toLowerCase();
  if (/no linked pull request/.test(normalized)) {
    return "topic:no-linked-pr";
  }
  if (/no linked jira|no jira issue/.test(normalized)) {
    return "topic:no-linked-jira";
  }
  if (/commit message is terse|underspecified|rationale may be/.test(normalized)) {
    return "topic:terse-commit";
  }
  if (/evidence is from .* verify against current code|file changed .* since this evidence/.test(normalized)) {
    return "topic:stale-evidence";
  }
  if (/no slack thread|no matching slack/.test(normalized)) {
    return "topic:no-slack";
  }
  if (/no teams thread|no matching teams/.test(normalized)) {
    return "topic:no-teams";
  }
  if (/no indexed dependents|limited graph|dependency graph/.test(normalized)) {
    return "topic:limited-graph";
  }
  if (/no matching|no results|empty/.test(normalized)) {
    return `topic:no-results:${normalized.slice(0, 48)}`;
  }
  return `exact:${normalized}`;
}

function dedupeActions(
  actions: Array<EvidenceRecommendedAction | undefined>
): EvidenceRecommendedAction[] {
  const seen = new Set<string>();
  const deduped: EvidenceRecommendedAction[] = [];
  for (const action of actions) {
    if (!action) {
      continue;
    }
    const key = `${action.kind}|${action.label}|${action.url ?? ""}|${action.path ?? ""}|${action.searchType ?? ""}|${action.composerPrompt ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(action);
  }
  return capEvidenceActions(deduped, 3);
}

function cleanLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
