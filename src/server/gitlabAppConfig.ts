export type GitLabAppConfig = {
  clientId: string;
  clientSecret: string;
  /** Root URL of the GitLab instance — defaults to https://gitlab.com. */
  gitlabBaseUrl: string;
  /** Public HTTPS base for the OAuth callback (e.g. https://api.coop-ai.dev). */
  publicBaseUrl: string;
};

/** Default GitLab host for cloud SaaS (launch). Self-hosted GitLab is a later concern. */
export const DEFAULT_GITLAB_HOST = "https://gitlab.com";

/** REST API base for gitlab.com — use gitlabApiBaseUrl() when GITLAB_BASE_URL may differ. */
export const DEFAULT_GITLAB_API_BASE = `${DEFAULT_GITLAB_HOST}/api/v4`;

/** Resolves the GitLab REST API base from a host root (e.g. https://gitlab.com → …/api/v4). */
export function gitlabApiBaseUrl(hostRoot: string = DEFAULT_GITLAB_HOST): string {
  const normalized = hostRoot.replace(/\/$/, "");
  return normalized.endsWith("/api/v4") ? normalized : `${normalized}/api/v4`;
}

/**
 * Loads GitLab OAuth App configuration from environment variables.
 * Returns undefined when GITLAB_APP_ID or GITLAB_APP_SECRET are absent so
 * the server can start in a degraded state without GitLab support.
 *
 * Required env vars:
 *   GITLAB_APP_ID      – GitLab OAuth App client_id
 *   GITLAB_APP_SECRET  – GitLab OAuth App client_secret
 *
 * Optional:
 *   GITLAB_BASE_URL    – Root URL for self-hosted GitLab (default https://gitlab.com)
 *   WEBHOOK_DOMAIN / COOP_PUBLIC_API_URL – Public API base URL for the callback redirect
 */
export function loadGitLabAppConfig(env: NodeJS.ProcessEnv = process.env): GitLabAppConfig | undefined {
  const clientId = env.GITLAB_APP_ID?.trim();
  const clientSecret = env.GITLAB_APP_SECRET?.trim();
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
    gitlabBaseUrl: (env.GITLAB_BASE_URL?.trim() || DEFAULT_GITLAB_HOST).replace(/\/$/, ""),
    publicBaseUrl: publicBaseUrl.replace(/\/$/, "")
  };
}
