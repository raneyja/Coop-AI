import React, { useMemo, useState } from "react";
import type { DecisionTimeline as DecisionTimelineData } from "../types/decisionTimeline";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelJira,
  decisionSourceLabelPr,
  decisionSourceLabelSlack,
  decisionSourceLabelTeams
} from "../prompts/decisionSourceLabels";
import {
  IntegrationResultBadge,
  IntegrationResultCode,
  IntegrationResultCollapsible,
  IntegrationResultNested,
  IntegrationResultSection,
  IntegrationResultText
} from "./components/IntegrationResultCard";
import { ChatActionLink } from "./components/ChatActionLink";
import { useChatLinks } from "./components/ChatLinkContext";
import { type IntegrationSourceId } from "./components/IntegrationSourceBrand";
import { evidenceSectionDomId, EvidenceCardShell } from "./EvidenceCardShell";
import {
  EvidenceConnectionGroup,
  EvidenceConnectionStack,
  EvidenceDerivedGroup
} from "./EvidenceConnectionGroups";
import {
  EvidenceDiffSummary,
  EvidenceEvolutionLine,
  EvidenceRationaleRanking
} from "./EvidenceRichDetail";
import { filterDetailWarnings, summarizeDecisionTimeline } from "./evidenceCardSummary";
import type { EvidenceActionContext } from "./evidenceCardActionHandler";
import type { ConflictSummary } from "./types";

export type DecisionTimelinePayload = DecisionTimelineData & {
  narrative?: string;
  owner?: string;
  repo?: string;
};

type DecisionTimelineProps = {
  timeline: DecisionTimelinePayload;
  artifactId: string;
  conflicts?: ConflictSummary[];
  actionContext: EvidenceActionContext;
};

type SectionId =
  | "commit"
  | "pr"
  | "prReviews"
  | "slack"
  | "teams"
  | "jiraGroup"
  | "alternatives"
  | "code"
  | "warnings";

function evidenceSources(timeline: DecisionTimelineData): Array<{ provider: IntegrationSourceId; detail?: string }> {
  const sources: Array<{ provider: IntegrationSourceId; detail?: string }> = [];
  if (timeline.originalCommit || timeline.fallbackMessage || timeline.linkedPR) {
    sources.push({
      provider: "github",
      detail: timeline.linkedPR ? `PR #${timeline.linkedPR.number}` : timeline.originalCommit?.sha.slice(0, 7)
    });
  }
  if (timeline.slackThread) {
    sources.push({
      provider: "slack",
      detail: timeline.slackThread.channelName
        ? `#${timeline.slackThread.channelName}`
        : timeline.slackThread.channelId
    });
  }
  if (timeline.teamsThread) {
    sources.push({ provider: "teams", detail: "Thread" });
  }
  for (const ticket of timeline.jiraTickets ?? []) {
    sources.push({ provider: "jira", detail: ticket.key });
  }
  return sources;
}

function warningsBeyondLimitations(warnings: string[], limitations: string[]): string[] {
  return filterDetailWarnings(warnings, limitations);
}

function shouldShowChronology(timeline: DecisionTimelineData): boolean {
  if (timeline.chronology.length === 0) {
    return false;
  }
  if (timeline.chronology.length === 1 && timeline.originalCommit) {
    const event = timeline.chronology[0];
    if (/originally introduced|code introduced|introducing commit/i.test(event.event)) {
      return false;
    }
  }
  return true;
}

function shouldShowDecisionMakers(timeline: DecisionTimelineData, makers: string[]): boolean {
  if (makers.length === 0) {
    return false;
  }
  if (makers.length === 1 && timeline.originalCommit) {
    const author = timeline.originalCommit.author.replace(/^@/, "").toLowerCase();
    const maker = makers[0]?.replace(/^@/, "").toLowerCase();
    if (author && maker && author === maker) {
      return false;
    }
  }
  return true;
}

