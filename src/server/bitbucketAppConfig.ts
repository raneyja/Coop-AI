import { resolvePublicBaseUrl } from "./publicBaseUrl";

export type BitbucketAppConfig = {
  clientId: string;
  clientSecret: string;
  /** Public HTTPS base for the OAuth callback (e.g. https://api.coop-ai.dev). */
  publicBaseUrl: string;
};

/**
 * Loads Bitbucket OAuth consumer configuration from environment variables.
 * Returns undefined when BITBUCKET_APP_ID or BITBUCKET_APP_SECRET are absent.
 *
 * Required env vars:
 *   BITBUCKET_APP_ID      – OAuth consumer key (client_id)
 *   BITBUCKET_APP_SECRET  – OAuth consumer secret (client_secret)
 *
 * Optional:
 *   WEBHOOK_DOMAIN / COOP_PUBLIC_BASE_URL – Public API base URL for the callback redirect
 *
 * Auth model: OAuth 2.0 authorization code (not Bitbucket Connect JWT).
 * Register the callback URL in your Bitbucket OAuth consumer settings:
 *   {publicBaseUrl}/v1/bitbucket/app/callback
 */
export function loadBitbucketAppConfig(env: NodeJS.ProcessEnv = process.env): BitbucketAppConfig | undefined {
  const clientId = env.BITBUCKET_APP_ID?.trim();
  const clientSecret = env.BITBUCKET_APP_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    publicBaseUrl: resolvePublicBaseUrl(env)
  };
}
