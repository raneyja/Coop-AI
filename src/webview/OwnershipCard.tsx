import React, { useMemo, useState } from "react";
import type {
  OwnershipReport,
  OwnershipRisk,
  OwnershipScore
} from "../types/ownership";
import { ChatActionLink } from "./components/ChatActionLink";
import { evidenceSectionDomId, EvidenceCardShell, type EvidenceCardSource } from "./EvidenceCardShell";
import { EvidenceEvolutionLine } from "./EvidenceRichDetail";
import {
  buildSlackPresenceViewModel,
  isSlackPresenceResolved
} from "./slackPresenceDisplay";
import { filterDetailWarnings, summarizeOwnershipReport } from "./evidenceCardSummary";
import { isIntegrationConnectedForSources } from "./integrationEvidenceVisibility";
import type { EvidenceActionContext } from "./evidenceCardActionHandler";
import type { ConflictSummary } from "./types";
import type { SlackSearchEvidence } from "../context/contextBundleEvidence";
import {
  ownershipSourceLabelGitHub,
  ownershipSourceLabelSlack,
  ownershipSourceLabelSlackDiscussions
} from "../prompts/ownershipSourceLabels";
import {
  IntegrationResultBadge,
  IntegrationResultCollapsible,
  IntegrationResultRow,
  IntegrationResultSection,
  IntegrationResultText
} from "./components/IntegrationResultCard";
import {
  EvidenceConnectionGroup,
  EvidenceConnectionStack,
  EvidenceDerivedGroup
} from "./EvidenceConnectionGroups";

export type OwnershipCardPayload = OwnershipReport & {
  narrative?: string;
};

type OwnershipCardProps = {
  report: OwnershipCardPayload;
  artifactId?: string;
  slackSearch?: SlackSearchEvidence;
  conflicts?: ConflictSummary[];
  actionContext: EvidenceActionContext;
};

const RISK_LABELS: Record<keyof OwnershipRisk, string> = {
  singlePointOfFailure: "Single point of failure",
  expertUnavailable: "All experts unavailable",
  orphaned: "Orphaned (no recent commits)",
  highTurnover: "High turnover",
  teamDispersion: "Expertise dispersed"
};

function warningsBeyondLimitations(warnings: string[], limitations: string[]): string[] {
  return filterDetailWarnings(warnings, limitations);
}

