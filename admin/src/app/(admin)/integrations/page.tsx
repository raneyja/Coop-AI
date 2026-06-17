"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchIntegrations, fetchOrg } from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { IntegrationCard } from "@/components/IntegrationCard";

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [orgPlan, setOrgPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [integrationsResult, orgResult] = await Promise.all([fetchIntegrations(), fetchOrg()]);
    setLoading(false);
    if (!integrationsResult.ok) {
      setError(integrationsResult.error ?? "Failed to load integration status.");
      return;
    }
    setIntegrations(integrationsResult.data ?? []);
    if (orgResult.ok && orgResult.data?.plan) {
      setOrgPlan(orgResult.data.plan);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Integrations</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Connect tools your team uses. OAuth opens in a new tab — return here and refresh status.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="divide-y divide-coop-border/40">
        {INTEGRATIONS.map((def) => (
          <IntegrationCard
            key={def.id}
            definition={def}
            status={integrations.find((s) => s.provider === def.id)}
            orgPlan={orgPlan}
            onRefresh={load}
            refreshing={loading}
          />
        ))}
      </div>
    </div>
  );
}
