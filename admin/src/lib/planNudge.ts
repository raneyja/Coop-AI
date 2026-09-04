export type OrgPlan = "free" | "pro" | "enterprise";
export type UsageTier = "pro" | "pro_plus" | "max";

export type PlanNudge = {
  title: string;
  body: string;
  ctaLabel: string;
  nextName: string;
  /** Free orgs start Stripe checkout. Paid orgs go to Billing. */
  action: "checkout" | "billing";
};

function parseUsageTier(value: string | null | undefined): UsageTier | null {
  if (value === "pro" || value === "pro_plus" || value === "max") {
    return value;
  }
  return null;
}

export function displayUsageTierName(tier: UsageTier | "enterprise"): string {
  if (tier === "pro_plus") {
    return "Pro+";
  }
  if (tier === "max") {
    return "Max";
  }
  if (tier === "enterprise") {
    return "Enterprise";
  }
  return "Pro";
}

/**
 * Next-plan CTA for dashboard/billing. Never asks a Pro org to "upgrade to Pro".
 * Enterprise has no nudge. Max nudges to Enterprise via Billing.
 */
export function resolvePlanNudge(options: {
  plan: string | null | undefined;
  usageTier?: string | null;
}): PlanNudge | null {
  const plan = options.plan === "enterprise" || options.plan === "pro" ? options.plan : "free";
  if (plan === "enterprise") {
    return null;
  }
  if (plan === "free") {
    return {
      title: "Upgrade to Pro",
      body: "Upgrade for unlimited Deep-Indexed repos, additional models, higher usage limits, and the option to add team seats.",
      ctaLabel: "Upgrade to Pro",
      nextName: "Pro",
      action: "checkout"
    };
  }
  const tier = parseUsageTier(options.usageTier) ?? "pro";
  if (tier === "pro") {
    return {
      title: "Upgrade to Pro+",
      body: "Pro+ includes a larger monthly usage bar. Same team seats and unlimited Deep-Index.",
      ctaLabel: "Upgrade to Pro+",
      nextName: "Pro+",
      action: "billing"
    };
  }
  if (tier === "pro_plus") {
    return {
      title: "Upgrade to Max",
      body: "Max is the highest self-serve usage before Enterprise. Same team seats and unlimited Deep-Index.",
      ctaLabel: "Upgrade to Max",
      nextName: "Max",
      action: "billing"
    };
  }
  return {
    title: "Need more than Max?",
    body: "Enterprise adds a custom usage contract, zero-retention routing, and self-hosted options.",
    ctaLabel: "Request Enterprise",
    nextName: "Enterprise",
    action: "billing"
  };
}
