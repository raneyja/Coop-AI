import { fetchWithTimeout } from "../networkResilience";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const MESSAGE_CACHE_TTL_MS = 60 * 60 * 1000;

export type TeamsClientOptions = {
  accessToken: string;
  graphBaseUrl?: string;
  now?: () => number;
};

export type TeamsMessage = {
  id: string;
  createdAt: string;
  fromUserId?: string;
  fromUserName?: string;
  body: string;
  webUrl?: string;
};

export type TeamsThread = {
  teamId: string;
  channelId: string;
  rootMessageId: string;
  messages: TeamsMessage[];
  participants: string[];
};

export type TeamsSearchHit = {
  teamId: string;
  channelId: string;
  messageId: string;
  body: string;
  fromUserName?: string;
  createdAt: string;
  webUrl?: string;
};

export type TeamsUserInfo = {
  id: string;
  displayName: string;
  email?: string;
  jobTitle?: string;
};

export class TeamsApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "TeamsApiError";
  }
}

type CacheEntry<T> = { data: T; expiresAt: number };

export class TeamsClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly now: () => number;
  private readonly threadCache = new Map<string, CacheEntry<TeamsThread>>();

  public constructor(private readonly options: TeamsClientOptions) {
    this.baseUrl = (options.graphBaseUrl ?? GRAPH_API).replace(/\/+$/, "");
    this.headers = {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    this.now = options.now ?? (() => Date.now());
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request<{ displayName?: string }>("/me");
      return { ok: true, message: "Microsoft Teams connection successful." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Teams connection failed."
      };
    }
  }

  /**
   * Search team channel messages the user can access.
   */
  public async searchMessages(query: string, options?: { limit?: number }): Promise<TeamsSearchHit[]> {
    const limit = options?.limit ?? 25;
    const encoded = encodeURIComponent(query);
    const result = await this.request<{
      value?: Array<{
        id: string;
        summary?: string;
        resource?: {
          id?: string;
          "@odata.type"?: string;
          channelIdentity?: { teamId?: string; channelId?: string };
          from?: { user?: { displayName?: string; id?: string } };
          body?: { content?: string };
          createdDateTime?: string;
          webUrl?: string;
        };
      }>;
    }>(`/search/query`, {
      method: "POST",
      body: {
        requests: [
          {
            entityTypes: ["chatMessage"],
            query: { queryString: query },
            from: 0,
            size: Math.min(limit, 50)
          }
        ]
      }
    });

    const hits: TeamsSearchHit[] = [];
    for (const container of result.value ?? []) {
      const resource = container.resource;
      if (!resource?.channelIdentity) {
        continue;
      }
      hits.push({
        teamId: resource.channelIdentity.teamId ?? "",
        channelId: resource.channelIdentity.channelId ?? "",
        messageId: resource.id ?? container.id,
        body: stripHtml(resource.body?.content ?? container.summary ?? ""),
        fromUserName: resource.from?.user?.displayName,
        createdAt: resource.createdDateTime ?? new Date(0).toISOString(),
        webUrl: resource.webUrl
      });
    }
    return hits.slice(0, limit);
  }

  public async getThread(teamId: string, channelId: string, messageId: string): Promise<TeamsThread> {
    const cacheKey = `${teamId}:${channelId}:${messageId}`;
    const cached = this.threadCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const root = await this.request<TeamsGraphMessage>(
      `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`
    );

    const replies = await this.request<{ value?: TeamsGraphMessage[] }>(
      `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`
    );

    const allRaw = [root, ...(replies.value ?? [])];
    const participants = new Set<string>();
    const messages: TeamsMessage[] = allRaw.map((msg) => {
      const name = msg.from?.user?.displayName ?? msg.from?.application?.displayName ?? "unknown";
      participants.add(name);
      return {
        id: msg.id,
        createdAt: msg.createdDateTime ?? new Date(0).toISOString(),
        fromUserId: msg.from?.user?.id,
        fromUserName: name,
        body: stripHtml(msg.body?.content ?? ""),
        webUrl: msg.webUrl
      };
    });

    const thread: TeamsThread = {
      teamId,
      channelId,
      rootMessageId: messageId,
      messages,
      participants: [...participants]
    };

    this.threadCache.set(cacheKey, {
      data: thread,
      expiresAt: this.now() + MESSAGE_CACHE_TTL_MS
    });
    return thread;
  }

  public async getUserInfo(userId: string): Promise<TeamsUserInfo> {
    const user = await this.request<{
      id: string;
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
      jobTitle?: string;
    }>(`/users/${encodeURIComponent(userId)}`);

    return {
      id: user.id,
      displayName: user.displayName ?? userId,
      email: user.mail ?? user.userPrincipalName,
      jobTitle: user.jobTitle
    };
  }

  public extractDecisionSignals(thread: TeamsThread): Array<{ text: string; user: string; date: string }> {
    const keywords =
      /\b(decided|decision|approved|reject(?:ed)?|alternative|trade-?off|constraint|consensus|agreed|chose|chosen|instead of|rather than)\b/i;
    return thread.messages
      .filter((msg) => keywords.test(msg.body))
      .map((msg) => ({
        text: msg.body,
        user: msg.fromUserName ?? "unknown",
        date: msg.createdAt
      }));
  }

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const response = await fetchWithTimeout(
      url,
      {
        method: options?.method ?? "GET",
        headers: this.headers,
        body: options?.body ? JSON.stringify(options.body) : undefined
      },
      20_000
    );

    if ("timeout" in response) {
      throw new TeamsApiError(response.message);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new TeamsApiError(text || `Graph HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }
}

type TeamsGraphMessage = {
  id: string;
  createdDateTime?: string;
  webUrl?: string;
  from?: {
    user?: { id?: string; displayName?: string };
    application?: { displayName?: string };
  };
  body?: { content?: string };
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
