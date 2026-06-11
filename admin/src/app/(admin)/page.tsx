"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getStoredMe, displayOrgName } from "@/lib/auth";
import { fetchIntegrations, fetchOrg, fetchUsers } from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { PlanBadge } from "@/components/PlanBadge";
import { StatusBadge } from "@/components/StatusBadge";
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
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Overview for {displayOrgName(me)}
        </p>
      </div>

      {showWizard && (
        <OnboardingWizard
          integrations={integrations}
          onComplete={() => setShowWizard(false)}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="admin-card">
          <p className="admin-section-label">Organization</p>
          <p className="mt-2 text-lg font-semibold">{displayOrgName(me)}</p>
          <div className="mt-2">
            <PlanBadge plan={me?.plan ?? "free"} />
          </div>
        </div>
        <div className="admin-card">
          <p className="admin-section-label">Connected integrations</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {loading ? "—" : connectedCount}
          </p>
          <p className="mt-1 text-xs text-coop-muted">of {INTEGRATIONS.length} available</p>
        </div>
        <div className="admin-card">
          <p className="admin-section-label">Users</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {loading ? "—" : userCount ?? "—"}
          </p>
          <p className="mt-1 text-xs text-coop-muted">
            <Link href="/users" className="admin-link text-xs">
              Manage users →
            </Link>
          </p>
        </div>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Integration status</h2>
          <Link href="/integrations" className="admin-link text-sm">
            Manage integrations
          </Link>
        </div>
        {error && (
          <p className="mb-4 text-sm text-red-400">{error}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((def) => {
            const status = integrations.find((s) => s.provider === def.id);
            return (
              <div key={def.id} className="admin-card flex items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{def.name}</p>
                  {status?.detail && (
                    <p className="text-xs text-coop-muted">{status.detail}</p>
                  )}
                </div>
                {loading ? (
                  <span className="text-xs text-coop-muted">…</span>
                ) : (
                  <StatusBadge connected={status?.installed ?? false} />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
