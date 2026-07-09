"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getStoredMe, isMemberRole } from "@/lib/auth";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "@/components/IntegrationsStep";

import type { IntegrationProvider } from "@/lib/integrations";

const OAUTH_RETURN_BANNERS: Array<{
  param: string;
  label: string;
  provider?: IntegrationProvider;
}> = [
  { param: "github", label: "GitHub connected successfully.", provider: "github" },
  { param: "slack", label: "Slack connected successfully.", provider: "slack" },
  { param: "atlassian", label: "Atlassian connected successfully.", provider: "atlassian" },
  { param: "notion", label: "Notion connected successfully.", provider: "notion" },
  { param: "google-docs", label: "Google Docs connected successfully.", provider: "google-docs" },
  { param: "teams", label: "Microsoft Teams connected successfully.", provider: "teams" }
];

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
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

  useEffect(() => {
    for (const entry of OAUTH_RETURN_BANNERS) {
      if (searchParams.get(entry.param) !== "connected") {
        continue;
      }
      setSuccessBanner(entry.label);
      if (entry.provider) {
        void load({ provider: entry.provider });
      }
      const url = new URL(window.location.href);
      url.searchParams.delete(entry.param);
      window.history.replaceState({}, "", url.pathname + url.search);
      break;
    }
  }, [searchParams, load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Integrations</h1>
        <p className="mt-1 text-sm text-coop-muted">
          {readOnly
            ? "Organization tools connected by your admin. Active tools are available in the VS Code extension automatically."
            : "Connect tools your team uses."}
        </p>
        {successBanner ? (
          <p className="mt-3 rounded-lg border border-coop-index/30 bg-coop-index/10 px-3 py-2 text-sm text-coop-index">
            {successBanner}
          </p>
        ) : null}
      </div>

      <IntegrationsStep
        integrations={integrations}
        orgPlan={orgPlan}
        initialLoading={initialLoading}
        refreshingProvider={refreshingProvider}
        refreshSuccessProvider={refreshSuccessProvider}
        error={error}
        onRefresh={(provider) => void load({ provider })}
        onSilentRefresh={(provider) => void load({ provider, silent: true })}
        showFullPageLink={false}
        hideIntro
        readOnly={readOnly}
      />
    </div>
  );
}
