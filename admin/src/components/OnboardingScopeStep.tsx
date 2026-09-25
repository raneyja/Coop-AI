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

  const scopable = INTEGRATIONS.filter(
    (def) =>
      !def.comingSoon &&
      SCOPABLE_PROVIDERS.includes(def.id as (typeof SCOPABLE_PROVIDERS)[number])
  );
  const connectedScopable = scopable.filter((def) => {
    const status = integrations.find((i) => i.provider === def.id);
    return status?.installed && !status.needsReconnect;
  });

  if (connectedScopable.length === 0) {
    return (
      <div className="rounded-md border border-coop-border/70 bg-coop-dark/50 px-4 py-3.5">
        <p className="text-sm font-medium text-white">No collaboration tools connected</p>
        <p className="mt-1 text-sm leading-relaxed text-coop-muted">
          Connect Slack, Jira, Notion, or Google Docs on the previous step if you want to limit what
          Coop can search. You can also do this later from Integrations.
        </p>
      </div>
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
              Set scope
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
