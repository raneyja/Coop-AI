import { isCodeHostProvider, type CodeHostProvider } from "../api/codeHosts/types";
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
  /** Repo actions need the Use-repo host (GitHub, GitLab, or Bitbucket) — never a hardcoded host. */
  requiresCodeHost: boolean;
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

const DOC_PROVIDERS: IntegrationProvider[] = ["confluence", "notion", "google-docs"];

function hasOnlineDocProvider(health: IntegrationHealth[]): boolean {
  return health.some(
    (entry) =>
      DOC_PROVIDERS.includes(entry.provider) &&
      (entry.status === "healthy" || entry.status === "degraded")
  );
}

export const FALLBACK_MATRIX: Record<FeatureId, FallbackDefinition> = {
  trace_why: {
    requiresCodeHost: true,
    optional: ["slack", "jira", "teams"],
    fallback: {
      code_host_offline: "Show cached commit history (may be stale)",
      slack_offline: "Show PR comments only (no Slack context)",
      jira_offline: "Show PR + Slack (no ticket context)",
      teams_offline: "Show PR + Slack/Jira (no Teams context)",
      all_online: "Full decision timeline"
    }
  },
  ownership_map: {
    requiresCodeHost: true,
    optional: ["slack"],
    fallback: {
      code_host_offline: "Show cached ownership (may be 24h old)",
      slack_offline: "Show ownership without availability (unknown if online)",
      all_online: "Full ownership + real-time Slack status"
    }
  },
  blast_radius: {
    requiresCodeHost: true,
    optional: [],
    fallback: {
      code_host_offline: "Show cached dependency graph (may be stale)",
      code_host_slow: "Show simplified analysis (skip transitive deps)",
      all_online: "Full impact analysis"
    }
  },
  knowledge_gaps: {
    requiresCodeHost: true,
    optional: ["confluence", "notion", "google-docs"],
    fallback: {
      code_host_offline: "Cannot run live scan (requires file structure)",
      docs_offline: "Show orphaned files only (no doc gaps)",
      all_online: "Full health audit"
    }
  },
  repo_summary: {
    requiresCodeHost: true,
    optional: [],
    fallback: {
      code_host_offline: "Show cached summary",
      all_online: "Live updated summary"
    }
  }
};

export async function getFallbackLevel(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[],
  codeHost?: CodeHostProvider
): Promise<FallbackLevel> {
  return fallbackStatusForFeature(feature, health, codeHost).level;
}

export function fallbackStatusForFeature(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[],
  codeHost?: CodeHostProvider
): FeatureFallbackStatus {
  const canonicalFeature = normalizeFeatureId(feature);
  const definition = FALLBACK_MATRIX[canonicalFeature];
  const required = requiredProviders(definition, codeHost);
  const requiredHealth = matchingHealth(required, health);
  const optionalHealth = matchingHealth(definition.optional, health);
  const unavailableRequired = requiredHealth.filter((entry) => entry.status === "offline");
  const degradedRequired = requiredHealth.filter((entry) => entry.status === "degraded");
  const unavailableOptional = optionalHealth.filter((entry) => entry.status === "offline");
  const degradedOptional = optionalHealth.filter((entry) => entry.status === "degraded");

  const level = determineLevel(requiredHealth, optionalHealth, definition.requiresCodeHost && !codeHost);
  return {
    feature,
    canonicalFeature,
    level,
    label: labelForLevel(level),
    message: explainFallback(canonicalFeature, health, level, codeHost),
    required,
    optional: definition.optional,
    unavailableProviders: [...unavailableRequired, ...unavailableOptional].map((entry) => entry.provider),
    degradedProviders: [...degradedRequired, ...degradedOptional].map((entry) => entry.provider)
  };
}

export function featureStatuses(
  health: IntegrationHealth[],
  codeHost?: CodeHostProvider
): Record<string, FeatureFallbackStatus> {
  const actions: QuickActionFeatureId[] = [
    "understand-repo",
    "trace-decision",
    "find-owner",
    "blast-radius",
    "knowledge-gaps"
  ];
  return Object.fromEntries(
    actions.map((action) => [action, fallbackStatusForFeature(action, health, codeHost)])
  );
}

