import React, { useMemo, useState } from "react";
import type { OwnershipReport, OwnershipRisk, OwnershipScore } from "../types/ownership";

export type OwnershipCardPayload = OwnershipReport & {
  narrative?: string;
};

type OwnershipCardProps = {
  report: OwnershipCardPayload;
  onDismiss?: () => void;
  onCopyDraft?: (text: string) => void;
};

const COMPLETENESS_LABEL: Record<OwnershipReport["completeness"], string> = {
  full: "Full analysis",
  partial: "Partial analysis",
  minimal: "Minimal analysis"
};

const RISK_LABELS: Record<keyof OwnershipRisk, string> = {
  singlePointOfFailure: "Single point of failure",
  expertUnavailable: "All experts unavailable",
  orphaned: "Orphaned (no recent commits)",
  highTurnover: "High turnover",
  teamDispersion: "Expertise dispersed"
};

export function OwnershipCard({
  report,
  onDismiss,
  onCopyDraft
}: OwnershipCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState({ history: false, draft: false });
  const { primary, secondary, backup } = useMemo(() => groupExperts(report.scores), [report.scores]);
  const activeRisks = useMemo(
    () => (Object.entries(report.risk) as Array<[keyof OwnershipRisk, boolean]>).filter(([, v]) => v),
    [report.risk]
  );

  return (
    <section
      className="mx-3 mb-3 rounded-md border text-xs shadow-sm"
      style={{
        borderColor: "var(--vscode-widget-border)",
        background: "var(--vscode-editorWidget-background)",
        color: "var(--coop-panel-foreground)"
      }}
      aria-label="Ownership analysis"
    >
      <header
        className="flex items-start justify-between gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--vscode-widget-border)" }}
      >
        <div className="min-w-0">
          <p className="font-medium">Code ownership</p>
          <p className="mt-0.5 truncate text-[11px] opacity-80">
            {report.owner}/{report.repo} · {report.path}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">
            {COMPLETENESS_LABEL[report.completeness]}
          </p>
        </div>
        {onDismiss ? (
          <button type="button" className="shrink-0 text-[11px] opacity-75 hover:opacity-100" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </header>

      {report.narrative ? (
        <div
          className="border-b px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: "var(--vscode-widget-border)" }}
        >
          <p className="mb-1 font-medium">Summary</p>
          <div className="whitespace-pre-wrap opacity-90">{report.narrative}</div>
        </div>
      ) : null}

      <div className="border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide opacity-70">Experts</p>
        <div className="space-y-2">
          {primary ? <ExpertRow label="Primary" expert={primary} onCopyDraft={onCopyDraft} draft={report.messageDraft} /> : null}
          {secondary.map((expert) => (
            <ExpertRow key={expert.owner} label="Secondary" expert={expert} />
          ))}
          {backup.slice(0, 2).map((expert) => (
            <ExpertRow key={expert.owner} label="Backup" expert={expert} />
          ))}
          {!primary && report.scores.length === 0 ? (
            <p className="text-[11px] opacity-70">No clear owners identified from available signals.</p>
          ) : null}
        </div>
      </div>

      {activeRisks.length > 0 ? (
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">Risk flags</p>
          <div className="flex flex-wrap gap-1">
            {activeRisks.map(([key]) => (
              <span
                key={key}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  background: "var(--vscode-inputValidation-warningBackground)",
                  color: "var(--vscode-inputValidation-warningForeground)"
                }}
              >
                {RISK_LABELS[key]}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {report.orgContext ? (
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">Team</p>
          <p className="text-[11px]">
            Owned by{" "}
            {report.orgContext.htmlUrl ? (
              <a href={report.orgContext.htmlUrl} className="underline opacity-90">
                @{report.orgContext.teamName}
              </a>
            ) : (
              <span className="opacity-90">@{report.orgContext.teamName}</span>
            )}
          </p>
          {report.orgContext.members.length > 0 ? (
            <p className="mt-1 text-[10px] opacity-75">Members: {report.orgContext.members.join(", ")}</p>
          ) : null}
          {report.orgContext.slackChannel ? (
            <p className="mt-1 text-[10px] opacity-75">Slack: {report.orgContext.slackChannel}</p>
          ) : null}
        </div>
      ) : null}

      <div className="border-b px-3 py-2" style={{ borderColor: "var(--vscode-widget-border)" }}>
        <p className="text-[11px] opacity-90">{report.teamGraph.escalationPath}</p>
        {report.teamGraph.crossTeamNote ? (
          <p className="mt-1 text-[10px] opacity-75">{report.teamGraph.crossTeamNote}</p>
        ) : null}
      </div>

      {report.history.length > 0 ? (
        <CollapsibleSection
          title="Ownership evolution"
          open={expanded.history}
          onToggle={() => setExpanded((s) => ({ ...s, history: !s.history }))}
        >
          <ul className="space-y-1 text-[11px] opacity-90">
            {report.history.map((entry) => (
              <li key={entry.period}>
                <span className="font-medium">{entry.label}:</span> {entry.narrative}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

      {report.messageDraft.text ? (
        <CollapsibleSection
          title="Message draft"
          open={expanded.draft}
          onToggle={() => setExpanded((s) => ({ ...s, draft: !s.draft }))}
        >
          <pre className="whitespace-pre-wrap rounded p-2 text-[10px] opacity-90" style={{ background: "var(--vscode-textBlockQuote-background)" }}>
            {report.messageDraft.text}
          </pre>
          {onCopyDraft ? (
            <button
              type="button"
              className="mt-2 rounded px-2 py-1 text-[11px]"
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)"
              }}
              onClick={() => onCopyDraft(report.messageDraft.text)}
            >
              Message {report.messageDraft.recipient}
            </button>
          ) : null}
        </CollapsibleSection>
      ) : null}

      {report.warnings.length > 0 ? (
        <div className="px-3 py-2 text-[10px] opacity-75">
          {report.warnings.map((warning) => (
            <p key={warning}>· {warning}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ExpertRow({
  label,
  expert,
  onCopyDraft,
  draft
}: {
  label: string;
  expert: OwnershipScore;
  onCopyDraft?: (text: string) => void;
  draft?: OwnershipReport["messageDraft"];
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px]">
          <span className="opacity-70">{label}:</span>{" "}
          <span className="font-medium">@{expert.owner}</span>{" "}
          <span className="opacity-75">({expert.score} pts)</span>
        </p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {expert.specialty ? (
            <span
              className="rounded px-1 py-0.5 text-[10px]"
              style={{
                background: "var(--vscode-badge-background)",
                color: "var(--vscode-badge-foreground)"
              }}
            >
              {expert.specialty}
            </span>
          ) : null}
          {expert.presence ? (
            <span className="text-[10px] opacity-75">{expert.presence.label}</span>
          ) : null}
        </div>
      </div>
      {onCopyDraft && draft && label === "Primary" ? (
        <button
          type="button"
          className="shrink-0 rounded px-2 py-0.5 text-[10px]"
          style={{
            background: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)"
          }}
          onClick={() => onCopyDraft(draft.text)}
        >
          Message {expert.owner}
        </button>
      ) : null}
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-b" style={{ borderColor: "var(--vscode-widget-border)" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide opacity-70"
        onClick={onToggle}
      >
        {title}
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="px-3 pb-2">{children}</div> : null}
    </div>
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
