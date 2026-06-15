export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

/**
 * GitHub OAuth App (user authorization) — simpler local setup than a full GitHub App.
 *
 * Required:
 *   GITHUB_OAUTH_CLIENT_ID
 *   GITHUB_OAUTH_CLIENT_SECRET
 *
 * Callback URL to register on the OAuth app:
 *   {WEBHOOK_DOMAIN}/v1/github/app/callback
 */
export function loadGitHubOAuthConfig(env: NodeJS.ProcessEnv = process.env): GitHubOAuthConfig | undefined {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  const publicBaseUrl =
    env.WEBHOOK_DOMAIN?.trim() ||
    env.COOP_PUBLIC_BASE_URL?.trim() ||
    env.COOP_PUBLIC_API_URL?.trim() ||
    `http://localhost:${env.PORT ?? "8787"}`;
  return {
    clientId,
    clientSecret,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, "")
  };
}
