import type { IntegrationChatProvider } from "./types";

/**
 * Plain English must never enter the `/slack` (etc.) single-route pipeline.
 * Named tools still prefetch via the planner `tools` / `fetchIntegrations` allowlist.
 * Explicit `/slack` sets `integrationProvider` from the slash constraint, not here.
 */
export function resolvePlainChatIntegrationProvider(_options: {
  message: string;
  isConnected: (provider: IntegrationChatProvider) => boolean;
}): IntegrationChatProvider | undefined {
  return undefined;
}
