"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchIntegrationsHealth, type IntegrationHealthEntry } from "@/lib/coopApi";
import { INTEGRATIONS } from "@/lib/integrations";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";

function healthChip(health: IntegrationHealthEntry["health"]) {
  switch (health) {
    case "healthy":
      return <StatusBadge connected label="Healthy" />;
    case "degraded":
      return <AdminChip>Needs attention</AdminChip>;
    case "scope_required":
      return <StatusBadge connected={false} label="Scope required" showWhenDisconnected />;
    case "not_configured":
      return <AdminChip>Not configured</AdminChip>;
    case "not_connected":
    default:
      return <StatusBadge connected={false} showWhenDisconnected />;
  }
}

type OnboardingVerifyStepProps = {
  onGatesChange?: (canComplete: boolean) => void;
};

export function OnboardingVerifyStep({ onGatesChange }: OnboardingVerifyStepProps) {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<IntegrationHealthEntry[]>([]);
  const [canComplete, setCanComplete] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) {
      setTesting(true);
    } else {
      setLoading(true);
    }
    setError(null);
    const result = await fetchIntegrationsHealth(refresh);
    if (refresh) {
      setTesting(false);
    } else {
      setLoading(false);
    }
    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not load integration health.");
      return;
    }
    setEntries(result.data.integrations);
    const gates = result.data.onboardingGates?.canCompleteOnboarding ?? false;
    setCanComplete(gates);
    onGatesChange?.(gates);
  }, [onGatesChange]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const nameFor = (provider: string) =>
    INTEGRATIONS.find((entry) => entry.id === provider)?.name ?? provider;

  return (
    <div className="space-y-4">
      <p className="text-sm text-coop-muted">
        Confirm connected tools respond before you finish setup. Run tests to refresh status.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="admin-list">
        {entries.map((entry) => (
          <div key={entry.provider} className="admin-list-row">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{nameFor(entry.provider)}</p>
              {entry.message ? (
                <p className="mt-0.5 text-xs text-coop-muted">{entry.message}</p>
              ) : null}
            </div>
            {loading ? (
              <span className="text-xs text-coop-muted">…</span>
            ) : (
              healthChip(entry.health)
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="admin-btn-secondary"
          onClick={() => void load(true)}
          disabled={testing || loading}
        >
          {testing ? "Testing…" : "Test all"}
        </button>
      </div>
      {!canComplete && !loading ? (
        <p className="text-xs text-amber-300">
          Connect at least GitHub or one collaboration tool. Pro and Enterprise orgs need every connected
          scopable tool (Slack, Jira, Notion, Google Docs) set to Active before finishing.
        </p>
      ) : null}
    </div>
  );
}
