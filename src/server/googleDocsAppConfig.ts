export type GoogleDocsAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * Google OAuth for Drive / Docs read access.
 *
 * Required:
 *   GOOGLE_DOCS_APP_CLIENT_ID
 *   GOOGLE_DOCS_APP_CLIENT_SECRET
 */
export function loadGoogleDocsAppConfig(env: NodeJS.ProcessEnv = process.env): GoogleDocsAppConfig | undefined {
  const clientId = env.GOOGLE_DOCS_APP_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_DOCS_APP_CLIENT_SECRET?.trim();
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
