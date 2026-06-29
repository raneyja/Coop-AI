import type { IntegrationProvider } from "./integrationConnectionStore";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";
import {
  parseSlackIntegrationPolicy,
  slackPolicyIsActive,
  type ResolvedIntegrationScope,
  type ScopeStatus
} from "../integrationScope/types";

export async function resolveIntegrationScope(options: {
  orgId: string;
  provider: IntegrationProvider;
  orgPlan: string;
  connected: boolean;
  scopePolicyStore?: IntegrationScopePolicyStore;
}): Promise<ResolvedIntegrationScope> {
  const { orgId, provider, orgPlan, connected, scopePolicyStore } = options;

  if (provider !== "slack") {
    return unrestricted(provider, "none");
  }

  if (orgPlan !== "enterprise") {
    return unrestricted(provider, "none");
  }

  if (!connected) {
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Slack is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const slackPolicy = parseSlackIntegrationPolicy(record?.policy);

  if (!slackPolicyIsActive(slackPolicy)) {
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Slack is connected but no channels are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  const channelIds = slackPolicy!.channels.map((channel) => channel.id);
  const channelNames = slackPolicy!.channels.map((channel) => channel.name);

  return {
    provider,
    enforced: true,
    allowed: true,
    scopeStatus: "active",
    slack: { channelIds, channelNames }
  };
}

export function scopeStatusFromResolved(scope: ResolvedIntegrationScope): ScopeStatus {
  return scope.scopeStatus;
}

function unrestricted(provider: IntegrationProvider, scopeStatus: ScopeStatus): ResolvedIntegrationScope {
  return {
    provider,
    enforced: false,
    allowed: true,
    scopeStatus
  };
}
