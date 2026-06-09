import React, { useMemo, useState } from "react";
import type { OwnershipReport, OwnershipRisk, OwnershipScore } from "../types/ownership";
import { ChatActionLink } from "./components/ChatActionLink";
import { useChatLinks } from "./components/ChatLinkContext";
import {
  IntegrationResultActions,
  IntegrationResultBadge,
  IntegrationResultCard,
  IntegrationResultCode,
  IntegrationResultCollapsible,
  IntegrationResultRow,
  IntegrationResultSection,
  IntegrationResultStack,
  IntegrationResultText
} from "./components/IntegrationResultCard";

export type OwnershipCardPayload = OwnershipReport & {
  narrative?: string;
};

type OwnershipCardProps = {
  report: OwnershipCardPayload;
  onDismiss?: () => void;
  onCopyDraft?: (text: string) => void;
};

const COMPLETENESS_LABEL: Record<OwnershipReport["completeness"], string> = {
  full: "Full signals",
  partial: "Partial signals",
  minimal: "Git history only"
};

const COMPLETENESS_TONE: Record<
  OwnershipReport["completeness"],
  "default" | "partial" | "minimal"
> = {
  full: "default",
  partial: "partial",
  minimal: "minimal"
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
  const { onOpenLink } = useChatLinks();
  const [expanded, setExpanded] = useState({ history: false, draft: false });
  const { primary, secondary, backup } = useMemo(() => groupExperts(report.scores), [report.scores]);
  const activeRisks = useMemo(
    () => (Object.entries(report.risk) as Array<[keyof OwnershipRisk, boolean]>).filter(([, v]) => v),
    [report.risk]
  );

  return (
    <IntegrationResultStack>
      <IntegrationResultCard
        title="Ownership signals"
        meta={`${report.owner}/${report.repo} · ${report.path}`}
        status={COMPLETENESS_LABEL[report.completeness]}
        statusTone={COMPLETENESS_TONE[report.completeness]}
        onDismiss={onDismiss}
        ariaLabel="Ownership signals"
      >
        <IntegrationResultSection label="Experts">
          <div className="space-y-2">
            {primary ? (
              <ExpertRow
                label="Primary"
                expert={primary}
                onCopyDraft={onCopyDraft}
                draft={report.messageDraft}
              />
            ) : null}
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
        </IntegrationResultSection>

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

        {report.orgContext ? (
          <IntegrationResultSection label="Team">
            <IntegrationResultText>
              Owned by{" "}
              {report.orgContext.htmlUrl ? (
                <ChatActionLink
                  kind="external"
                  label={`@${report.orgContext.teamName}`}
                  onClick={() => onOpenLink?.(report.orgContext!.htmlUrl!)}
                />
              ) : (
                `@${report.orgContext.teamName}`
              )}
            </IntegrationResultText>
            {report.orgContext.members.length > 0 ? (
              <IntegrationResultText muted>
                Members: {report.orgContext.members.join(", ")}
              </IntegrationResultText>
            ) : null}
            {report.orgContext.slackChannel ? (
              <IntegrationResultText muted>Slack: {report.orgContext.slackChannel}</IntegrationResultText>
            ) : null}
          </IntegrationResultSection>
        ) : null}

        <IntegrationResultSection>
          <IntegrationResultText>{report.teamGraph.escalationPath}</IntegrationResultText>
          {report.teamGraph.crossTeamNote ? (
            <IntegrationResultText muted>{report.teamGraph.crossTeamNote}</IntegrationResultText>
          ) : null}
        </IntegrationResultSection>

        {report.history.length > 0 ? (
          <IntegrationResultSection className="!py-0">
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
          </IntegrationResultSection>
        ) : null}

        {report.messageDraft.text ? (
          <IntegrationResultSection className="!py-0">
            <IntegrationResultCollapsible
              title="Message draft"
              open={expanded.draft}
              onToggle={() => setExpanded((s) => ({ ...s, draft: !s.draft }))}
            >
              <IntegrationResultCode>{report.messageDraft.text}</IntegrationResultCode>
              {onCopyDraft ? (
                <IntegrationResultActions>
                  <button
                    type="button"
                    className="coop-settings-action-btn"
                    onClick={() => onCopyDraft(report.messageDraft.text)}
                  >
                    Message {report.messageDraft.recipient}
                  </button>
                </IntegrationResultActions>
              ) : null}
            </IntegrationResultCollapsible>
          </IntegrationResultSection>
        ) : null}

        {report.warnings.length > 0 ? (
          <IntegrationResultSection>
            {report.warnings.map((warning) => (
              <IntegrationResultText key={warning} muted>
                · {warning}
              </IntegrationResultText>
            ))}
          </IntegrationResultSection>
        ) : null}
      </IntegrationResultCard>
    </IntegrationResultStack>
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
    <IntegrationResultRow
      label={label}
      action={
        onCopyDraft && draft && label === "Primary" ? (
          <button
            type="button"
            className="coop-settings-action-btn"
            onClick={() => onCopyDraft(draft.text)}
          >
            Message {expert.owner}
          </button>
        ) : undefined
      }
    >
      <p>
        <span className="font-medium">@{expert.owner}</span>{" "}
        <span className="text-[var(--coop-panel-muted)]">({expert.score} pts)</span>
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {expert.specialty ? <IntegrationResultBadge tone="info">{expert.specialty}</IntegrationResultBadge> : null}
        {expert.presence ? (
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
