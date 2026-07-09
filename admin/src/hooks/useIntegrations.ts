"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchIntegrations, fetchOrg } from "@/lib/coopApi";
import { getStoredMe } from "@/lib/auth";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations";

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [orgPlan, setOrgPlan] = useState<string>(getStoredMe()?.plan ?? "free");
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshingProvider, setRefreshingProvider] = useState<IntegrationProvider | null>(null);
  const [refreshSuccessProvider, setRefreshSuccessProvider] = useState<IntegrationProvider | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (options?: { provider?: IntegrationProvider; initial?: boolean; silent?: boolean }) => {
    const provider = options?.provider;
    // Silent refreshes (background polling, window focus) skip the spinner/checkmark
    // so the Refresh button doesn't flicker while waiting on an OAuth install.
    const showProgress = Boolean(provider) && !options?.silent;
    if (options?.initial) {
      setInitialLoading(true);
    } else if (showProgress && provider) {
      setRefreshingProvider(provider);
      setRefreshSuccessProvider(null);
    }
    if (options?.initial || showProgress) {
      setError(null);
    }

    const [integrationsResult, orgResult] = await Promise.all([
      fetchIntegrations({ refresh: Boolean(provider) }),
      fetchOrg()
    ]);

    if (options?.initial) {
      setInitialLoading(false);
    }
    if (showProgress && provider) {
      setRefreshingProvider(null);
      if (integrationsResult.ok) {
        setRefreshSuccessProvider(provider);
      }
    }

    if (!integrationsResult.ok) {
      setError(integrationsResult.error ?? "Failed to load integration status.");
      return;
    }
    setIntegrations(integrationsResult.data ?? []);
    if (orgResult.ok && orgResult.data?.plan) {
      setOrgPlan(orgResult.data.plan);
    } else {
      const me = getStoredMe();
      if (me?.plan) {
        setOrgPlan(me.plan);
      }
    }
  }, []);

  useEffect(() => {
    void load({ initial: true });
  }, [load]);

  useEffect(() => {
    if (!refreshSuccessProvider) {
      return;
    }
    const timer = setTimeout(() => setRefreshSuccessProvider(null), 1500);
    return () => clearTimeout(timer);
  }, [refreshSuccessProvider]);

  return {
    integrations,
    orgPlan,
    initialLoading,
    refreshingProvider,
    refreshSuccessProvider,
    error,
    load
  };
}
