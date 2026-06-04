import { createHash, createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

export type GitLabAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  gitlabBaseUrl: string;
  /** Signing key for OAuth state tokens — use the server's CREDENTIALS_ENCRYPTION_KEY. */
  stateSecret: string;
};

export type GitLabTokenResult = {
  accessToken: string;
  /** May be empty for providers that do not rotate refresh tokens. */
  refreshToken: string;
  expiresAt: Date;
};

export class GitLabAppService {
  public constructor(private readonly options: GitLabAppServiceOptions) {}

  /**
   * Returns the GitLab OAuth authorize URL the user should be sent to.
   * The redirectUri must exactly match the URI registered in the GitLab OAuth
   * App settings and must be the same value passed to exchangeCode.
   */
  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const state = this.signState(orgId);
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: "api read_repository"
    });
    return `${this.options.gitlabBaseUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Verifies the HMAC state token returned by GitLab's callback and extracts
   * the orgId.  Returns undefined for any invalid, expired, or tampered state.
   * State tokens are valid for 60 minutes.
   */
  public verifyAndParseState(state: string): string | undefined {
    const parts = state.split(".");
    if (parts.length !== 3) {
      return undefined;
    }
    const [orgId, issuedAt, signature] = parts;
    if (!orgId || !issuedAt || !signature) {
      return undefined;
    }
    const ageMs = Date.now() - Number(issuedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60 * 60 * 1000) {
      return undefined;
    }
    const expected = this.stateSignature(orgId, issuedAt);
    if (!safeEqual(signature, expected)) {
      return undefined;
    }
    return orgId;
  }

  public signState(orgId: string): string {
    const issuedAt = String(Date.now());
    const signature = this.stateSignature(orgId, issuedAt);
    return `${orgId}.${issuedAt}.${signature}`;
  }

  /**
   * Exchanges an authorization code for access and refresh tokens.
   * The redirectUri must be identical to the one used in buildAuthorizeUrl.
   */
  public async exchangeCode(code: string, redirectUri: string): Promise<GitLabTokenResult> {
    const response = await fetch(`${this.options.gitlabBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitLab token exchange failed (${response.status}): ${body}`);
    }
    return parseTokenResponse(await response.json() as Record<string, unknown>);
  }

  /**
   * Exchanges a refresh token for a new access token.
   * GitLab may issue a new refresh token on each call; callers should persist
   * the returned refreshToken if non-empty.
   */
  public async refreshAccessToken(refreshToken: string): Promise<GitLabTokenResult> {
    const response = await fetch(`${this.options.gitlabBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitLab token refresh failed (${response.status}): ${body}`);
    }
    return parseTokenResponse(await response.json() as Record<string, unknown>);
  }

  private stateSignature(orgId: string, issuedAt: string): string {
    return createHmac("sha256", this.options.stateSecret)
      .update(`${orgId}:${issuedAt}`)
      .digest("hex");
  }
}

/**
 * Derives a deterministic, per-org installation ID for use in
 * code_host_installations.  GitLab has no native installation concept so we
 * synthesise a stable numeric identifier from the orgId.
 * 44-bit value — well within BIGINT and Number.MAX_SAFE_INTEGER.
 */
export function gitlabSyntheticInstallationId(orgId: string): number {
  const hash = createHash("sha256").update(`gitlab:${orgId}`).digest("hex");
  return parseInt(hash.slice(0, 11), 16);
}

/**
 * Factory — mirrors the createGithubAppService pattern in
 * codeHostCredentialResolver.ts.  Pass serverConfig.credentialsEncryptionKey
 * as stateSecret.
 */
export function createGitLabAppService(
  clientId: string,
  clientSecret: string,
  gitlabBaseUrl: string,
  stateSecret: string
): GitLabAppService {
  return new GitLabAppService({ clientId, clientSecret, gitlabBaseUrl, stateSecret });
}

function parseTokenResponse(data: Record<string, unknown>): GitLabTokenResult {
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("GitLab token response missing access_token");
  }
  const createdAt =
    typeof data.created_at === "number" ? data.created_at : Math.floor(Date.now() / 1000);
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : "",
    expiresAt: new Date((createdAt + expiresIn) * 1000)
  };
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return cryptoTimingSafeEqual(aBuf, bBuf);
}
