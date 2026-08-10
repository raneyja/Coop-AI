import React from "react";
import type { ConflictSummary } from "../webview/types";
import { sourceCitationAnchor } from "../prompts/sourceCitationRegistry";
import {
  EvidenceTargetMeta,
  resolveEvidenceTargetMetaLabel
} from "./EvidenceRichDetail";
import {
  IntegrationResultBadge,
  IntegrationResultCard,
  IntegrationResultSection,
  IntegrationResultStack
} from "./components/IntegrationResultCard";
import {
  IntegrationSourceChip,
  type IntegrationSourceId
} from "./components/IntegrationSourceBrand";
import { EvidenceSectionsIntro } from "./EvidenceSectionsIntro";
import { EvidenceConflictCallout } from "./EvidenceConflictCallout";
import {
  type EvidenceCardSummary,
  type EvidenceQuality
} from "./evidenceCardSummary";
import type { EvidenceActionContext } from "./evidenceCardActionHandler";

export type EvidenceCardSource =
  | { provider: IntegrationSourceId; detail?: string }
  | { label: string };

export type EvidenceCardShellProps = {
  artifactId: string;
  title: string;
  meta?: string;
  summary?: EvidenceCardSummary;
  actionContext: EvidenceActionContext;
  sources: EvidenceCardSource[];
  statusTone?: "default" | "partial" | "minimal" | "warning";
  statusLabel?: string;
  conflicts?: ConflictSummary[];
  children: React.ReactNode;
};

export function EvidenceCardShell({
  title,
  meta,
  summary,
  sources,
  statusTone = "default",
  statusLabel,
  conflicts,
  children
}: EvidenceCardShellProps): React.ReactElement {
  // Summary quality always wins over caller-supplied statusTone/statusLabel (e.g. completeness).
  const resolved = resolveEvidenceCardHeaderStatus({ summary, statusTone, statusLabel, sources });
  const headerMetaLabel = resolveEvidenceTargetMetaLabel(meta, summary?.target);

  return (
    <IntegrationResultStack>
      <IntegrationResultCard
        title={title}
        meta={headerMetaLabel ? <EvidenceTargetMeta label={headerMetaLabel} /> : undefined}
        status={resolved.status}
        statusTone={resolved.statusTone}
        ariaLabel={`${title} sources`}
      >
        {!summary && sources.length > 0 ? (
          <IntegrationResultSection label="Connected sources" className="!border-b coop-result-sources-bar">
            <div className="coop-source-chip-row">
              {sources.map((source, index) =>
                "provider" in source ? (
                  <IntegrationSourceChip
                    key={`${source.provider}-${index}`}
                    provider={source.provider}
                    detail={source.detail}
                  />
                ) : (
                  <IntegrationResultBadge key={`${source.label}-${index}`} tone="info">
                    {source.label}
                  </IntegrationResultBadge>
                )
              )}
            </div>
          </IntegrationResultSection>
        ) : null}

        {conflicts && conflicts.length > 0 ? (
          <EvidenceConflictCallout conflicts={conflicts} />
        ) : null}

        <IntegrationResultSection className="coop-result-evidence-body">
          <EvidenceSectionsIntro />
          {children}
        </IntegrationResultSection>
      </IntegrationResultCard>
    </IntegrationResultStack>
  );
}

function qualityStatusTone(quality: EvidenceQuality): "default" | "partial" | "minimal" | "warning" {
  switch (quality) {
    case "strong":
      return "default";
    case "medium":
      return "partial";
    case "weak":
      return "minimal";
    case "limited":
      return "warning";
  }
}

export function qualityStatusLabel(quality: EvidenceQuality): string {
  switch (quality) {
    case "strong":
      return "Strong evidence";
    case "medium":
      return "Medium evidence";
    case "weak":
      return "Weak evidence";
    case "limited":
      return "Limited evidence";
  }
}

/** Header status for evidence cards — summary.quality beats completeness-driven props. */
export function resolveEvidenceCardHeaderStatus(input: {
  summary?: EvidenceCardSummary;
  statusTone?: "default" | "partial" | "minimal" | "warning";
  statusLabel?: string;
  sources: EvidenceCardSource[];
}): { status: string; statusTone: "default" | "partial" | "minimal" | "warning" } {
  if (input.summary) {
    return {
      status: qualityStatusLabel(input.summary.quality),
      statusTone: qualityStatusTone(input.summary.quality)
    };
  }
  return {
    status:
      input.statusLabel ??
      (input.sources.length > 0
        ? `${input.sources.length} connected source${input.sources.length === 1 ? "" : "s"}`
        : "Limited evidence"),
    statusTone: input.statusTone ?? "default"
  };
}

export function evidenceSectionDomId(artifactId: string, sourceLabel: string): string {
  return sourceCitationAnchor(artifactId, sourceLabel);
}
