import type { IntegrationProvider } from "../server/integrationConnectionStore";

export type SlackChannelRef = {
  id: string;
  name: string;
};

export type SlackIntegrationPolicy = {
  version: 1;
  mode: "allowlist";
  channels: SlackChannelRef[];
};

export type IntegrationScopePolicy = SlackIntegrationPolicy;

export type ScopeStatus = "none" | "required" | "active";

export type ResolvedIntegrationScope = {
  provider: IntegrationProvider;
  enforced: boolean;
  allowed: boolean;
  scopeStatus: ScopeStatus;
  slack?: {
    channelIds: string[];
    channelNames: string[];
  };
  reason?: string;
};

export const SCOPE_GOVERNED_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs"
];

export function parseSlackIntegrationPolicy(raw: unknown): SlackIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.mode !== "allowlist") {
    return undefined;
  }
  const channelsRaw = record.channels;
  if (!Array.isArray(channelsRaw)) {
    return undefined;
  }
  const channels: SlackChannelRef[] = [];
  for (const entry of channelsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const channel = entry as Record<string, unknown>;
    const id = typeof channel.id === "string" ? channel.id.trim() : "";
    const name = typeof channel.name === "string" ? channel.name.trim() : "";
    if (id && name) {
      channels.push({ id, name });
    }
  }
  return {
    version: 1,
    mode: "allowlist",
    channels
  };
}

export function slackPolicyIsActive(policy: SlackIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.channels.length > 0);
}
