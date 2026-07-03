"use client";

import { getStoredMe, isMemberRole } from "@/lib/auth";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "@/components/IntegrationsStep";

export default function IntegrationsPage() {
  const me = getStoredMe();
  const readOnly = me ? isMemberRole(me) : false;
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
          {readOnly
            ? "Organization tools connected by your admin. Link your personal accounts in the VS Code extension."
            : "Connect tools your team uses. Pro and Enterprise orgs install the GitHub App; Free uses OAuth. Return here and refresh status after approving access."}
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
        readOnly={readOnly}
      />
    </div>
  );
}
