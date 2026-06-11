export type TeamsAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * Microsoft Entra / Graph OAuth for Teams message search.
 *
 * Required:
 *   TEAMS_APP_CLIENT_ID
 *   TEAMS_APP_CLIENT_SECRET
 */
export function loadTeamsAppConfig(env: NodeJS.ProcessEnv = process.env): TeamsAppConfig | undefined {
  const clientId = env.TEAMS_APP_CLIENT_ID?.trim();
  const clientSecret = env.TEAMS_APP_CLIENT_SECRET?.trim();
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
