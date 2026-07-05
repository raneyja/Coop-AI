import { resolvePublicBaseUrl } from "./publicBaseUrl";

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
  return {
    clientId,
    clientSecret,
    publicBaseUrl: resolvePublicBaseUrl(env)
  };
}
