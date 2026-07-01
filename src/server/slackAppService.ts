import { signOAuthState, verifyOAuthState } from "./oauthState";

const SLACK_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN = "https://slack.com/api/oauth.v2.access";

/** Bot scopes for public channel metadata and history where the app is installed. */
const SLACK_BOT_SCOPES = [
  "channels:read",
  "groups:read",
  "channels:history",
  "users:read",
  "users:read.email"
].join(",");

/** User scopes for workspace search, presence, and profile lookup (search:read is user-only). */
const SLACK_USER_SCOPES = [
  "search:read",
  "channels:history",
  "groups:history",
  "users:read",
  "users:read.email"
].join(",");

export type SlackAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type SlackOAuthResult = {
  /** User token — used for presence and user lookup. */
  userAccessToken: string;
  botAccessToken?: string;
  teamId: string;
  teamName: string;
  authedUserId?: string;
  expiresAt?: Date;
  refreshToken?: string;
};

export class SlackAppService {
  public constructor(private readonly options: SlackAppServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      scope: SLACK_BOT_SCOPES,
      user_scope: SLACK_USER_SCOPES,
      state: signOAuthState(orgId, this.options.stateSecret)
    });
    return `${SLACK_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<SlackOAuthResult> {
    const response = await fetch(SLACK_TOKEN, {
      method: "POST",
      headers: {
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
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.ok === false) {
      throw new Error(typeof data.error === "string" ? data.error : "Slack token exchange failed");
    }

    const team = data.team as Record<string, unknown> | undefined;
    const authedUser = data.authed_user as Record<string, unknown> | undefined;
    const userAccessToken =
      typeof authedUser?.access_token === "string"
        ? authedUser.access_token
        : typeof data.access_token === "string"
          ? data.access_token
          : "";
    if (!userAccessToken) {
      throw new Error("Slack OAuth response missing user access token");
    }

    return {
      userAccessToken,
      botAccessToken: typeof data.access_token === "string" ? data.access_token : undefined,
      teamId: String(team?.id ?? ""),
      teamName: String(team?.name ?? "Slack workspace"),
      authedUserId: typeof authedUser?.id === "string" ? authedUser.id : undefined,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresAt:
        typeof data.expires_in === "number"
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(SLACK_TOKEN, {
      method: "POST",
      headers: {
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
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.ok === false) {
      throw new Error(typeof data.error === "string" ? data.error : "Slack token refresh failed");
    }
    const accessToken =
      typeof data.access_token === "string"
        ? data.access_token
        : typeof data.authed_user === "object" &&
            data.authed_user !== null &&
            typeof (data.authed_user as Record<string, unknown>).access_token === "string"
          ? String((data.authed_user as Record<string, unknown>).access_token)
          : "";
    if (!accessToken) {
      throw new Error("Slack refresh response missing access token");
    }
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresAt:
        typeof data.expires_in === "number"
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined
    };
  }
}

export function createSlackAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): SlackAppService {
  return new SlackAppService({ clientId, clientSecret, stateSecret });
}
