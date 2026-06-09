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
 *   WEBHOOK_DOMAIN / COOP_PUBLIC_API_URL — public API base for callback
 */
export function loadSlackAppConfig(env: NodeJS.ProcessEnv = process.env): SlackAppConfig | undefined {
  const clientId = env.SLACK_APP_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  const publicBaseUrl =
    env.WEBHOOK_DOMAIN?.trim() ||
    env.COOP_PUBLIC_API_URL?.trim() ||
    `http://localhost:${env.PORT ?? "8787"}`;
  return {
    clientId,
    clientSecret,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, "")
  };
}
