import { signOAuthState, verifyOAuthState } from "./oauthState";

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "openid", "email", "profile"].join(" ");

export type GoogleDocsAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type GoogleDocsOAuthResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  displayName?: string;
  email?: string;
};

export class GoogleDocsAppService {
  public constructor(private readonly options: GoogleDocsAppServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state: signOAuthState(orgId, this.options.stateSecret)
    });
    return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<GoogleDocsOAuthResult> {
    const tokenResponse = await fetch(GOOGLE_TOKEN, {
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
      throw new Error(`Google token exchange failed (${tokenResponse.status}): ${body}`);
    }
    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token ?? "");
    if (!accessToken) {
      throw new Error("Google token response missing access_token");
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
      email: profile.email
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "coop-ai-backend"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken
      }).toString()
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google token refresh failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new Error("Google refresh response missing access_token");
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
      const response = await fetch(GOOGLE_USERINFO, {
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
        displayName: typeof data.name === "string" ? data.name : undefined,
        email: typeof data.email === "string" ? data.email : undefined
      };
    } catch {
      return {};
    }
  }
}

export function createGoogleDocsAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): GoogleDocsAppService {
  return new GoogleDocsAppService({ clientId, clientSecret, stateSecret });
}