export function OwnershipCard({
  report,
  artifactId,
  slackSearch,
  conflicts,
  actionContext
}: OwnershipCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState({ github: true, presence: false, history: false, slack: true });
  const summary = useMemo(() => summarizeOwnershipReport(report, slackSearch), [report, slackSearch]);
  const detailWarnings = useMemo(
    () => warningsBeyondLimitations(report.warnings, summary.limitations),
    [report.warnings, summary.limitations]
  );
  const { primary, secondary, backup } = useMemo(() => groupExperts(report.scores), [report.scores]);
  const activeRisks = useMemo(
    () => (Object.entries(report.risk) as Array<[keyof OwnershipRisk, boolean]>).filter(([, v]) => v),
    [report.risk]
  );
  const sources = useMemo((): EvidenceCardSource[] => {
    const list: EvidenceCardSource[] = [
      { provider: "github", detail: `${report.scores.length} owner signal${report.scores.length === 1 ? "" : "s"}` }
    ];
    if (report.scores.some((score) => score.presence)) {
      list.push({ provider: "slack", detail: "Presence" });
    }
    if (report.orgContext?.source === "codeowners") {
      list.push({ provider: "github", detail: "CODEOWNERS" });
    }
    if (report.signals?.issues?.length) {
      list.push({
        provider: "jira",
        detail: `${report.signals.issues.length} issue${report.signals.issues.length === 1 ? "" : "s"}`
      });
    }
    if (isIntegrationConnectedForSources(slackSearch) && slackSearch?.messages?.length) {
      list.push({ provider: "slack", detail: `${slackSearch.messages.length} discussion(s)` });
    }
    return list;
  }, [report, slackSearch]);

  const slackPresenceView = useMemo(
    () => buildSlackPresenceViewModel(report.scores),
    [report.scores]
  );
  const resolvedArtifactId = artifactId ?? `ownership-${report.path}`;

  return (
    <EvidenceCardShell
      artifactId={resolvedArtifactId}
      title="Ownership signals"
      meta={`${report.path} · ${report.owner}/${report.repo}`}
      sources={sources}
      summary={summary}
      actionContext={actionContext}
      conflicts={conflicts}
    >
      <EvidenceConnectionStack>
        <EvidenceDerivedGroup>
          {activeRisks.length > 0 ? (
            <IntegrationResultSection label="Risk flags">
              <div className="flex flex-wrap gap-1.5">
                {activeRisks.map(([key]) => (
                  <IntegrationResultBadge key={key} tone="warning">
                    {RISK_LABELS[key]}
                  </IntegrationResultBadge>
                ))}
              </div>
            </IntegrationResultSection>
          ) : null}

          <IntegrationResultSection>
            <IntegrationResultText>{report.teamGraph.escalationPath}</IntegrationResultText>
            {report.teamGraph.crossTeamNote ? (
              <IntegrationResultText muted>{report.teamGraph.crossTeamNote}</IntegrationResultText>
            ) : null}
          </IntegrationResultSection>

          {detailWarnings.length > 0 ? (
            <IntegrationResultSection>
              {detailWarnings.map((warning) => (
                <IntegrationResultText key={warning} muted>
                  · {warning}
                </IntegrationResultText>
              ))}
            </IntegrationResultSection>
          ) : null}
        </EvidenceDerivedGroup>

        <EvidenceConnectionGroup
          connection="github"
          briefSummary={{
            title: "Commits & reviews",
            sourceLabel: ownershipSourceLabelGitHub()
          }}
        >
          <IntegrationResultCollapsible
            title="Commits & reviews"
            sourceLabel={ownershipSourceLabelGitHub()}
            sectionDomId={evidenceSectionDomId(resolvedArtifactId, ownershipSourceLabelGitHub())}
            open={expanded.github}
            onToggle={() => setExpanded((s) => ({ ...s, github: !s.github }))}
          >
            <div className="space-y-2">
              {primary ? <ExpertRow label="Primary" expert={primary} /> : null}
              {secondary.map((expert) => (
                <ExpertRow key={expert.owner} label="Secondary" expert={expert} />
              ))}
              {backup.slice(0, 2).map((expert) => (
                <ExpertRow key={expert.owner} label="Backup" expert={expert} />
              ))}
              {!primary && report.scores.length === 0 ? (
                <IntegrationResultText muted>
                  No clear owners identified from available signals.
                </IntegrationResultText>
              ) : null}
            </div>
          </IntegrationResultCollapsible>

          <EvidenceEvolutionLine
            evolution={report.pathEvolution}
            label="Path evolution"
            variant="collapsible"
          />

          {report.history.length > 0 ? (
            <IntegrationResultCollapsible
              title="Ownership evolution"
              open={expanded.history}
              onToggle={() => setExpanded((s) => ({ ...s, history: !s.history }))}
            >
              <ul className="space-y-1.5">
                {report.history.map((entry) => (
                  <li key={entry.period} className="coop-result-text">
                    <span className="font-medium">{entry.label}:</span> {entry.narrative}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}

          {report.orgContext ? (
            <IntegrationResultSection label="Team">
              <IntegrationResultText>
                Owned by{" "}
                {report.orgContext.htmlUrl ? (
                  <ChatActionLink
                    kind="external"
                    label={`@${report.orgContext.teamName}`}
                    onClick={() => actionContext.onOpenLink?.(report.orgContext!.htmlUrl!)}
                  />
                ) : (
                  `@${report.orgContext.teamName}`
                )}
              </IntegrationResultText>
              {report.orgContext.members.length > 0 ? (
                <IntegrationResultText muted>Members: {report.orgContext.members.join(", ")}</IntegrationResultText>
              ) : null}
              {report.orgContext.slackChannel ? (
                <IntegrationResultText muted>Slack channel: {report.orgContext.slackChannel}</IntegrationResultText>
              ) : null}
            </IntegrationResultSection>
          ) : null}
        </EvidenceConnectionGroup>

        <EvidenceConnectionGroup
          connection="slack"
          briefSummary={
            isIntegrationConnectedForSources(slackSearch)
              ? {
                  title: `Discussions (${slackSearch?.messages?.length ?? 0})`,
                  sourceLabel: ownershipSourceLabelSlackDiscussions()
                }
              : slackPresenceView.showSection
                ? {
                    title: "Presence",
                    sourceLabel: ownershipSourceLabelSlack()
                  }
                : undefined
          }
        >
          {slackPresenceView.showSection ? (
            <IntegrationResultCollapsible
              title="Presence"
              subtitle={expanded.presence ? undefined : slackPresenceView.collapsedSummary}
              sourceLabel={ownershipSourceLabelSlack()}
              sectionDomId={evidenceSectionDomId(resolvedArtifactId, ownershipSourceLabelSlack())}
              open={expanded.presence}
              onToggle={() => setExpanded((s) => ({ ...s, presence: !s.presence }))}
            >
              {slackPresenceView.resolvedEntries.length > 0 ? (
                <ul className="space-y-1">
                  {slackPresenceView.resolvedEntries.map((expert) => (
                    <li key={expert.owner} className="coop-result-text coop-result-text--muted">
                      @{expert.owner} · {expert.label}
                    </li>
                  ))}
                </ul>
              ) : null}
              {slackPresenceView.detailLine ? (
                <IntegrationResultText muted={slackPresenceView.resolvedEntries.length === 0}>
                  {slackPresenceView.detailLine}
                </IntegrationResultText>
              ) : null}
            </IntegrationResultCollapsible>
          ) : null}

          {isIntegrationConnectedForSources(slackSearch) ? (
            <IntegrationResultCollapsible
              title={`Discussions (${slackSearch!.messages?.length ?? 0})`}
              sourceLabel={ownershipSourceLabelSlackDiscussions()}
              sectionDomId={evidenceSectionDomId(resolvedArtifactId, ownershipSourceLabelSlackDiscussions())}
              open={expanded.slack}
              onToggle={() => setExpanded((s) => ({ ...s, slack: !s.slack }))}
            >
              {slackSearch.error ? (
                <IntegrationResultText muted>{slackSearch.error}</IntegrationResultText>
              ) : slackSearch.messages?.length ? (
                <ul className="space-y-2">
                  {slackSearch.messages.slice(0, 8).map((message, index) => (
                    <li key={index} className="coop-result-text">
                      {message.channelName ? `#${message.channelName}` : "Slack"} · {message.userName ?? "unknown"}:{" "}
                      {message.text.slice(0, 200)}
                    </li>
                  ))}
                </ul>
              ) : (
                <IntegrationResultText muted>No matching Slack discussions.</IntegrationResultText>
              )}
            </IntegrationResultCollapsible>
          ) : null}
        </EvidenceConnectionGroup>
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

function ExpertRow({ label, expert }: { label: string; expert: OwnershipScore }): React.ReactElement {
  return (
    <IntegrationResultRow label={label}>
      <p>
        <span className="font-medium">@{expert.owner}</span>
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {expert.specialty ? <IntegrationResultBadge tone="info">{expert.specialty}</IntegrationResultBadge> : null}
        {expert.presence && isSlackPresenceResolved(expert.presence) ? (
          <span className="text-[10px] text-[var(--coop-panel-muted)]">{expert.presence.label}</span>
        ) : null}
      </div>
    </IntegrationResultRow>
  );
}

function groupExperts(scores: OwnershipScore[]): {
  primary?: OwnershipScore;
  secondary: OwnershipScore[];
  backup: OwnershipScore[];
} {
  const primary = scores.find((s) => s.tier === "primary");
  const secondary = scores.filter((s) => s.tier === "secondary");
  const backup = scores.filter((s) => s.tier === "familiar");
  return { primary, secondary, backup };
}
