export type NotionAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * Notion OAuth (public integration).
 *
 * Required:
 *   NOTION_APP_CLIENT_ID
 *   NOTION_APP_CLIENT_SECRET
 */
export function loadNotionAppConfig(env: NodeJS.ProcessEnv = process.env): NotionAppConfig | undefined {
  const clientId = env.NOTION_APP_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_APP_CLIENT_SECRET?.trim();
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
