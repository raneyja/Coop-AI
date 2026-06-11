import { signOAuthState, verifyOAuthState } from "./oauthState";

const MICROSOFT_AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";

const TEAMS_SCOPES = [
  "User.Read",
  "Team.ReadBasic.All",
  "ChannelMessage.Read.All",
  "offline_access"
].join(" ");

export type TeamsAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type TeamsOAuthResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  displayName?: string;
  email?: string;
  tenantId?: string;
};

export class TeamsAppService {
  public constructor(private readonly options: TeamsAppServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: TEAMS_SCOPES,
      state: signOAuthState(orgId, this.options.stateSecret)
    });
    return `${MICROSOFT_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<TeamsOAuthResult> {
    const tokenResponse = await fetch(MICROSOFT_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Microsoft token exchange failed (${tokenResponse.status}): ${body}`);
    }
    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token ?? "");
    if (!accessToken) {
      throw new Error("Microsoft token response missing access_token");
    }

    const profile = await this.fetchProfile(accessToken);
    return {
      accessToken,
      refreshToken: typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : undefined,
      expiresAt:
        typeof tokenData.expires_in === "number"
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : undefined,
      displayName: profile.displayName,
      email: profile.email,
      tenantId: typeof tokenData.tenant_id === "string" ? tokenData.tenant_id : undefined
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(MICROSOFT_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken,
        scope: TEAMS_SCOPES
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Microsoft token refresh failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new Error("Microsoft refresh response missing access_token");
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

  private async fetchProfile(accessToken: string): Promise<{ displayName?: string; email?: string }> {
    try {
      const response = await fetch(GRAPH_ME, {
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
      return {
        displayName: typeof data.displayName === "string" ? data.displayName : undefined,
        email:
          typeof data.mail === "string"
            ? data.mail
            : typeof data.userPrincipalName === "string"
              ? data.userPrincipalName
              : undefined
      };
    } catch {
      return {};
    }
  }
}

export function createTeamsAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): TeamsAppService {
  return new TeamsAppService({ clientId, clientSecret, stateSecret });
}
