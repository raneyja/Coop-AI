"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getStoredMe, isMemberRole } from "@/lib/auth";
import { useIntegrations } from "@/hooks/useIntegrations";
import { IntegrationsStep } from "@/components/IntegrationsStep";

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const [githubBanner, setGithubBanner] = useState<string | null>(null);
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
    if (searchParams.get("github") !== "connected") {
      return;
    }
    setGithubBanner("GitHub connected successfully.");
    void load({ provider: "github" });
    const url = new URL(window.location.href);
    url.searchParams.delete("github");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [searchParams, load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Integrations</h1>
        <p className="mt-1 text-sm text-coop-muted">
          {readOnly
            ? "Organization tools connected by your admin. Link your personal accounts in the VS Code extension."
            : "Connect tools your team uses. For GitHub, install the App on your company org (or send the link to your GitHub admin). Return here and refresh after install."}
        </p>
        {githubBanner ? (
          <p className="mt-3 rounded-lg border border-coop-index/30 bg-coop-index/10 px-3 py-2 text-sm text-coop-index">
            {githubBanner}
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
        showFullPageLink={false}
        hideIntro
        readOnly={readOnly}
      />
    </div>
  );
}
