import { signOAuthState, verifyOAuthState } from "./oauthState";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";

/** Scopes for repo file access, blame, and PR search via user token. */
const GITHUB_OAUTH_SCOPES = ["read:user", "read:org", "repo"].join(" ");

export type GitHubOAuthServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type GitHubOAuthTokenResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
};

export class GitHubOAuthService {
  public constructor(private readonly options: GitHubOAuthServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string, options?: { promptConsent?: boolean }): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      scope: GITHUB_OAUTH_SCOPES,
      state: signOAuthState(orgId, this.options.stateSecret)
    });
    if (options?.promptConsent !== false) {
      params.set("prompt", "consent");
    }
    return `${GITHUB_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<GitHubOAuthTokenResult> {
    const response = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub token exchange failed (${response.status}): ${body}`);
    }
    return parseTokenResponse((await response.json()) as Record<string, unknown>);
  }

  public async refreshAccessToken(refreshToken: string): Promise<GitHubOAuthTokenResult> {
    const response = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub token refresh failed (${response.status}): ${body}`);
    }
    return parseTokenResponse((await response.json()) as Record<string, unknown>, refreshToken);
  }
}

export function createGitHubOAuthService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): GitHubOAuthService {
  return new GitHubOAuthService({ clientId, clientSecret, stateSecret });
}

function parseTokenResponse(
  data: Record<string, unknown>,
  fallbackRefreshToken?: string
): GitHubOAuthTokenResult {
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) {
    throw new Error("GitHub token response missing access_token");
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 8 * 60 * 60;
  const refreshToken =
    typeof data.refresh_token === "string" && data.refresh_token.trim()
      ? data.refresh_token.trim()
      : fallbackRefreshToken;
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: typeof data.scope === "string" ? data.scope : undefined
  };
}
