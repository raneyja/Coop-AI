import { fetchWithTimeout } from "../networkResilience";

const SLACK_API = "https://slack.com/api";
const THREAD_CACHE_TTL_MS = 60 * 60 * 1000;

export type SlackClientOptions = {
  token: string;
  now?: () => number;
};

export type SlackMessage = {
  ts: string;
  userId: string;
  userName?: string;
  text: string;
  threadTs?: string;
  permalink?: string;
};

export type SlackThread = {
  channelId: string;
  threadTs: string;
  messages: SlackMessage[];
  participants: string[];
};

export type SlackChannelInfo = {
  id: string;
  name: string;
  topic?: string;
  description?: string;
  isPrivate: boolean;
};

export type SlackUserInfo = {
  id: string;
  name: string;
  realName?: string;
  avatarUrl?: string;
  statusText?: string;
};

export type SlackSearchHit = {
  channelId: string;
  channelName?: string;
  ts: string;
  text: string;
  userId: string;
  userName?: string;
  permalink?: string;
  threadTs?: string;
};

export class SlackApiError extends Error {
  public constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

type CacheEntry<T> = { data: T; expiresAt: number };

export class SlackClient {
  private readonly headers: Record<string, string>;
  private readonly now: () => number;
  private readonly threadCache = new Map<string, CacheEntry<SlackThread>>();

  public constructor(private readonly options: SlackClientOptions) {
    this.headers = {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json; charset=utf-8"
    };
    this.now = options.now ?? (() => Date.now());
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.api<{ ok: boolean; team?: string; error?: string }>("auth.test");
      if (!result.ok) {
        return { ok: false, message: result.error ?? "Slack auth failed." };
      }
      return { ok: true, message: `Connected to Slack workspace${result.team ? `: ${result.team}` : ""}.` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Slack connection failed."
      };
    }
  }

  /**
   * Search messages the authenticated user can access (channels, groups, DMs).
   */
  public async searchMessages(query: string, options?: { limit?: number }): Promise<SlackSearchHit[]> {
    const limit = options?.limit ?? 20;
    const result = await this.api<{
      ok: boolean;
      messages?: {
        matches?: Array<{
          channel?: { id: string; name?: string };
          ts: string;
          text: string;
          user?: string;
          username?: string;
          permalink?: string;
          thread_ts?: string;
        }>;
      };
      error?: string;
    }>("search.messages", {
      method: "GET",
      query: {
        query,
        count: String(Math.min(limit, 100)),
        sort: "timestamp",
        sort_dir: "desc"
      }
    });

    if (!result.ok) {
      throw new SlackApiError(result.error ?? "search.messages failed", result.error);
    }

    const matches = result.messages?.matches ?? [];
    return matches.map((match) => ({
      channelId: match.channel?.id ?? "",
      channelName: match.channel?.name,
      ts: match.ts,
      text: match.text,
      userId: match.user ?? "",
      userName: match.username,
      permalink: match.permalink,
      threadTs: match.thread_ts
    }));
  }

  public async getThread(channelId: string, threadTs: string): Promise<SlackThread> {
    const cacheKey = `${channelId}:${threadTs}`;
    const cached = this.threadCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const replies = await this.api<{
      ok: boolean;
      messages?: Array<{
        ts: string;
        user?: string;
        text: string;
        thread_ts?: string;
      }>;
      error?: string;
    }>("conversations.replies", {
      method: "GET",
      query: { channel: channelId, ts: threadTs, limit: "200" }
    });

    if (!replies.ok) {
      throw new SlackApiError(replies.error ?? "conversations.replies failed", replies.error);
    }

    const rawMessages = replies.messages ?? [];
    const userIds = new Set<string>();
    const messages: SlackMessage[] = [];

    for (const msg of rawMessages) {
      if (msg.user) {
        userIds.add(msg.user);
      }
    }

    const userNames = await this.resolveUserNames([...userIds]);

    for (const msg of rawMessages) {
      messages.push({
        ts: msg.ts,
        userId: msg.user ?? "unknown",
        userName: msg.user ? userNames.get(msg.user) : undefined,
        text: msg.text,
        threadTs: msg.thread_ts
      });
    }

    const thread: SlackThread = {
      channelId,
      threadTs,
      messages,
      participants: [...userIds].map((id) => userNames.get(id) ?? id)
    };

    this.threadCache.set(cacheKey, {
      data: thread,
      expiresAt: this.now() + THREAD_CACHE_TTL_MS
    });
    return thread;
  }

