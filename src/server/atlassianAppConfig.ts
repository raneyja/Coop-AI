export type AtlassianAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * Atlassian OAuth 3LO (covers Jira + Confluence).
 *
 * Required:
 *   ATLASSIAN_APP_CLIENT_ID
 *   ATLASSIAN_APP_CLIENT_SECRET
 */
export function loadAtlassianAppConfig(env: NodeJS.ProcessEnv = process.env): AtlassianAppConfig | undefined {
  const clientId = env.ATLASSIAN_APP_CLIENT_ID?.trim();
  const clientSecret = env.ATLASSIAN_APP_CLIENT_SECRET?.trim();
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
