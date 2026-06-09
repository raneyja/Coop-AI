import { signOAuthState, verifyOAuthState } from "./oauthState";

const ATLASSIAN_AUTHORIZE = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_RESOURCES = "https://api.atlassian.com/oauth/token/accessible-resources";
const ATLASSIAN_ME = "https://api.atlassian.com/me";

const ATLASSIAN_SCOPES = [
  "read:jira-work",
  "read:confluence-content.all",
  "read:confluence-space.summary",
  "search:confluence",
  "read:me",
  "offline_access"
].join(" ");

export type AtlassianAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type AtlassianOAuthResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  email?: string;
};

export class AtlassianAppService {
  public constructor(private readonly options: AtlassianAppServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.options.clientId,
      scope: ATLASSIAN_SCOPES,
      redirect_uri: redirectUri,
      state: signOAuthState(orgId, this.options.stateSecret),
      response_type: "code",
      prompt: "consent"
    });
    return `${ATLASSIAN_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<AtlassianOAuthResult> {
    const tokenResponse = await fetch(ATLASSIAN_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "coop-ai-backend"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Atlassian token exchange failed (${tokenResponse.status}): ${body}`);
    }
    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token ?? "");
    if (!accessToken) {
      throw new Error("Atlassian token response missing access_token");
    }

    const [resource, profile] = await Promise.all([
      this.fetchPrimaryResource(accessToken),
      this.fetchProfile(accessToken)
    ]);

    return {
      accessToken,
      refreshToken: typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : undefined,
      expiresAt:
        typeof tokenData.expires_in === "number"
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : undefined,
      cloudId: resource.cloudId,
      siteUrl: resource.siteUrl,
      siteName: resource.siteName,
      email: profile.email
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(ATLASSIAN_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "coop-ai-backend"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Atlassian token refresh failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new Error("Atlassian refresh response missing access_token");
    }
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
      expiresAt:
        typeof data.expires_in === "number"
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined
    };
  }

  private async fetchPrimaryResource(accessToken: string): Promise<{
    cloudId: string;
    siteUrl: string;
    siteName: string;
  }> {
    const response = await fetch(ATLASSIAN_RESOURCES, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "coop-ai-backend"
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Atlassian accessible-resources failed (${response.status}): ${body}`);
    }
    const resources = (await response.json()) as Array<Record<string, unknown>>;
    const primary = resources[0];
    if (!primary) {
      throw new Error("No accessible Atlassian sites found for this account");
    }
    const siteUrl = String(primary.url ?? "").replace(/\/$/, "");
    return {
      cloudId: String(primary.id ?? ""),
      siteUrl,
      siteName: String(primary.name ?? siteUrl)
    };
  }

  private async fetchProfile(accessToken: string): Promise<{ email?: string }> {
    try {
      const response = await fetch(ATLASSIAN_ME, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "coop-ai-backend"
        }
      });
      if (!response.ok) {
        return {};
      }
      const data = (await response.json()) as Record<string, unknown>;
      return { email: typeof data.email === "string" ? data.email : undefined };
    } catch {
      return {};
    }
  }
}

export function createAtlassianAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): AtlassianAppService {
  return new AtlassianAppService({ clientId, clientSecret, stateSecret });
}
