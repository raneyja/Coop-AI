"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchIntegrations } from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { IntegrationCard } from "@/components/IntegrationCard";

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchIntegrations();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load integration status.");
      return;
    }
    setIntegrations(result.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Connect tools your team uses. OAuth opens in a new tab — return here and refresh status.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((def) => (
          <IntegrationCard
            key={def.id}
            definition={def}
            status={integrations.find((s) => s.provider === def.id)}
            onRefresh={load}
            refreshing={loading}
          />
        ))}
      </div>
    </div>
  );
}