  public async getUserInfo(userId: string): Promise<SlackUserInfo> {
    const result = await this.api<{
      ok: boolean;
      user?: {
        id: string;
        name: string;
        real_name?: string;
        profile?: { image_48?: string; status_text?: string };
      };
      error?: string;
    }>("users.info", { method: "GET", query: { user: userId } });

    if (!result.ok || !result.user) {
      throw new SlackApiError(result.error ?? "users.info failed", result.error);
    }

    return {
      id: result.user.id,
      name: result.user.name,
      realName: result.user.real_name,
      avatarUrl: result.user.profile?.image_48,
      statusText: result.user.profile?.status_text
    };
  }

  public async getChannelInfo(channelId: string): Promise<SlackChannelInfo> {
    const result = await this.api<{
      ok: boolean;
      channel?: {
        id: string;
        name: string;
        topic?: { value?: string };
        purpose?: { value?: string };
        is_private?: boolean;
      };
      error?: string;
    }>("conversations.info", { method: "GET", query: { channel: channelId } });

    if (!result.ok || !result.channel) {
      throw new SlackApiError(result.error ?? "conversations.info failed", result.error);
    }

    return {
      id: result.channel.id,
      name: result.channel.name,
      topic: result.channel.topic?.value,
      description: result.channel.purpose?.value,
      isPrivate: Boolean(result.channel.is_private)
    };
  }

  /**
   * Extract decision-relevant snippets from a thread.
   */
  public extractDecisionSignals(thread: SlackThread): Array<{ text: string; user: string; ts: string }> {
    const keywords =
      /\b(decided|decision|approved|reject(?:ed)?|alternative|trade-?off|constraint|consensus|agreed|chose|chosen|instead of|rather than)\b/i;
    return thread.messages
      .filter((msg) => keywords.test(msg.text))
      .map((msg) => ({
        text: msg.text,
        user: msg.userName ?? msg.userId,
        ts: msg.ts
      }));
  }

  public parseSlackThreadUrl(url: string): { channelId: string; threadTs: string } | undefined {
    const archiveMatch = /slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/i.exec(url);
    if (!archiveMatch) {
      return undefined;
    }
    const channelId = archiveMatch[1];
    const rawTs = archiveMatch[2];
    const threadTs = `${rawTs.slice(0, -6)}.${rawTs.slice(-6)}`;
    return { channelId, threadTs };
  }

  private async resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      userIds.map(async (id) => {
        try {
          const user = await this.getUserInfo(id);
          map.set(id, user.realName ?? user.name);
        } catch {
          map.set(id, id);
        }
      })
    );
    return map;
  }

  private async api<T>(
    method: string,
    options?: { method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> }
  ): Promise<T> {
    const httpMethod = options?.method ?? "POST";
    let url = `${SLACK_API}/${method}`;

    if (httpMethod === "GET" && options?.query) {
      const params = new URLSearchParams(options.query);
      url = `${url}?${params.toString()}`;
    }

    const init: RequestInit = {
      method: httpMethod,
      headers: this.headers
    };

    if (httpMethod === "POST" && options?.body) {
      init.body = JSON.stringify(options.body);
    } else if (httpMethod === "POST" && options?.query) {
      init.body = new URLSearchParams(options.query).toString();
      init.headers = { ...this.headers, "Content-Type": "application/x-www-form-urlencoded" };
    }

    const response = await fetchWithTimeout(url, init, 15_000);
    if ("timeout" in response) {
      throw new SlackApiError(response.message);
    }
    if (!response.ok) {
      throw new SlackApiError(`Slack HTTP ${response.status}`, String(response.status));
    }
    return (await response.json()) as T;
  }
}
