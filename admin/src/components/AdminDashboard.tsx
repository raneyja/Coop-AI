"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { displayOrgName, getStoredMe } from "@/lib/auth";
import {
  createUpgradeCheckoutSession,
  fetchQuota,
  fetchUsers,
  isOrgSuspendedResult,
  type QuotaSnapshot
} from "@/lib/coopApi";
import { INTEGRATIONS, integrationIsConnected } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useOrgPlan } from "@/hooks/useOrgPlan";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { PlanBadge } from "@/components/PlanBadge";
import { IntegrationStatusList } from "@/components/IntegrationStatusList";
import { UsageQuotaMeter } from "@/components/UsageQuotaMeter";
import { UpgradeCTA } from "@/components/UpgradeCTA";
import { resolvePlanNudge } from "@/lib/planNudge";

export function AdminDashboard() {
  const me = getStoredMe();
  const { plan, usageTier, capabilities, loading: planLoading } = useOrgPlan();
  const { integrations, initialLoading, error: integrationsError } = useIntegrations({ poll: true });
  const [userCount, setUserCount] = useState<number | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | undefined>();
  const [quotaLoading, setQuotaLoading] = useState(capabilities.showUsageQuota);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setUsersLoading(true);
    setError(null);
    if (capabilities.showUsageQuota) {
      setQuotaLoading(true);
    }
    const requests: [
      Promise<Awaited<ReturnType<typeof fetchUsers>>>,
      Promise<Awaited<ReturnType<typeof fetchQuota>> | null>
    ] = [fetchUsers(), capabilities.showUsageQuota ? fetchQuota() : Promise.resolve(null)];
    const [usersResult, quotaResult] = await Promise.all(requests);
    setUsersLoading(false);
    if (capabilities.showUsageQuota) {
      setQuotaLoading(false);
      if (quotaResult?.ok) {
        setQuota(quotaResult.data);
      }
    }
    if (usersResult.ok && usersResult.data?.users) {
      setUserCount(usersResult.data.users.length);
    } else {
      setUserCount(null);
      if (!usersResult.ok && !isOrgSuspendedResult(usersResult)) {
        setError(usersResult.error ?? "Failed to load users.");
      }
    }
  }, [capabilities.showUsageQuota]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = integrations.filter((entry) => integrationIsConnected(entry)).length;
  const listError =
    error ??
    (integrationsError && !/org_suspended|not signed in|session expired/i.test(integrationsError)
      ? integrationsError
      : null);
  const effectiveUsageTier = quota?.usageTier ?? usageTier;
  const nudge =
    plan === "pro" && planLoading && !effectiveUsageTier
      ? null
      : resolvePlanNudge({ plan, usageTier: effectiveUsageTier });

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

      {nudge ? (
        <>
          <UpgradeCTA
            variant="banner"
            title={nudge.title}
            body={nudge.body}
            ctaLabel={nudge.ctaLabel}
            href={nudge.action === "billing" ? "/billing" : undefined}
            onAction={nudge.action === "checkout" ? handleUpgrade : undefined}
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
            <PlanBadge plan={plan} usageTier={effectiveUsageTier} />
          </div>
        </div>
        <AdminStat
          label="Connected integrations"
          value={initialLoading ? "—" : connectedCount}
          hint={`of ${INTEGRATIONS.length} available`}
        />
        <div className="admin-stat">
          <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">Users</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {usersLoading ? "—" : userCount ?? "—"}
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
        {listError ? <p className="mb-4 text-sm text-red-400">{listError}</p> : null}
        <IntegrationStatusList integrations={integrations} loading={initialLoading} />
      </section>
    </div>
  );
}
