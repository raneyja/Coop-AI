import { resolvePublicBaseUrl } from "./publicBaseUrl";

export type NotionOAuthConfig = {
  mode: "oauth";
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

export type NotionInternalConfig = {
  mode: "internal";
  integrationToken: string;
  publicBaseUrl: string;
};

export type NotionAppConfig = NotionOAuthConfig | NotionInternalConfig;

/**
 * Notion org integration — OAuth (public integration) or internal installation token.
 *
 * OAuth:
 *   NOTION_APP_CLIENT_ID
 *   NOTION_APP_CLIENT_SECRET
 *
 * Internal (same token as scripts/populate_notion.py seeder):
 *   NOTION_INTEGRATION_TOKEN  — "Internal integration secret" from Configuration tab
 *
 * Do not put the OAuth client secret in NOTION_INTEGRATION_TOKEN.
 */
export function loadNotionAppConfig(env: NodeJS.ProcessEnv = process.env): NotionAppConfig | undefined {
  const publicBaseUrl = resolvePublicBaseUrl(env);

  const integrationToken = env.NOTION_INTEGRATION_TOKEN?.trim();
  if (integrationToken) {
    return { mode: "internal", integrationToken, publicBaseUrl };
  }

  const clientId = env.NOTION_APP_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_APP_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) {
    return { mode: "oauth", clientId, clientSecret, publicBaseUrl };
  }

  return undefined;
}

export function isNotionOAuthConfig(config: NotionAppConfig): config is NotionOAuthConfig {
  return config.mode === "oauth";
}
