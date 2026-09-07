"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIntegrations, fetchOrg } from "@/lib/coopApi";
import { getStoredMe } from "@/lib/auth";
import type { IntegrationProvider, IntegrationStatus } from "@/lib/integrations";

/** Live-test vendor APIs while Dashboard / Integrations is open so status stays current. */
const LIVE_POLL_MS = 15_000;

type UseIntegrationsOptions = {
  /** When true, live-test on a timer and whenever the window is focused. */
  poll?: boolean;
};

export function useIntegrations(options?: UseIntegrationsOptions) {
  const poll = options?.poll === true;
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [orgPlan, setOrgPlan] = useState<string>(getStoredMe()?.plan ?? "free");
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshingProvider, setRefreshingProvider] = useState<IntegrationProvider | null>(null);
  const [refreshSuccessProvider, setRefreshSuccessProvider] = useState<IntegrationProvider | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);

  const load = useCallback(
    async (loadOptions?: {
      provider?: IntegrationProvider;
      initial?: boolean;
      silent?: boolean;
      live?: boolean;
    }) => {
      const provider = loadOptions?.provider;
      // Silent refreshes (background polling, window focus) skip the spinner/checkmark
      // so the Refresh button doesn't flicker while waiting on an OAuth install.
      const showProgress = Boolean(provider) && !loadOptions?.silent;
      if (loadOptions?.initial) {
        setInitialLoading(true);
      } else if (showProgress && provider) {
        setRefreshingProvider(provider);
        setRefreshSuccessProvider(null);
      }
      if (loadOptions?.initial || showProgress) {
        setError(null);
      }

      const generation = ++inFlight.current;
      const live = loadOptions?.live === true || Boolean(provider);

      const [integrationsResult, orgResult] = await Promise.all([
        fetchIntegrations({ refresh: live }),
        fetchOrg()
      ]);

      if (generation !== inFlight.current) {
        return;
      }

      if (loadOptions?.initial) {
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
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void load({ initial: true, live: true });

    if (!poll) {
      return () => {
        cancelled = true;
      };
    }

    const liveRefresh = () => {
      if (cancelled) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void load({ silent: true, live: true });
    };

    const interval = window.setInterval(liveRefresh, LIVE_POLL_MS);
    const onFocus = () => liveRefresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        liveRefresh();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, poll]);

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
