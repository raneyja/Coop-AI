"use client";

import { useState } from "react";
import { INTEGRATIONS, SCOPABLE_PROVIDERS } from "@/lib/integrations";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations";
import { IntegrationScopeModal } from "./IntegrationScopeModal";
import { StatusBadge } from "./StatusBadge";

type OnboardingScopeStepProps = {
  integrations: IntegrationStatus[];
  onRefresh: (provider: IntegrationProvider) => void;
};

export function OnboardingScopeStep({ integrations, onRefresh }: OnboardingScopeStepProps) {
  const [openProvider, setOpenProvider] = useState<IntegrationProvider | null>(null);

  const scopable = INTEGRATIONS.filter((def) =>
    SCOPABLE_PROVIDERS.includes(def.id as (typeof SCOPABLE_PROVIDERS)[number])
  );
  const connectedScopable = scopable.filter((def) => {
    const status = integrations.find((i) => i.provider === def.id);
    return status?.installed && !status.needsReconnect;
  });

  if (connectedScopable.length === 0) {
    return (
      <p className="text-sm text-coop-muted">
        No scopable tools connected yet. Connect Slack, Jira, Notion, or Google Docs on the previous step.
      </p>
    );
  }

  const activeDef = connectedScopable.find((def) => def.id === openProvider);

  return (
    <div className="space-y-4">
      {connectedScopable.map((def) => {
        const status = integrations.find((i) => i.provider === def.id);
        return (
          <div
            key={def.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coop-border/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-medium text-white">{def.name}</h4>
              {status?.scopeStatus === "active" ? (
                <StatusBadge connected label="Active" />
              ) : status?.scopeStatus === "required" ? (
                <StatusBadge connected={false} label="Scope required" showWhenDisconnected />
              ) : (
                <StatusBadge connected label="Connected" />
              )}
              {status?.scopeSummary ? (
                <span className="text-xs text-coop-index">{status.scopeSummary}</span>
              ) : null}
            </div>
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setOpenProvider(def.id)}
            >
              Manage access
            </button>
          </div>
        );
      })}
      {activeDef ? (
        <IntegrationScopeModal
          open={openProvider === activeDef.id}
          onClose={() => setOpenProvider(null)}
          provider={activeDef.id}
          providerName={activeDef.name}
          connected
          onSaved={() => onRefresh(activeDef.id)}
        />
      ) : null}
    </div>
  );
}
