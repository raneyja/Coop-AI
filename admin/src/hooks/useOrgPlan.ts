"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoredMe } from "@/lib/auth";
import { fetchOrg } from "@/lib/coopApi";
import { planCapabilities, type OrgPlan, type PlanCapabilities } from "@/lib/planCapabilities";

export function useOrgPlan(): {
  plan: OrgPlan;
  capabilities: PlanCapabilities;
  isFreePlan: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const me = getStoredMe();
  const [plan, setPlan] = useState<OrgPlan>(me?.plan ?? "free");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchOrg();
    setLoading(false);
    if (result.ok && result.data?.plan) {
      setPlan(result.data.plan as OrgPlan);
    } else if (me?.plan) {
      setPlan(me.plan);
    }
  }, [me?.plan]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capabilities = planCapabilities(plan);

  return {
    plan,
    capabilities,
    isFreePlan: plan === "free",
    loading,
    refresh
  };
}
