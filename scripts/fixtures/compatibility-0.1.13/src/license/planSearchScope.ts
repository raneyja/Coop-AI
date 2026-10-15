export type SubscriptionPlan = "free" | "pro" | "enterprise";

export type SearchScopeMode = "repo" | "indexed" | "org" | "collection";

export type ResolvedSearchScope = {
  mode: SearchScopeMode;
  collectionId?: string;
  scope?: "indexed" | "org";
};

export function isProOrHigher(plan: SubscriptionPlan): boolean {
  return plan === "pro" || plan === "enterprise";
}

/** Pro and Enterprise require integration allowlist scope before search. */
export function requiresIntegrationScope(plan: string): boolean {
  return plan === "pro" || plan === "enterprise";
}

export function isFreePlan(plan?: SubscriptionPlan): boolean {
  return !plan || plan === "free";
}

/** Pro+ admin feature — not part of free chat/indexing parity. */
export function canUseCollections(plan?: SubscriptionPlan): boolean {
  return isProOrHigher(plan ?? "free");
}

/** Enterprise org-wide search scope. */
export function canUseOrgSearchScope(plan?: SubscriptionPlan): boolean {
  return plan === "enterprise";
}

/** Normalize search scope for plan — free gets indexed/repo, not collections or org. */
export function resolveSearchScopeForPlan(input: {
  plan?: SubscriptionPlan;
  searchScopeMode: SearchScopeMode;
  searchCollectionId?: string;
}): ResolvedSearchScope {
  const plan = input.plan ?? "free";
  const mode = input.searchScopeMode;

  if (isFreePlan(plan)) {
    if (mode === "indexed") {
      return { mode: "indexed", scope: "indexed" };
    }
    if (mode === "collection" || mode === "org") {
      return { mode: "indexed", scope: "indexed" };
    }
    return { mode: "repo" };
  }

  if (mode === "org" && !canUseOrgSearchScope(plan)) {
    return { mode: "indexed", scope: "indexed" };
  }

  if (mode === "collection") {
    if (!canUseCollections(plan)) {
      return { mode: "repo" };
    }
    const collectionId = (input.searchCollectionId ?? "").trim();
    return { mode: "collection", collectionId: collectionId || undefined };
  }

  if (mode === "indexed" || mode === "org") {
    return { mode, scope: mode };
  }

  return { mode: "repo" };
}

export function clampSearchScopeModeForPlan(
  mode: SearchScopeMode,
  plan: SubscriptionPlan | undefined
): SearchScopeMode {
  return resolveSearchScopeForPlan({ plan, searchScopeMode: mode }).mode;
}
