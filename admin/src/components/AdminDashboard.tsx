"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import {
  createUpgradeCheckoutSession,
  fetchIntegrations,
  fetchQuota,
  fetchUsers,
  isOrgSuspendedResult,
  type QuotaSnapshot
} from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { useOrgPlan } from "@/hooks/useOrgPlan";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { PlanBadge } from "@/components/PlanBadge";
import { IntegrationStatusList } from "@/components/IntegrationStatusList";
import { UsageQuotaMeter } from "@/components/UsageQuotaMeter";
import { UpgradeCTA } from "@/components/UpgradeCTA";

export function AdminDashboard() {
  const me = getStoredMe();
  const { plan, capabilities } = useOrgPlan();
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | undefined>();
  const [quotaLoading, setQuotaLoading] = useState(capabilities.showUsageQuota);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (capabilities.showUsageQuota) {
      setQuotaLoading(true);
    }
    const requests: [
      Promise<Awaited<ReturnType<typeof fetchIntegrations>>>,
      Promise<Awaited<ReturnType<typeof fetchUsers>>>,
      Promise<Awaited<ReturnType<typeof fetchQuota>> | null>
    ] = [
      fetchIntegrations(),
      fetchUsers(),
      capabilities.showUsageQuota ? fetchQuota() : Promise.resolve(null)
    ];
    const [integrationsResult, usersResult, quotaResult] = await Promise.all(requests);
    setLoading(false);
    if (capabilities.showUsageQuota) {
      setQuotaLoading(false);
      if (quotaResult?.ok) {
        setQuota(quotaResult.data);
      }
    }
    if (!integrationsResult.ok) {
      // Portal-wide OrgSuspendedOverlay handles org_suspended; skip inline red text.
      if (!isOrgSuspendedResult(integrationsResult)) {
        setError(integrationsResult.error ?? "Failed to load integrations.");
      }
    } else {
      setIntegrations(integrationsResult.data ?? []);
    }
    if (usersResult.ok && usersResult.data?.users) {
      setUserCount(usersResult.data.users.length);
    } else {
      setUserCount(null);
    }
  }, [capabilities.showUsageQuota]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = integrations.filter((i) => i.installed).length;

  async function handleUpgrade() {
    setUpgrading(true);
    setUpgradeError(null);
    const result = await createUpgradeCheckoutSession();
    setUpgrading(false);
    if (!result.ok || !result.data?.url) {
      setUpgradeError(result.error ?? "Could not start checkout.");
      return;
    }
    window.location.href = result.data.url;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Dashboard</h1>
        <p className="mt-1 text-sm text-coop-muted">Overview for {displayOrgName(me)}</p>
      </div>

      {capabilities.showUsageQuota ? (
        <>
          <UpgradeCTA
            variant="banner"
            title="Upgrade to Pro"
            body="Upgrade for unlimited Deep-Indexed repos, additional models, team seats, and higher usage limits."
            ctaLabel="Upgrade to Pro"
            onAction={handleUpgrade}
            actionLoading={upgrading}
          />
          {upgradeError ? <p className="text-sm text-red-400">{upgradeError}</p> : null}
        </>
      ) : null}

      <AdminStatRow>
        <div className="admin-stat">
          <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">Organization</p>
          <p className="mt-1 text-lg font-semibold text-white">{displayOrgName(me)}</p>
          <div className="mt-2">
            <PlanBadge plan={plan} />
          </div>
        </div>
        <AdminStat
          label="Connected integrations"
          value={loading ? "—" : connectedCount}
          hint={`of ${INTEGRATIONS.length} available`}
        />
        <div className="admin-stat">
          <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">Users</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {loading ? "—" : userCount ?? "—"}
          </p>
          <p className="mt-0.5 text-xs text-coop-muted">
            <Link href="/users" className="admin-link text-xs">
              Manage users →
            </Link>
          </p>
        </div>
      </AdminStatRow>

      {capabilities.showUsageQuota ? (
        <UsageQuotaMeter snapshot={quota} loading={quotaLoading} showUpgradeLink={false} />
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="admin-section-label">Integration status</h2>
          <Link href="/integrations" className="admin-link inline-flex items-center gap-1 text-sm">
            Manage integrations
            <span aria-hidden>↗</span>
          </Link>
        </div>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        <IntegrationStatusList integrations={integrations} loading={loading} />
      </section>
    </div>
  );
}