export function providersForFeature(
  feature: QuickActionFeatureId,
  codeHost?: CodeHostProvider
): {
  required: IntegrationProvider[];
  optional: IntegrationProvider[];
} {
  const definition = FALLBACK_MATRIX[normalizeFeatureId(feature)];
  return {
    required: requiredProviders(definition, codeHost),
    optional: [...definition.optional]
  };
}

export function explainFallback(
  feature: QuickActionFeatureId,
  health: IntegrationHealth[],
  level = fallbackStatusForFeature(feature, health).level,
  codeHost?: CodeHostProvider
): string {
  const canonicalFeature = normalizeFeatureId(feature);
  const definition = FALLBACK_MATRIX[canonicalFeature];
  if (level === "full") {
    return definition.fallback.all_online ?? "Full results available.";
  }
  const required = matchingHealth(requiredProviders(definition, codeHost), health);
  const optional = matchingHealth(definition.optional, health);
  const offlineRequired = required.find((entry) => entry.status === "offline");
  const offlineOptional = optional.find((entry) => entry.status === "offline");
  const degradedRequired = required.find((entry) => entry.status === "degraded");

  if (level === "unavailable") {
    return `${displayFeature(canonicalFeature)} is unavailable because all required integrations are offline.`;
  }
  if (level === "cached" && offlineRequired) {
    return (
      definition.fallback[offlineFallbackKey(offlineRequired.provider)] ??
      `Showing cached ${displayFeature(canonicalFeature)} data.`
    );
  }
  if (level === "partial" && degradedRequired) {
    return (
      definition.fallback[slowFallbackKey(degradedRequired.provider)] ??
      `${displayFeature(canonicalFeature)} — some sources are slow or incomplete.`
    );
  }
  if (offlineOptional) {
    const isDocProvider = DOC_PROVIDERS.includes(offlineOptional.provider);
    if (isDocProvider && !hasOnlineDocProvider(health)) {
      return definition.fallback.docs_offline ?? "Documentation systems are offline; showing repository-only results.";
    }
    if (!isDocProvider) {
      return (
        definition.fallback[offlineFallbackKey(offlineOptional.provider)] ??
        `${displayProvider(offlineOptional.provider)} is offline; showing partial results.`
      );
    }
  }
  return `${displayFeature(canonicalFeature)} — some sources could not be loaded.`;
}

/** A connected org code host is online for quick actions, even if the last probe said offline. */
export function promoteOrgConnectedCodeHosts(
  health: IntegrationHealth[],
  connected: ReadonlySet<CodeHostProvider>
): IntegrationHealth[] {
  if (connected.size === 0) {
    return health;
  }
  return health.map((entry) =>
    isCodeHostProvider(entry.provider) && connected.has(entry.provider) && entry.status === "offline"
      ? {
          ...entry,
          status: "healthy",
          error: undefined,
          errorRate: 0,
          recoveryStrategy: "retry"
        }
      : entry
  );
}

export function normalizeFeatureId(feature: QuickActionFeatureId): FeatureId {
  return FEATURE_ALIASES[feature] ?? "repo_summary";
}

function requiredProviders(definition: FallbackDefinition, codeHost?: CodeHostProvider): IntegrationProvider[] {
  if (!definition.requiresCodeHost || !codeHost) {
    return [];
  }
  return [codeHost];
}

function offlineFallbackKey(provider: IntegrationProvider): string {
  return isCodeHostProvider(provider) ? "code_host_offline" : `${provider}_offline`;
}

function slowFallbackKey(provider: IntegrationProvider): string {
  return isCodeHostProvider(provider) ? "code_host_slow" : `${provider}_slow`;
}

function determineLevel(
  requiredHealth: IntegrationHealth[],
  optionalHealth: IntegrationHealth[],
  codeHostUnresolved = false
): FallbackLevel {
  if (requiredHealth.length === 0) {
    if (codeHostUnresolved) {
      const optionalProblem = optionalHealth.some(
        (entry) => entry.status === "offline" || entry.status === "degraded"
      );
      return optionalProblem ? "partial" : "full";
    }
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
