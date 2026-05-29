import React, { useMemo, useState } from "react";
import type { DecisionTimeline as DecisionTimelineData } from "../types/decisionTimeline";

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

  const toggle = (id: SectionId) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section
      className="mx-3 mb-3 rounded-md border text-xs shadow-sm"
      style={{
        borderColor: "var(--vscode-widget-border)",
        background: "var(--vscode-editorWidget-background)",
        color: "var(--coop-panel-foreground)"
      }}
      aria-label="Decision archaeology timeline"
    >
      <header className="flex items-start justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
        <div className="min-w-0">
          <p className="font-medium">Decision archaeology</p>
          <p className="mt-0.5 truncate text-[11px] opacity-80">
            {timeline.file}
            {timeline.lineRange
              ? ` · lines ${timeline.lineRange.start}${timeline.lineRange.end !== timeline.lineRange.start ? `–${timeline.lineRange.end}` : ""}`
              : ""}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">
            {COMPLETENESS_LABEL[timeline.completeness]}
          </p>
        </div>
        {onDismiss ? (
          <button type="button" className="shrink-0 text-[11px] opacity-75 hover:opacity-100" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </header>

      {timeline.narrative ? (
        <div className="border-b px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: "var(--vscode-widget-border)" }}>
          <p className="mb-1 font-medium">Summary</p>
          <div className="whitespace-pre-wrap opacity-90">{timeline.narrative}</div>
        </div>
      ) : null}

      {decisionMakers.length > 0 ? (
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">Key decision makers</p>
          <div className="flex flex-wrap gap-1">
            {decisionMakers.map((person) => (
              <span
                key={person}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  background: "var(--vscode-badge-background)",
                  color: "var(--vscode-badge-foreground)"
                }}
              >
                {person}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto px-3 py-2">
        <ChronologyView events={timeline.chronology} />

        {timeline.codeSnippet ? (
          <CollapsibleSection
            id="code"
            title="Code under investigation"
            expanded={expanded.code}
            onToggle={toggle}
          >
            <pre
              className="mt-1 overflow-x-auto rounded p-2 text-[10px] leading-snug"
              style={{
                background: "var(--vscode-textCodeBlock-background)",
                border: "1px solid var(--vscode-widget-border)"
              }}
            >
              {timeline.codeSnippet}
            </pre>
          </CollapsibleSection>
        ) : null}

        {timeline.originalCommit ? (
          <CollapsibleSection
            id="commit"
            title="Original commit"
            expanded={expanded.commit}
            onToggle={toggle}
            link={timeline.originalCommit.htmlUrl}
            linkLabel={timeline.originalCommit.sha.slice(0, 7)}
          >
            <CommitBlock commit={timeline.originalCommit} />
          </CollapsibleSection>
        ) : timeline.fallbackMessage ? (
          <p className="mt-2 text-[11px] opacity-80">{timeline.fallbackMessage}</p>
        ) : null}

        {timeline.linkedPR ? (
          <CollapsibleSection
            id="pr"
            title={`PR #${timeline.linkedPR.number}: ${timeline.linkedPR.title}`}
            expanded={expanded.pr}
            onToggle={toggle}
            link={timeline.linkedPR.htmlUrl}
            linkLabel={`PR #${timeline.linkedPR.number}`}
          >
            <PrBlock pr={timeline.linkedPR} />
          </CollapsibleSection>
        ) : null}

        {timeline.slackThread ? (
          <CollapsibleSection
            id="slack"
            title={`Slack · #${timeline.slackThread.channelName ?? timeline.slackThread.channelId}`}
            expanded={expanded.slack}
            onToggle={toggle}
            link={timeline.slackThread.permalink}
            linkLabel="Open thread"
          >
            <MessageList messages={timeline.slackThread.messages.map((m) => ({ user: m.user, text: m.text, time: m.ts }))} />
          </CollapsibleSection>
        ) : null}

        {timeline.teamsThread ? (
          <CollapsibleSection
            id="teams"
            title="Microsoft Teams thread"
            expanded={expanded.teams}
            onToggle={toggle}
          >
            <MessageList messages={timeline.teamsThread.messages.map((m) => ({ user: m.user, text: m.text, time: m.date }))} />
          </CollapsibleSection>
        ) : null}

        {timeline.jiraTicket ? (
          <CollapsibleSection
            id="jira"
            title={`Jira ${timeline.jiraTicket.key}`}
            expanded={expanded.jira}
            onToggle={toggle}
            link={timeline.jiraTicket.htmlUrl}
            linkLabel={timeline.jiraTicket.key}
          >
            <JiraBlock ticket={timeline.jiraTicket} />
          </CollapsibleSection>
        ) : null}

        {timeline.alternatives.length > 0 ? (
          <CollapsibleSection
            id="alternatives"
            title={`Alternatives considered (${timeline.alternatives.length})`}
            expanded={expanded.alternatives}
            onToggle={toggle}
          >
            <AlternativesList alternatives={timeline.alternatives} />
          </CollapsibleSection>
        ) : null}

        {timeline.warnings.length > 0 ? (
          <CollapsibleSection
            id="warnings"
            title={`Warnings (${timeline.warnings.length})`}
            expanded={expanded.warnings}
            onToggle={toggle}
          >
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] opacity-90">
              {timeline.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CollapsibleSection>
        ) : null}
      </div>
    </section>
  );
}

function ChronologyView({ events }: { events: DecisionTimelineData["chronology"] }): React.ReactElement | null {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide opacity-70">Timeline</p>
      <ol className="relative space-y-2 border-l pl-3" style={{ borderColor: "var(--vscode-widget-border)" }}>
        {events.map((event, index) => (
          <li key={`${event.date}-${index}`} className="relative">
            <span
              className="absolute -left-[13px] top-1 h-2 w-2 rounded-full"
              style={{ background: "var(--vscode-focusBorder)" }}
              aria-hidden="true"
            />
            <p className="text-[10px] opacity-70">{formatDate(event.date)}</p>
            <p className="font-medium">{event.event}</p>
            <p className="text-[11px] opacity-80">
              {event.actor} · <span className="opacity-70">{truncate(event.evidence, 100)}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  expanded,
  onToggle,
  link,
  linkLabel,
  children
}: {
  id: SectionId;
  title: string;
  expanded: boolean;
  onToggle: (id: SectionId) => void;
  link?: string;
  linkLabel?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
          onClick={() => onToggle(id)}
          aria-expanded={expanded}
        >
          <span className="opacity-70" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="truncate">{title}</span>
        </button>
        {link ? (
          <a
            href={link}
            className="shrink-0 text-[10px] underline opacity-80 hover:opacity-100"
            target="_blank"
            rel="noreferrer"
          >
            {linkLabel ?? "Open"}
          </a>
        ) : null}
      </div>
      {expanded ? children : null}
    </div>
  );
}

function CommitBlock({ commit }: { commit: NonNullable<DecisionTimelineData["originalCommit"]> }): React.ReactElement {
  return (
    <div className="mt-1 space-y-1 text-[11px]">
      <p>
        <span className="opacity-70">Author:</span> {commit.author}
      </p>
      <p>
        <span className="opacity-70">Date:</span> {formatDate(commit.date)}
      </p>
      <pre
        className="whitespace-pre-wrap rounded p-2 text-[10px]"
        style={{ background: "var(--vscode-textCodeBlock-background)" }}
      >
        {commit.message}
      </pre>
    </div>
  );
}

function PrBlock({ pr }: { pr: NonNullable<DecisionTimelineData["linkedPR"]> }): React.ReactElement {
  return (
    <div className="mt-1 space-y-2 text-[11px]">
      <p className="opacity-80">
        State: {pr.state}
        {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
      </p>
      {pr.approvers.length > 0 ? (
        <p>
          <span className="opacity-70">Approvers:</span> {pr.approvers.join(", ")}
        </p>
      ) : null}
      {pr.description ? (
        <pre className="whitespace-pre-wrap rounded p-2 text-[10px] opacity-90" style={{ background: "var(--vscode-textCodeBlock-background)" }}>
          {truncate(pr.description, 1200)}
        </pre>
      ) : null}
      {pr.reviews.length > 0 ? (
        <div>
          <p className="mb-1 font-medium">Review comments</p>
          <ul className="space-y-2">
            {pr.reviews.slice(0, 12).map((review) => (
              <li
                key={review.id}
                className="rounded border p-2"
                style={{ borderColor: "var(--vscode-widget-border)" }}
              >
                <p className="text-[10px] opacity-70">
                  @{review.author}
                  {review.path ? ` · ${review.path}:${review.line ?? "?"}` : ""} · {formatDate(review.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{truncate(review.body, 500)}</p>
              </li>
            ))}
          </ul>
          {pr.reviews.length > 12 ? (
            <p className="mt-1 text-[10px] opacity-70">{pr.reviews.length - 12} more comments not shown.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JiraBlock({ ticket }: { ticket: NonNullable<DecisionTimelineData["jiraTicket"]> }): React.ReactElement {
  return (
    <div className="mt-1 space-y-1 text-[11px]">
      <p className="font-medium">{ticket.summary}</p>
      {ticket.epic ? (
        <p>
          <span className="opacity-70">Epic:</span> {ticket.epic}
        </p>
      ) : null}
      {ticket.technicalDebt ? (
        <p className="text-[10px]" style={{ color: "var(--vscode-inputValidation-warningForeground)" }}>
          Marked as technical debt
        </p>
      ) : null}
      {ticket.acceptanceCriteria.length > 0 ? (
        <div>
          <p className="mb-0.5 opacity-70">Acceptance criteria</p>
          <ul className="list-disc pl-4">
            {ticket.acceptanceCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {ticket.description ? (
        <pre className="whitespace-pre-wrap rounded p-2 text-[10px] opacity-90" style={{ background: "var(--vscode-textCodeBlock-background)" }}>
          {truncate(ticket.description, 800)}
        </pre>
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
    <ul className="mt-1 space-y-2">
      {alternatives.map((alt, index) => (
        <li
          key={`${alt.option}-${index}`}
          className="rounded border p-2 text-[11px]"
          style={{ borderColor: "var(--vscode-widget-border)" }}
        >
          <p className="font-medium">{alt.option}</p>
          <p className="mt-0.5 opacity-80">Rejected: {alt.reason_rejected}</p>
          <p className="mt-0.5 text-[10px] opacity-60">
            {alt.proposed_by} · {alt.source}
          </p>
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
    <ul className="mt-1 max-h-48 space-y-2 overflow-y-auto">
      {messages.map((message, index) => (
        <li
          key={`${message.time}-${index}`}
          className="rounded border p-2 text-[11px]"
          style={{ borderColor: "var(--vscode-widget-border)" }}
        >
          <p className="text-[10px] opacity-70">
            @{message.user} · {formatDate(message.time)}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap">{truncate(message.text, 400)}</p>
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
  if (timeline.jiraTicket?.key) {
    /* reporter stored in chronology only */
  }
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
