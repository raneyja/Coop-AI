import { resolvePublicBaseUrl } from "./publicBaseUrl";

export type SlackAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * Slack OAuth app configuration.
 *
 * Required:
 *   SLACK_APP_CLIENT_ID
 *   SLACK_APP_CLIENT_SECRET
 *
 * Optional:
 *   WEBHOOK_DOMAIN / COOP_PUBLIC_BASE_URL — public API base for callback
 */
export function loadSlackAppConfig(env: NodeJS.ProcessEnv = process.env): SlackAppConfig | undefined {
  const clientId = env.SLACK_APP_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    publicBaseUrl: resolvePublicBaseUrl(env)
  };
}
