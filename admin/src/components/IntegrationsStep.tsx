"use client";

import Link from "next/link";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations";
import { IntegrationCard } from "./IntegrationCard";

type IntegrationsStepProps = {
  integrations: IntegrationStatus[];
  orgPlan: string;
  initialLoading: boolean;
  refreshingProvider: IntegrationProvider | null;
  refreshSuccessProvider: IntegrationProvider | null;
  error: string | null;
  onRefresh: (provider: IntegrationProvider) => void;
  compact?: boolean;
  showFullPageLink?: boolean;
  hideIntro?: boolean;
  readOnly?: boolean;
};

export function IntegrationsStep({
  integrations,
  orgPlan,
  initialLoading,
  refreshingProvider,
  refreshSuccessProvider,
  error,
  onRefresh,
  compact,
  showFullPageLink = true,
  hideIntro = false,
  readOnly = false
}: IntegrationsStepProps) {
  return (
    <div className="space-y-4">
      {!hideIntro ? (
        <p className="text-sm text-coop-muted">
          {readOnly
            ? "Organization tools connected by your admin. Active tools are available in the VS Code extension automatically."
            : "Connect tools your team uses. OAuth opens in a new tab — return here and refresh status."}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className={compact ? "divide-y divide-coop-border/40" : "divide-y divide-coop-border/40"}>
        {INTEGRATIONS.map((def) => (
          <IntegrationCard
            key={def.id}
            definition={def}
            status={integrations.find((s) => s.provider === def.id)}
            orgPlan={orgPlan}
            onRefresh={() => onRefresh(def.id)}
            refreshing={refreshingProvider === def.id}
            refreshSuccess={refreshSuccessProvider === def.id}
            initialLoading={initialLoading}
            compact={compact}
            readOnly={readOnly}
          />
        ))}
      </div>
      {showFullPageLink ? (
        <p className="text-xs text-coop-muted">
          <Link href="/integrations" className="admin-link">
            Open full integrations page →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
