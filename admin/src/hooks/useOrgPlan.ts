"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoredMe, isAdminRole } from "@/lib/auth";
import { fetchMe, fetchOrg } from "@/lib/coopApi";
import { planCapabilities, type OrgPlan, type PlanCapabilities } from "@/lib/planCapabilities";

export function useOrgPlan(): {
  plan: OrgPlan;
  usageTier: string | null;
  seats: number | null;
  capabilities: PlanCapabilities;
  isFreePlan: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const me = getStoredMe();
  const [plan, setPlan] = useState<OrgPlan>(me?.plan ?? "free");
  const [usageTier, setUsageTier] = useState<string | null>(me?.usageTier ?? null);
  const [seats, setSeats] = useState<number | null>(typeof me?.seats === "number" ? me.seats : null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const stored = getStoredMe();
    if (stored && isAdminRole(stored)) {
      const result = await fetchOrg();
      if (result.ok && result.data?.plan) {
        setPlan(result.data.plan as OrgPlan);
        setUsageTier(result.data.usageTier ?? null);
        setSeats(typeof result.data.seats === "number" ? result.data.seats : null);
        setLoading(false);
        return;
      }
    }
    const meResult = await fetchMe();
    if (meResult.ok && meResult.data) {
      if (meResult.data.plan) {
        setPlan(meResult.data.plan as OrgPlan);
      }
      setUsageTier(meResult.data.usageTier ?? null);
      setSeats(typeof meResult.data.seats === "number" ? meResult.data.seats : null);
    } else if (stored?.plan) {
      setPlan(stored.plan);
      setUsageTier(stored.usageTier ?? null);
      setSeats(typeof stored.seats === "number" ? stored.seats : null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capabilities = planCapabilities(plan);

  return {
    plan,
    usageTier,
    seats,
    capabilities,
    isFreePlan: plan === "free",
    loading,
    refresh
  };
}