export function DecisionTimeline({
  timeline,
  artifactId,
  conflicts,
  actionContext
}: DecisionTimelineProps): React.ReactElement {
  const jiraTickets = timeline.jiraTickets ?? [];
  const slackMessageCount = timeline.slackThread?.messages.length ?? 0;
  const teamsMessageCount = timeline.teamsThread?.messages.length ?? 0;
  const prReviewCount = timeline.linkedPR?.reviews.length ?? 0;

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    commit: true,
    pr: true,
    prReviews: prReviewCount <= 2,
    slack: slackMessageCount <= 2,
    teams: teamsMessageCount <= 2,
    jiraGroup: jiraTickets.length <= 1,
    alternatives: false,
    code: true,
    warnings: true
  });

  const summary = useMemo(() => summarizeDecisionTimeline(timeline), [timeline]);
  const detailWarnings = useMemo(
    () => warningsBeyondLimitations(timeline.warnings, summary.limitations),
    [timeline.warnings, summary.limitations]
  );
  const decisionMakers = useMemo(() => collectDecisionMakers(timeline), [timeline]);
  const showChronology = useMemo(() => shouldShowChronology(timeline), [timeline]);
  const showDecisionMakers = useMemo(
    () => shouldShowDecisionMakers(timeline, decisionMakers),
    [timeline, decisionMakers]
  );
  const sources = useMemo(() => evidenceSources(timeline), [timeline]);
  const { onOpenLink } = useChatLinks();
  const meta =
    timeline.targetLabel ??
    [
      timeline.file,
      timeline.lineRange
        ? `lines ${timeline.lineRange.start}${
            timeline.lineRange.end !== timeline.lineRange.start ? `-${timeline.lineRange.end}` : ""
          }`
        : undefined
    ]
      .filter(Boolean)
      .join(" · ");

  const toggle = (id: SectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <EvidenceCardShell
      artifactId={artifactId}
      title="Decision trace"
      meta={meta}
      sources={sources}
      summary={summary}
      actionContext={actionContext}
      conflicts={conflicts}
    >
      <EvidenceConnectionStack>
        {showDecisionMakers ? (
          <EvidenceDerivedGroup title="Insights">
            <IntegrationResultSection label="Key decision makers">
              <div className="flex flex-wrap gap-1.5">
                {decisionMakers.map((person) => (
                  <IntegrationResultBadge key={person} tone="info">
                    {person}
                  </IntegrationResultBadge>
                ))}
              </div>
            </IntegrationResultSection>
          </EvidenceDerivedGroup>
        ) : null}

        <EvidenceConnectionGroup
          connection="github"
          briefSummary={
            timeline.originalCommit
              ? {
                  title: "Original commit",
                  sourceLabel: decisionSourceLabelCommit(timeline.originalCommit.sha)
                }
              : timeline.linkedPR
                ? {
                    title: `PR #${timeline.linkedPR.number}`,
                    sourceLabel: decisionSourceLabelPr(timeline.linkedPR.number)
                  }
                : undefined
          }
        >
          <EvidenceEvolutionLine evolution={timeline.evolution} variant="collapsible" />

          {showChronology ? <ChronologyView events={timeline.chronology} /> : null}

          {timeline.codeSnippet ? (
            <IntegrationResultCollapsible
              title="Code under investigation"
              open={expanded.code}
              onToggle={() => toggle("code")}
            >
              <IntegrationResultCode>{timeline.codeSnippet}</IntegrationResultCode>
            </IntegrationResultCollapsible>
          ) : null}

          <EvidenceDiffSummary diff={timeline.introducingDiffSummary} />

          <EvidenceRationaleRanking ranks={timeline.rationaleRanking} />

          {timeline.originalCommit ? (
            <IntegrationResultCollapsible
              title="Original commit"
              provider="github"
              destination={timeline.originalCommit.sha.slice(0, 7)}
              subtitle={truncateSingleLine(timeline.originalCommit.message, 120)}
              sectionDomId={evidenceSectionDomId(
                artifactId,
                decisionSourceLabelCommit(timeline.originalCommit.sha)
              )}
              open={expanded.commit}
              onToggle={() => toggle("commit")}
              link={timeline.originalCommit.htmlUrl}
              linkLabel="View commit"
            >
              <CommitBlock commit={timeline.originalCommit} />
            </IntegrationResultCollapsible>
          ) : timeline.fallbackMessage ? (
            <IntegrationResultText muted>{timeline.fallbackMessage}</IntegrationResultText>
          ) : null}

          {timeline.linkedPR ? (
            <IntegrationResultCollapsible
              title={`PR #${timeline.linkedPR.number}`}
              provider="github"
              destination={`PR #${timeline.linkedPR.number}`}
              subtitle={timeline.linkedPR.title}
              sourceLabel={decisionSourceLabelPr(timeline.linkedPR.number)}
              sectionDomId={evidenceSectionDomId(
                artifactId,
                decisionSourceLabelPr(timeline.linkedPR.number)
              )}
              open={expanded.pr}
              onToggle={() => toggle("pr")}
              link={timeline.linkedPR.htmlUrl}
              linkLabel={
                timeline.linkedPR.htmlUrl?.includes("github.com/")
                  ? `View on ${timeline.linkedPR.htmlUrl.split("github.com/")[1]?.split("/pulls/")[0] ?? "GitHub"}`
                  : "View PR"
              }
            >
              <PrBlock
                pr={timeline.linkedPR}
                reviewsOpen={expanded.prReviews}
                onToggleReviews={() => toggle("prReviews")}
              />
            </IntegrationResultCollapsible>
          ) : null}

          {timeline.alternatives.length > 0 ? (
            <IntegrationResultCollapsible
              title={`Alternatives considered (${timeline.alternatives.length})`}
              open={expanded.alternatives}
              onToggle={() => toggle("alternatives")}
            >
              <AlternativesList alternatives={timeline.alternatives} />
            </IntegrationResultCollapsible>
          ) : null}
        </EvidenceConnectionGroup>

        {timeline.slackThread ? (
          <EvidenceConnectionGroup
            connection="slack"
            briefSummary={{
              title: "Thread",
              sourceLabel: decisionSourceLabelSlack(
                timeline.slackThread.channelName ?? timeline.slackThread.channelId
              )
            }}
          >
            <IntegrationResultCollapsible
              title="Thread"
              provider="slack"
              destination={
                timeline.slackThread.channelName
                  ? `#${timeline.slackThread.channelName}`
                  : timeline.slackThread.channelId
              }
              subtitle={
                slackMessageCount > 1
                  ? `${slackMessageCount} messages`
                  : truncateSingleLine(timeline.slackThread.messages[0]?.text ?? "Thread", 100)
              }
              sourceLabel={decisionSourceLabelSlack(
                timeline.slackThread.channelName ?? timeline.slackThread.channelId
              )}
              sectionDomId={evidenceSectionDomId(
                artifactId,
                decisionSourceLabelSlack(
                  timeline.slackThread.channelName ?? timeline.slackThread.channelId
                )
              )}
              open={expanded.slack}
              onToggle={() => toggle("slack")}
              link={timeline.slackThread.permalink}
              linkLabel="Open in Slack"
            >
              <ExpandableMessageList
                messages={timeline.slackThread.messages.map((m) => ({
                  user: m.user,
                  text: m.text,
                  time: m.ts
                }))}
                previewCount={2}
              />
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {timeline.teamsThread ? (
          <EvidenceConnectionGroup
            connection="teams"
            briefSummary={{
              title: "Thread",
              sourceLabel: decisionSourceLabelTeams()
            }}
          >
            <IntegrationResultCollapsible
              title="Thread"
              provider="teams"
              destination="Thread"
              subtitle={
                teamsMessageCount > 1
                  ? `${teamsMessageCount} messages`
                  : truncateSingleLine(timeline.teamsThread.messages[0]?.text ?? "Thread", 100)
              }
              sourceLabel={decisionSourceLabelTeams()}
              sectionDomId={evidenceSectionDomId(artifactId, decisionSourceLabelTeams())}
              open={expanded.teams}
              onToggle={() => toggle("teams")}
            >
              <ExpandableMessageList
                messages={timeline.teamsThread.messages.map((m) => ({
                  user: m.user,
                  text: m.text,
                  time: m.date
                }))}
                previewCount={2}
              />
            </IntegrationResultCollapsible>
          </EvidenceConnectionGroup>
        ) : null}

        {jiraTickets.length > 0 ? (
          <EvidenceConnectionGroup
            connection="jira"
            briefSummary={{
              title: jiraTickets.length === 1 ? jiraTickets[0].key : "Jira tickets",
              sourceLabel:
                jiraTickets.length === 1
                  ? decisionSourceLabelJira(jiraTickets[0].key)
                  : undefined
            }}
          >
            {jiraTickets.length === 1 ? (
              <IntegrationResultCollapsible
                title={jiraTickets[0].key}
                provider="jira"
                destination={jiraTickets[0].key}
                subtitle={jiraTickets[0].summary}
                sourceLabel={decisionSourceLabelJira(jiraTickets[0].key)}
                sectionDomId={evidenceSectionDomId(
                  artifactId,
                  decisionSourceLabelJira(jiraTickets[0].key)
                )}
                open={expanded.jiraGroup}
                onToggle={() => toggle("jiraGroup")}
                link={jiraTickets[0].htmlUrl}
                linkLabel="Open in Jira"
              >
                <JiraBlock ticket={jiraTickets[0]} />
              </IntegrationResultCollapsible>
            ) : (
              <IntegrationResultCollapsible
                title="Jira tickets"
                provider="jira"
                destination={`${jiraTickets.length} tickets`}
                subtitle={jiraTickets.map((ticket) => ticket.key).join(", ")}
                open={expanded.jiraGroup}
                onToggle={() => toggle("jiraGroup")}
              >
                <div className="space-y-2">
                  {jiraTickets.map((ticket) => (
                    <IntegrationResultNested key={ticket.key}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="coop-result-text font-medium">{ticket.key}</p>
                          <p className="text-[11px] text-[var(--coop-panel-muted)]">{ticket.summary}</p>
                          <span className="coop-result-source-cite">{decisionSourceLabelJira(ticket.key)}</span>
                        </div>
                        {ticket.htmlUrl ? (
                          <ChatActionLink
                            kind="external"
                            label="Open in Jira"
                            className="coop-result-collapsible-link shrink-0"
                            onClick={() => onOpenLink?.(ticket.htmlUrl!)}
                          />
                        ) : null}
                      </div>
                      <JiraBlock ticket={ticket} compact />
                    </IntegrationResultNested>
                  ))}
                </div>
              </IntegrationResultCollapsible>
            )}
          </EvidenceConnectionGroup>
        ) : null}

        {detailWarnings.length > 0 ? (
          <EvidenceDerivedGroup title="Warnings">
            <ul className="list-disc space-y-1 pl-4">
              {detailWarnings.map((warning) => (
                <li key={warning} className="coop-result-text coop-result-text--muted">
                  {warning}
                </li>
              ))}
            </ul>
          </EvidenceDerivedGroup>
        ) : null}
      </EvidenceConnectionStack>
    </EvidenceCardShell>
  );
}

function ChronologyView({ events }: { events: DecisionTimelineData["chronology"] }): React.ReactElement | null {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="pb-2 pt-2.5">
      <p className="coop-result-section-label">Timeline</p>
      <ol className="coop-result-timeline">
        {events.map((event, index) => (
          <li key={`${event.date}-${index}`} className="relative">
            <span className="coop-result-timeline-dot" aria-hidden="true" />
            <p className="text-[10px] text-[var(--coop-panel-muted)]">{formatDate(event.date)}</p>
            <p className="font-medium">{event.event}</p>
            <p className="text-[11px] text-[var(--coop-panel-muted)] coop-result-timeline-evidence">
              {event.actor} · {event.evidence}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CommitBlock({ commit }: { commit: NonNullable<DecisionTimelineData["originalCommit"]> }): React.ReactElement {
  return <IntegrationResultCode>{commit.message}</IntegrationResultCode>;
}

function PrBlock({
  pr,
  reviewsOpen,
  onToggleReviews
}: {
  pr: NonNullable<DecisionTimelineData["linkedPR"]>;
  reviewsOpen: boolean;
  onToggleReviews: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <IntegrationResultText muted>
        State: {pr.state}
        {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
      </IntegrationResultText>
      {pr.approvers.length > 0 ? (
        <IntegrationResultText muted>Approvers: {pr.approvers.join(", ")}</IntegrationResultText>
      ) : null}
      {pr.description ? <IntegrationResultCode>{pr.description}</IntegrationResultCode> : null}
      {pr.reviews.length > 0 ? (
        <IntegrationResultCollapsible
          title={`Review comments (${pr.reviews.length})`}
          subtitle={reviewsOpen ? undefined : `@${pr.reviews[0]?.author} and others`}
          open={reviewsOpen}
          onToggle={onToggleReviews}
        >
          <ul className="space-y-2">
            {pr.reviews.slice(0, 12).map((review) => (
              <li key={review.id}>
                <IntegrationResultNested>
                  <p className="text-[10px] text-[var(--coop-panel-muted)]">
                    @{review.author}
                    {review.path ? ` · ${review.path}:${review.line ?? "?"}` : ""} · {formatDate(review.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap coop-result-message-text">{review.body}</p>
                </IntegrationResultNested>
              </li>
            ))}
          </ul>
          {pr.reviews.length > 12 ? (
            <IntegrationResultText muted>
              {pr.reviews.length - 12} more comments not shown.
            </IntegrationResultText>
          ) : null}
        </IntegrationResultCollapsible>
      ) : null}
    </div>
  );
}

function JiraBlock({
  ticket,
  compact = false
}: {
  ticket: import("../types/decisionTimeline").DecisionJiraTicket;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      {!compact ? <p className="coop-result-text font-medium">{ticket.summary}</p> : null}
      {ticket.epic ? <IntegrationResultText muted>Epic: {ticket.epic}</IntegrationResultText> : null}
      {ticket.technicalDebt ? (
        <IntegrationResultBadge tone="warning">Marked as technical debt</IntegrationResultBadge>
      ) : null}
      {ticket.acceptanceCriteria.length > 0 ? (
        <div>
          <p className="coop-result-section-label">Acceptance criteria</p>
          <ul className="list-disc pl-4">
            {ticket.acceptanceCriteria.map((item) => (
              <li key={item} className="coop-result-text">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!compact && ticket.description ? <IntegrationResultCode>{ticket.description}</IntegrationResultCode> : null}
    </div>
  );
}

function AlternativesList({
  alternatives
}: {
  alternatives: DecisionTimelineData["alternatives"];
}): React.ReactElement {
  return (
    <ul className="space-y-2">
      {alternatives.map((alt, index) => (
        <li key={`${alt.option}-${index}`}>
          <IntegrationResultNested>
            <p className="coop-result-text font-medium">{alt.option}</p>
            <IntegrationResultText muted>Rejected: {alt.reason_rejected}</IntegrationResultText>
            <IntegrationResultText muted>
              {alt.proposed_by} · {alt.source}
            </IntegrationResultText>
          </IntegrationResultNested>
        </li>
      ))}
    </ul>
  );
}

function ExpandableMessageList({
  messages,
  previewCount = 2
}: {
  messages: Array<{ user: string; text: string; time: string }>;
  previewCount?: number;
}): React.ReactElement {
  const [showAll, setShowAll] = useState(messages.length <= previewCount);
  const visible = showAll ? messages : messages.slice(0, previewCount);
  const hiddenCount = messages.length - previewCount;

  return (
    <div className="space-y-2">
      <ul className="coop-result-message-list space-y-2">
        {visible.map((message, index) => (
          <li key={`${message.time}-${index}`}>
            <IntegrationResultNested>
              <p className="coop-result-message-meta">
                @{message.user} · {formatDate(message.time)}
              </p>
              <p className="mt-1 whitespace-pre-wrap coop-result-message-text">{message.text}</p>
            </IntegrationResultNested>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="coop-text-btn text-[11px]"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show fewer messages" : `Show ${hiddenCount} more message${hiddenCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  );
}

function collectDecisionMakers(timeline: DecisionTimelineData): string[] {
  const makers = new Set<string>();
  if (timeline.originalCommit?.author) {
    makers.add(timeline.originalCommit.author);
  }
  timeline.linkedPR?.approvers.forEach((a) => makers.add(`@${a.replace(/^@/, "")}`));
  timeline.slackThread?.participants.forEach((p) => makers.add(p));
  timeline.teamsThread?.participants.forEach((p) => makers.add(p));
  return [...makers].slice(0, 12);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function truncateSingleLine(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

