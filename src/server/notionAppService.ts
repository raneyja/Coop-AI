import { signOAuthState, verifyOAuthState } from "./oauthState";

const NOTION_AUTHORIZE = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN = "https://api.notion.com/v1/oauth/token";

export type NotionAppServiceOptions = {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
};

export type NotionOAuthResult = {
  accessToken: string;
  refreshToken?: string;
  workspaceId: string;
  workspaceName: string;
  botId?: string;
};

export class NotionAppService {
  public constructor(private readonly options: NotionAppServiceOptions) {}

  public buildAuthorizeUrl(redirectUri: string, orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: "code",
      owner: "user",
      redirect_uri: redirectUri,
      state: signOAuthState(orgId, this.options.stateSecret)
    });
    return `${NOTION_AUTHORIZE}?${params.toString()}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    return verifyOAuthState(state, this.options.stateSecret);
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<NotionOAuthResult> {
    const credentials = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const response = await fetch(NOTION_TOKEN, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        "User-Agent": "coop-ai-backend"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion token exchange failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new Error("Notion token response missing access_token");
    }
    const workspaceName =
      typeof data.workspace_name === "string" ? data.workspace_name : "Notion workspace";
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      workspaceId: String(data.workspace_id ?? ""),
      workspaceName,
      botId: typeof data.bot_id === "string" ? data.bot_id : undefined
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
  }> {
    const credentials = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const response = await fetch(NOTION_TOKEN, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        "User-Agent": "coop-ai-backend"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion token refresh failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new Error("Notion refresh response missing access_token");
    }
    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken
    };
  }
}

export function createNotionAppService(
  clientId: string,
  clientSecret: string,
  stateSecret: string
): NotionAppService {
  return new NotionAppService({ clientId, clientSecret, stateSecret });
}
