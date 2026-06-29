"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getStoredMe, displayOrgName } from "@/lib/auth";
import { fetchIntegrations, fetchOrg, fetchUsers } from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { PlanBadge } from "@/components/PlanBadge";
import { IntegrationStatusList } from "@/components/IntegrationStatusList";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export default function DashboardPage() {
  const me = getStoredMe();
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [integrationsResult, usersResult, orgResult] = await Promise.all([
      fetchIntegrations(),
      fetchUsers(),
      fetchOrg()
    ]);
    setLoading(false);
    if (!integrationsResult.ok) {
      setError(integrationsResult.error ?? "Failed to load integrations.");
    } else {
      setIntegrations(integrationsResult.data ?? []);
    }
    if (usersResult.ok && usersResult.data?.users) {
      setUserCount(usersResult.data.users.length);
    } else {
      setUserCount(null);
    }
    if (orgResult.ok && orgResult.data) {
      setShowWizard(!orgResult.data.onboardingCompleted);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = integrations.filter((i) => i.installed).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="admin-page-title">Dashboard</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Overview for {displayOrgName(me)}
        </p>
      </div>

      {showWizard && <OnboardingWizard onComplete={() => setShowWizard(false)} />}

      <AdminStatRow>
        <div className="admin-stat">
          <p className="text-xs font-medium uppercase tracking-wide text-coop-muted">Organization</p>
          <p className="mt-1 text-lg font-semibold text-white">{displayOrgName(me)}</p>
          <div className="mt-2">
            <PlanBadge plan={me?.plan ?? "free"} />
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

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="admin-section-label">Integration status</h2>
          <Link href="/integrations" className="admin-link text-sm">
            Manage integrations
          </Link>
        </div>
        {error && (
          <p className="mb-4 text-sm text-red-400">{error}</p>
        )}
        <IntegrationStatusList integrations={integrations} loading={loading} />
      </section>
    </div>
  );
}
