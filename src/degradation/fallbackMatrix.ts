import type { IntegrationHealth, IntegrationProvider } from "../integrations/healthMonitor";

export type FeatureId =
  | "trace_why"
  | "ownership_map"
  | "blast_radius"
  | "knowledge_gaps"
  | "repo_summary";

export type QuickActionFeatureId =
  | FeatureId
  | "trace-decision"
  | "find-owner"
  | "blast-radius"
  | "knowledge-gaps"
  | "understand-repo"
  | "coopAI.traceDecisionFromContext";

export type FallbackLevel = "full" | "partial" | "cached" | "unavailable";

export type FallbackDefinition = {
  required: IntegrationProvider[];
  optional: IntegrationProvider[];
  fallback: Record<string, string>;
};

export type FeatureFallbackStatus = {
  feature: QuickActionFeatureId;
  canonicalFeature: FeatureId;
  level: FallbackLevel;
  label: string;
  message: string;
  required: IntegrationProvider[];
  optional: IntegrationProvider[];
  unavailableProviders: IntegrationProvider[];
  degradedProviders: IntegrationProvider[];
};

export const FEATURE_ALIASES: Record<QuickActionFeatureId, FeatureId> = {
  trace_why: "trace_why",
  "trace-decision": "trace_why",
  "coopAI.traceDecisionFromContext": "trace_why",
  ownership_map: "ownership_map",
  "find-owner": "ownership_map",
  blast_radius: "blast_radius",
  "blast-radius": "blast_radius",
  knowledge_gaps: "knowledge_gaps",
  "knowledge-gaps": "knowledge_gaps",
  repo_summary: "repo_summary",
  "understand-repo": "repo_summary"
};

export const FALLBACK_MATRIX: Record<FeatureId, FallbackDefinition> = {
  trace_why: {
    required: ["github"],
    optional: ["slack", "jira", "teams"],
    fallback: {
      github_offline: "Show cached commit history (may be stale)",
      slack_offline: "Show PR comments only (no Slack context)",
      jira_offline: "Show PR + Slack (no ticket context)",
      teams_offline: "Show PR + Slack/Jira (no Teams context)",
      all_online: "Full decision timeline"
    }
  },
  ownership_map: {
    required: ["github"],
    optional: ["slack"],
    fallback: {
      github_offline: "Show cached ownership (may be 24h old)",
      slack_offline: "Show ownership without availability (unknown if online)",
      all_online: "Full ownership + real-time Slack status"
    }
  },
  blast_radius: {
    required: ["github"],
    optional: [],
    fallback: {
      github_offline: "Show cached dependency graph (may be stale)",
      github_slow: "Show simplified analysis (skip transitive deps)",
      all_online: "Full impact analysis"
    }
  },
  knowledge_gaps: {
    required: ["github"],
    optional: ["confluence", "notion", "google-docs"],
    fallback: {
      github_offline: "Cannot run live scan (requires file structure)",
      docs_offline: "Show orphaned files only (no doc gaps)",
      all_online: "Full health audit"
    }
  },
  repo_summary: {
    required: ["github"],
    optional: [],
    fallback: {
      github_offline: "Show cached summary",
      all_online: "Live updated summary"
    }
  }
};

export async function getFallbackLevel(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[]
): Promise<FallbackLevel> {
  return fallbackStatusForFeature(feature, health).level;
}

export function fallbackStatusForFeature(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[]
): FeatureFallbackStatus {
  const canonicalFeature = normalizeFeatureId(feature);
  const definition = FALLBACK_MATRIX[canonicalFeature];
  const requiredHealth = matchingHealth(definition.required, health);
  const optionalHealth = matchingHealth(definition.optional, health);
  const unavailableRequired = requiredHealth.filter((entry) => entry.status === "offline");
  const degradedRequired = requiredHealth.filter((entry) => entry.status === "degraded");
  const unavailableOptional = optionalHealth.filter((entry) => entry.status === "offline");
  const degradedOptional = optionalHealth.filter((entry) => entry.status === "degraded");

  const level = determineLevel(requiredHealth, optionalHealth);
  return {
    feature,
    canonicalFeature,
    level,
    label: labelForLevel(level),
    message: explainFallback(canonicalFeature, health, level),
    required: definition.required,
    optional: definition.optional,
    unavailableProviders: [...unavailableRequired, ...unavailableOptional].map((entry) => entry.provider),
    degradedProviders: [...degradedRequired, ...degradedOptional].map((entry) => entry.provider)
  };
}

