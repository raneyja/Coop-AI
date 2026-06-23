import { fetchWithTimeout, isFetchTimeout } from "../networkResilience";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export type NotionClientOptions = {
  token: string;
};

export type NotionPage = {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
};

export class NotionApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

export class NotionClient {
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: NotionClientOptions) {
    this.headers = {
      Authorization: `Bearer ${options.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    };
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.request<{ bot?: { owner?: { user?: { name?: string } } } }>("/users/me");
      const name = result.bot?.owner?.user?.name;
      return {
        ok: true,
        message: name ? `Notion is reachable (${name}).` : "Notion is reachable."
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Notion test failed."
      };
    }
  }

  public async searchPages(query: string, limit = 20): Promise<NotionPage[]> {
    const result = await this.request<{
      results?: Array<{
        id: string;
        url?: string;
        last_edited_time?: string;
        properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
      }>;
    }>("/search", {
      method: "POST",
      body: {
        query,
        page_size: Math.min(limit, 50),
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" }
      }
    });

    return (result.results ?? []).map((page) => ({
      id: page.id,
      title: extractNotionTitle(page.properties) ?? "Untitled",
      updated: page.last_edited_time ?? new Date(0).toISOString(),
      htmlUrl: page.url ?? ""
    }));
  }

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetchWithTimeout(`${NOTION_API}${path}`, {
      method: options?.method ?? "GET",
      headers: this.headers,
      body: options?.body ? JSON.stringify(options.body) : undefined
    });

    if (isFetchTimeout(response)) {
      throw new NotionApiError(response.message);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new NotionApiError(body || `Notion request failed (${response.status}).`, response.status);
    }

    return (await response.json()) as T;
  }
}

function extractNotionTitle(
  properties: Record<string, { title?: Array<{ plain_text?: string }> }> | undefined
): string | undefined {
  if (!properties) {
    return undefined;
  }
  for (const value of Object.values(properties)) {
    const text = value.title?.map((part) => part.plain_text ?? "").join("").trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}
