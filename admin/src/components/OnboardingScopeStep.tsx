"use client";

import { INTEGRATIONS, SCOPABLE_PROVIDERS } from "@/lib/integrations";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations";
import { IntegrationScopePanel } from "./IntegrationScopePanel";
import { StatusBadge } from "./StatusBadge";

type OnboardingScopeStepProps = {
  integrations: IntegrationStatus[];
  orgPlan: string;
  onRefresh: (provider: IntegrationProvider) => void;
};

export function OnboardingScopeStep({ integrations, orgPlan, onRefresh }: OnboardingScopeStepProps) {
  const enterprise = orgPlan === "enterprise";
  const scopable = INTEGRATIONS.filter((def) =>
    SCOPABLE_PROVIDERS.includes(def.id as (typeof SCOPABLE_PROVIDERS)[number])
  );
  const connectedScopable = scopable.filter((def) => {
    const status = integrations.find((i) => i.provider === def.id);
    return status?.installed && !status.needsReconnect;
  });

  if (!enterprise) {
    return (
      <p className="text-sm text-coop-muted">No Enterprise scope configuration needed for your plan.</p>
    );
  }

  if (connectedScopable.length === 0) {
    return (
      <p className="text-sm text-coop-muted">
        No scopable integrations connected yet. Connect Slack on the previous step to configure channel access.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {connectedScopable.map((def) => {
        const status = integrations.find((i) => i.provider === def.id);
        return (
          <div key={def.id} className="rounded-lg border border-coop-border/50 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="font-medium text-white">{def.name}</h4>
              {status?.scopeStatus === "active" ? (
                <StatusBadge connected label="Active" />
              ) : status?.scopeStatus === "required" ? (
                <StatusBadge connected={false} label="Scope required" showWhenDisconnected />
              ) : null}
            </div>
            <IntegrationScopePanel
              provider={def.id}
              orgPlan={orgPlan}
              connected
              onSaved={() => onRefresh(def.id)}
            />
          </div>
        );
      })}
      <p className="text-xs text-coop-muted">
        Jira, Notion, and Google Docs scope controls are coming soon.
      </p>
    </div>
  );
}
