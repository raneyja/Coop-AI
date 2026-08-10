import React from "react";
import { resolveEvidenceBodyPreview } from "../../context/evidenceBodyPreview";
import { IntegrationResultText } from "../components/IntegrationResultCard";

/**
 * Universal Sources expand body: short overview only — never a full dump.
 * Outbound deep-read links live on the collapsible header (`View commit`, etc.).
 */
export function EvidenceSourcePreview({
  overview,
  rawText,
  emptyLabel = "No preview available."
}: {
  overview?: string;
  rawText?: string;
  emptyLabel?: string;
}): React.ReactElement {
  const preview = resolveEvidenceBodyPreview({ overview, rawText });
  if (!preview) {
    return <IntegrationResultText muted>{emptyLabel}</IntegrationResultText>;
  }
  return (
    <div className="space-y-1.5">
      <p className="coop-result-text whitespace-pre-wrap">{preview}</p>
      <p className="coop-result-text coop-result-text--muted text-[10px]">
        Short overview — open the source link for the full record.
      </p>
    </div>
  );
}
