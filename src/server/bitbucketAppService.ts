import { createHash, createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

const BITBUCKET_OAUTH_BASE = "https://bitbucket.org/site/oauth2";

export type BitbucketAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  /** Signing key for OAuth state tokens — use the server's CREDENTIALS_ENCRYPTION_KEY. */
  stateSecret: string;
};

export type BitbucketTokenResult = {
  accessToken: string;
  /** May be empty when the provider does not rotate refresh tokens. */
  refreshToken: string;
  expiresAt: Date;
};

/**
 * Bitbucket Cloud OAuth 2.0 authorization code flow.
 *
 * We use OAuth 2.0 (not Bitbucket Connect JWT) so Bitbucket matches the GitLab
 * pattern: browser authorize → callback code exchange → access + refresh tokens
 * stored in code_host_installations / org_credentials.
 */
export class BitbucketAppService {
  public constructor(private readonly options: BitbucketAppServiceOptions) {}

  /**
   * Returns the Bitbucket OAuth authorize URL the user should be sent to.
   * redirectUri must match the URI registered on the OAuth consumer.
   */
  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const state = this.signState(orgId);
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state
    });
    return `${BITBUCKET_OAUTH_BASE}/authorize?${params.toString()}`;
  }

  /**
   * Verifies the HMAC state token returned by Bitbucket's callback and extracts
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
   * redirectUri must be identical to the one used in buildAuthorizeUrl.
   */
  public async exchangeCode(code: string, redirectUri: string): Promise<BitbucketTokenResult> {
    const response = await fetch(`${BITBUCKET_OAUTH_BASE}/access_token`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(this.options.clientId, this.options.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bitbucket token exchange failed (${response.status}): ${body}`);
    }
    return parseTokenResponse(await response.json() as Record<string, unknown>);
  }

  /**
   * Exchanges a refresh token for a new access token.
   * Bitbucket may rotate the refresh token; callers should persist if non-empty.
   */
  public async refreshAccessToken(refreshToken: string): Promise<BitbucketTokenResult> {
    const response = await fetch(`${BITBUCKET_OAUTH_BASE}/access_token`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(this.options.clientId, this.options.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bitbucket token refresh failed (${response.status}): ${body}`);
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
 * code_host_installations.  Bitbucket OAuth has no native installation concept.
 */
export function bitbucketSyntheticInstallationId(orgId: string): number {
  const hash = createHash("sha256").update(`bitbucket:${orgId}`).digest("hex");
  return parseInt(hash.slice(0, 11), 16);
}

export function createBitbucketAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): BitbucketAppService {
  return new BitbucketAppService({ clientId, clientSecret, stateSecret });
}

function parseTokenResponse(data: Record<string, unknown>): BitbucketTokenResult {
  const accessToken = data.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Bitbucket token response missing access_token");
  }
  // Bitbucket does not return created_at; use exchange time as issuance anchor.
  const createdAt = Math.floor(Date.now() / 1000);
  const expiresIn = readExpiresIn(data.expires_in);
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : "",
    expiresAt: new Date((createdAt + expiresIn) * 1000)
  };
}

/** Reads expires_in from the token response (seconds). Accepts number or numeric string. */
function readExpiresIn(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Bitbucket Cloud default is 7200s (2 hours); used only when expires_in is absent.
  return 7200;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return cryptoTimingSafeEqual(aBuf, bBuf);
}
