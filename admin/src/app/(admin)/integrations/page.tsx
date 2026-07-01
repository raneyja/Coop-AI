"use client";

import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "@/components/IntegrationsStep";

export default function IntegrationsPage() {
  const {
    integrations,
    orgPlan,
    initialLoading,
    refreshingProvider,
    refreshSuccessProvider,
    error,
    load
  } = useIntegrations();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Integrations</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Connect tools your team uses. OAuth opens in a new tab — return here and refresh status.
        </p>
      </div>

      <IntegrationsStep
        integrations={integrations}
        orgPlan={orgPlan}
        initialLoading={initialLoading}
        refreshingProvider={refreshingProvider}
        refreshSuccessProvider={refreshSuccessProvider}
        error={error}
        onRefresh={(provider) => void load({ provider })}
        showFullPageLink={false}
        hideIntro
      />
    </div>
  );
}
