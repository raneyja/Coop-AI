export type OrgPlan = "free" | "pro" | "enterprise";

export type PlanCapabilities = {
  plan: OrgPlan;
  showCollections: boolean;
  teamInvites: boolean;
  showUsageQuota: boolean;
  indexedRepoLimit: number | null;
  chatFeed: boolean;
  showScopeStep: boolean;
  showOnboardingIndexingStep: boolean;
  showOnboardingExtensionStep: boolean;
  showOnboardingTeamStep: boolean;
  showOnboardingVerifyStep: boolean;
};

export function normalizeOrgPlan(plan: string | undefined | null): OrgPlan {
  if (plan === "enterprise" || plan === "pro") {
    return plan;
  }
  return "free";
}

export function planCapabilities(plan: string | undefined | null): PlanCapabilities {
  const normalized = normalizeOrgPlan(plan);
  const isFree = normalized === "free";
  return {
    plan: normalized,
    showCollections: !isFree,
    teamInvites: !isFree,
    showUsageQuota: isFree,
    indexedRepoLimit: isFree ? 3 : null,
    chatFeed: true,
    showScopeStep: !isFree,
    showOnboardingIndexingStep: true,
    showOnboardingExtensionStep: isFree,
    showOnboardingTeamStep: !isFree,
    showOnboardingVerifyStep: !isFree
  };
}