export function featureStatuses(health: IntegrationHealth[]): Record<string, FeatureFallbackStatus> {
  const actions: QuickActionFeatureId[] = [
    "understand-repo",
    "trace-decision",
    "find-owner",
    "blast-radius",
    "knowledge-gaps"
  ];
  return Object.fromEntries(actions.map((action) => [action, fallbackStatusForFeature(action, health)]));
}

export function providersForFeature(feature: QuickActionFeatureId): {
  required: IntegrationProvider[];
  optional: IntegrationProvider[];
} {
  const definition = FALLBACK_MATRIX[normalizeFeatureId(feature)];
  return {
    required: [...definition.required],
    optional: [...definition.optional]
  };
}

export function explainFallback(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[],
  level = fallbackStatusForFeature(feature, health).level
): string {
  const canonicalFeature = normalizeFeatureId(feature);
  const definition = FALLBACK_MATRIX[canonicalFeature];
  if (level === "full") {
    return definition.fallback.all_online ?? "Full results available.";
  }
  const required = matchingHealth(definition.required, health);
  const optional = matchingHealth(definition.optional, health);
  const offlineRequired = required.find((entry) => entry.status === "offline");
  const offlineOptional = optional.find((entry) => entry.status === "offline");
  const degradedRequired = required.find((entry) => entry.status === "degraded");

  if (level === "unavailable") {
    return `${displayFeature(canonicalFeature)} is unavailable because all required integrations are offline.`;
  }
  if (level === "cached" && offlineRequired) {
    return definition.fallback[`${offlineRequired.provider}_offline`] ?? `Showing cached ${displayFeature(canonicalFeature)} data.`;
  }
  if (level === "partial" && degradedRequired) {
    return definition.fallback[`${degradedRequired.provider}_slow`] ?? `${displayFeature(canonicalFeature)} is running in partial mode.`;
  }
  if (offlineOptional) {
    const docsOffline = definition.optional.some((provider) => provider === "confluence" || provider === "notion" || provider === "google-docs");
    if (docsOffline && ["confluence", "notion", "google-docs"].includes(offlineOptional.provider)) {
      return definition.fallback.docs_offline ?? "Documentation systems are offline; showing repository-only results.";
    }
    return definition.fallback[`${offlineOptional.provider}_offline`] ?? `${displayProvider(offlineOptional.provider)} is offline; showing partial results.`;
  }
  return `${displayFeature(canonicalFeature)} is running in best-effort mode.`;
}

export function normalizeFeatureId(feature: QuickActionFeatureId): FeatureId {
  return FEATURE_ALIASES[feature] ?? "repo_summary";
}

function determineLevel(requiredHealth: IntegrationHealth[], optionalHealth: IntegrationHealth[]): FallbackLevel {
  if (requiredHealth.length === 0) {
    return "unavailable";
  }
  const allRequiredOffline = requiredHealth.every((entry) => entry.status === "offline");
  const someRequiredOffline = requiredHealth.some((entry) => entry.status === "offline");
  const allRequiredHealthy = requiredHealth.every((entry) => entry.status === "healthy");
  const optionalAllHealthy = optionalHealth.every((entry) => entry.status === "healthy");
  if (allRequiredOffline) {
    return "unavailable";
  }
  if (someRequiredOffline) {
    return "cached";
  }
  if (allRequiredHealthy && optionalAllHealthy) {
    return "full";
  }
  return "partial";
}

function matchingHealth(providers: IntegrationProvider[], health: IntegrationHealth[]): IntegrationHealth[] {
  const byProvider = new Map(health.map((entry) => [entry.provider, entry]));
  return providers.map((provider) => byProvider.get(provider) ?? {
    provider,
    status: "offline",
    lastCheck: new Date(),
    recoveryStrategy: "cache",
    error: "No health data available."
  });
}

function labelForLevel(level: FallbackLevel): string {
  switch (level) {
    case "full":
      return "Full";
    case "partial":
      return "Partial";
    case "cached":
      return "Cached";
    case "unavailable":
      return "Unavailable";
  }
}

function displayFeature(feature: FeatureId): string {
  return feature.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function displayProvider(provider: IntegrationProvider): string {
  return provider.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
