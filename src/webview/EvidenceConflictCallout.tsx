import React from "react";
import type { ConflictSummary } from "./types";
import {
  IntegrationResultBadge,
  IntegrationResultCard,
  IntegrationResultSection,
  IntegrationResultStack,
  IntegrationResultText
} from "./components/IntegrationResultCard";

type EvidenceConflictCalloutProps = {
  conflicts: ConflictSummary[];
  onViewAll?: () => void;
};

export function EvidenceConflictCallout({
  conflicts,
  onViewAll
}: EvidenceConflictCalloutProps): React.ReactElement {
  const visible = conflicts.slice(0, 2);
  return (
    <IntegrationResultSection label="Conflicting signals" className="!border-b">
      <IntegrationResultStack>
        {visible.map((conflict) => (
          <IntegrationResultCard
            key={conflict.id}
            title={conflict.type.replace(/_/g, " ")}
            status={conflict.severity}
            statusTone={conflict.severity === "high" || conflict.severity === "critical" ? "warning" : "partial"}
            ariaLabel={`Conflict ${conflict.type}`}
          >
            <IntegrationResultSection>
              <IntegrationResultText>{conflict.message}</IntegrationResultText>
              {conflict.authoritative ? (
                <div className="mt-1">
                  <IntegrationResultBadge tone="info">
                    Prefer {conflict.authoritative.source}
                  </IntegrationResultBadge>
                </div>
              ) : null}
            </IntegrationResultSection>
          </IntegrationResultCard>
        ))}
        {conflicts.length > visible.length ? (
          <IntegrationResultText muted>
            {conflicts.length - visible.length} more conflict(s) in the panel below.
          </IntegrationResultText>
        ) : null}
        {onViewAll ? (
          <button type="button" className="coop-text-btn" onClick={onViewAll}>
            View all conflicts
          </button>
        ) : null}
      </IntegrationResultStack>
    </IntegrationResultSection>
  );
}
