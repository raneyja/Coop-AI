import React, { useMemo, useState } from "react";
import type { DecisionTimeline as DecisionTimelineData } from "../types/decisionTimeline";
import {
  IntegrationResultBadge,
  IntegrationResultCard,
  IntegrationResultCode,
  IntegrationResultCollapsible,
  IntegrationResultNested,
  IntegrationResultSection,
  IntegrationResultStack,
  IntegrationResultText
} from "./components/IntegrationResultCard";

export type DecisionTimelinePayload = DecisionTimelineData & {
  narrative?: string;
};

type DecisionTimelineProps = {
  timeline: DecisionTimelinePayload;
  onDismiss?: () => void;
};

type SectionId = "commit" | "pr" | "slack" | "teams" | "jira" | "alternatives" | "code" | "warnings";

const COMPLETENESS_LABEL: Record<DecisionTimelineData["completeness"], string> = {
  full: "Full trace",
  partial: "Partial trace",
  minimal: "Minimal trace"
};

const COMPLETENESS_TONE: Record<
  DecisionTimelineData["completeness"],
  "default" | "partial" | "minimal"
> = {
  full: "default",
  partial: "partial",
  minimal: "minimal"
};

export function DecisionTimeline({
  timeline,
  onDismiss
}: DecisionTimelineProps): React.ReactElement {
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    commit: true,
    pr: true,
    slack: false,
    teams: false,
    jira: false,
    alternatives: false,
    code: true,
    warnings: true
  });

  const decisionMakers = useMemo(() => collectDecisionMakers(timeline), [timeline]);
  const meta = [
    timeline.file,
    timeline.lineRange
      ? `lines ${timeline.lineRange.start}${
          timeline.lineRange.end !== timeline.lineRange.start ? `–${timeline.lineRange.end}` : ""
        }`
      : undefined
  ]
    .filter(Boolean)
    .join(" · ");

  const toggle = (id: SectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <IntegrationResultStack>
      <IntegrationResultCard
        title="Decision archaeology"
        meta={meta}
        status={COMPLETENESS_LABEL[timeline.completeness]}
        statusTone={COMPLETENESS_TONE[timeline.completeness]}
        onDismiss={onDismiss}
        ariaLabel="Decision archaeology timeline"
        scrollable
      >
        {timeline.narrative ? (
          <IntegrationResultSection label="Summary">
            <IntegrationResultText>{timeline.narrative}</IntegrationResultText>
          </IntegrationResultSection>
        ) : null}

        {decisionMakers.length > 0 ? (
          <IntegrationResultSection label="Key decision makers">
            <div className="flex flex-wrap gap-1.5">
              {decisionMakers.map((person) => (
                <IntegrationResultBadge key={person} tone="info">
                  {person}
                </IntegrationResultBadge>
              ))}
            </div>
          </IntegrationResultSection>
        ) : null}

        <IntegrationResultSection className="!border-b-0 !py-0">
          <ChronologyView events={timeline.chronology} />

          {timeline.codeSnippet ? (
            <IntegrationResultCollapsible
              title="Code under investigation"
              open={expanded.code}
              onToggle={() => toggle("code")}
            >
              <IntegrationResultCode>{timeline.codeSnippet}</IntegrationResultCode>
            </IntegrationResultCollapsible>
          ) : null}

          {timeline.originalCommit ? (
            <IntegrationResultCollapsible
              title="Original commit"
              open={expanded.commit}
              onToggle={() => toggle("commit")}
              link={timeline.originalCommit.htmlUrl}
              linkLabel={timeline.originalCommit.sha.slice(0, 7)}
            >
              <CommitBlock commit={timeline.originalCommit} />
            </IntegrationResultCollapsible>
          ) : timeline.fallbackMessage ? (
            <IntegrationResultText muted>{timeline.fallbackMessage}</IntegrationResultText>
          ) : null}

          {timeline.linkedPR ? (
            <IntegrationResultCollapsible
              title={`PR #${timeline.linkedPR.number}: ${timeline.linkedPR.title}`}
              open={expanded.pr}
              onToggle={() => toggle("pr")}
              link={timeline.linkedPR.htmlUrl}
              linkLabel={`PR #${timeline.linkedPR.number}`}
            >
              <PrBlock pr={timeline.linkedPR} />
            </IntegrationResultCollapsible>
          ) : null}

          {timeline.slackThread ? (
            <IntegrationResultCollapsible
              title={`Slack · #${timeline.slackThread.channelName ?? timeline.slackThread.channelId}`}
              open={expanded.slack}
              onToggle={() => toggle("slack")}
              link={timeline.slackThread.permalink}
              linkLabel="Open thread"
            >
              <MessageList
                messages={timeline.slackThread.messages.map((m) => ({
                  user: m.user,
                  text: m.text,
                  time: m.ts
                }))}
              />
            </IntegrationResultCollapsible>
          ) : null}

          {timeline.teamsThread ? (
            <IntegrationResultCollapsible
              title="Microsoft Teams thread"
              open={expanded.teams}
              onToggle={() => toggle("teams")}
            >
              <MessageList
                messages={timeline.teamsThread.messages.map((m) => ({
                  user: m.user,
                  text: m.text,
                  time: m.date
                }))}
              />
            </IntegrationResultCollapsible>
          ) : null}

          {timeline.jiraTicket ? (
            <IntegrationResultCollapsible
              title={`Jira ${timeline.jiraTicket.key}`}
              open={expanded.jira}
              onToggle={() => toggle("jira")}
              link={timeline.jiraTicket.htmlUrl}
              linkLabel={timeline.jiraTicket.key}
            >
              <JiraBlock ticket={timeline.jiraTicket} />
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

          {timeline.warnings.length > 0 ? (
            <IntegrationResultCollapsible
              title={`Warnings (${timeline.warnings.length})`}
              open={expanded.warnings}
              onToggle={() => toggle("warnings")}
            >
              <ul className="list-disc space-y-1 pl-4">
                {timeline.warnings.map((warning) => (
                  <li key={warning} className="coop-result-text">
                    {warning}
                  </li>
                ))}
              </ul>
            </IntegrationResultCollapsible>
          ) : null}
        </IntegrationResultSection>
      </IntegrationResultCard>
    </IntegrationResultStack>
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
            <p className="text-[11px] text-[var(--coop-panel-muted)]">
              {event.actor} · {truncate(event.evidence, 100)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CommitBlock({ commit }: { commit: NonNullable<DecisionTimelineData["originalCommit"]> }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <IntegrationResultText muted>
        Author: {commit.author}
      </IntegrationResultText>
      <IntegrationResultText muted>
        Date: {formatDate(commit.date)}
      </IntegrationResultText>
      <IntegrationResultCode>{commit.message}</IntegrationResultCode>
    </div>
  );
}

function PrBlock({ pr }: { pr: NonNullable<DecisionTimelineData["linkedPR"]> }): React.ReactElement {
  return (
    <div className="space-y-2">
      <IntegrationResultText muted>
        State: {pr.state}
        {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
      </IntegrationResultText>
      {pr.approvers.length > 0 ? (
        <IntegrationResultText muted>Approvers: {pr.approvers.join(", ")}</IntegrationResultText>
      ) : null}
      {pr.description ? <IntegrationResultCode>{truncate(pr.description, 1200)}</IntegrationResultCode> : null}
      {pr.reviews.length > 0 ? (
        <div>
          <p className="coop-result-section-label">Review comments</p>
          <ul className="space-y-2">
            {pr.reviews.slice(0, 12).map((review) => (
              <li key={review.id}>
                <IntegrationResultNested>
                  <p className="text-[10px] text-[var(--coop-panel-muted)]">
                    @{review.author}
                    {review.path ? ` · ${review.path}:${review.line ?? "?"}` : ""} · {formatDate(review.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{truncate(review.body, 500)}</p>
                </IntegrationResultNested>
              </li>
            ))}
          </ul>
          {pr.reviews.length > 12 ? (
            <IntegrationResultText muted>
              {pr.reviews.length - 12} more comments not shown.
            </IntegrationResultText>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JiraBlock({ ticket }: { ticket: NonNullable<DecisionTimelineData["jiraTicket"]> }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <p className="coop-result-text font-medium">{ticket.summary}</p>
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
      {ticket.description ? (
        <IntegrationResultCode>{truncate(ticket.description, 800)}</IntegrationResultCode>
      ) : null}
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

function MessageList({
  messages
}: {
  messages: Array<{ user: string; text: string; time: string }>;
}): React.ReactElement {
  return (
    <ul className="max-h-48 space-y-2 overflow-y-auto">
      {messages.map((message, index) => (
        <li key={`${message.time}-${index}`}>
          <IntegrationResultNested>
            <p className="text-[10px] text-[var(--coop-panel-muted)]">
              @{message.user} · {formatDate(message.time)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap">{truncate(message.text, 400)}</p>
          </IntegrationResultNested>
        </li>
      ))}
    </ul>
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

function truncate(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
