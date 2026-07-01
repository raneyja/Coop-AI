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
  parentId?: string;
  parentType?: string;
};

export type NotionScopeResource = {
  id: string;
  title: string;
  type: "page" | "database";
  parentId?: string;
  parentTitle?: string;
  parentType?: string;
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
      const profile = await this.getBotProfile();
      const name = profile.ownerName;
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

  public async getBotProfile(): Promise<{
    botId?: string;
    workspaceId?: string;
    workspaceName: string;
    ownerName?: string;
  }> {
    const result = await this.request<{
      id?: string;
      bot?: {
        owner?: { user?: { name?: string } };
        workspace_name?: string;
      };
      workspace_id?: string;
    }>("/users/me");
    return {
      botId: typeof result.id === "string" ? result.id : undefined,
      workspaceId: typeof result.workspace_id === "string" ? result.workspace_id : undefined,
      workspaceName:
        typeof result.bot?.workspace_name === "string"
          ? result.bot.workspace_name
          : "Notion workspace",
      ownerName: result.bot?.owner?.user?.name
    };
  }

  public async searchPages(query: string, limit = 20): Promise<NotionPage[]> {
    const result = await this.request<{
      results?: Array<{
        id: string;
        url?: string;
        last_edited_time?: string;
        parent?: NotionParent;
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
      htmlUrl: page.url ?? "",
      parentId: extractNotionParentId(page.parent),
      parentType: extractNotionParentType(page.parent)
    }));
  }

  public async searchResources(options?: {
    query?: string;
    limit?: number;
  }): Promise<NotionScopeResource[]> {
    const limit = Math.min(options?.limit ?? 100, 100);
    const query = options?.query?.trim() ?? "";
    const result = await this.request<{
      results?: Array<NotionSearchResultItem>;
    }>("/search", {
      method: "POST",
      body: {
        query,
        page_size: Math.min(limit, 50),
        sort: { direction: "descending", timestamp: "last_edited_time" }
      }
    });

    const resources: NotionScopeResource[] = [];
    for (const item of result.results ?? []) {
      const type = item.object === "database" ? "database" : item.object === "page" ? "page" : undefined;
      if (!type) {
        continue;
      }
      const title =
        type === "database"
          ? extractNotionDatabaseTitle(item.title)
          : extractNotionTitle(item.properties);
      resources.push({
        id: item.id,
        title: title ?? "Untitled",
        type,
        parentId: extractNotionParentId(item.parent),
        parentType: extractNotionParentType(item.parent),
        parentTitle: undefined
      });
      if (resources.length >= limit) {
        break;
      }
    }
    return resources;
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

type NotionParent = {
  type?: string;
  page_id?: string;
  database_id?: string;
  workspace?: boolean;
};

type NotionSearchResultItem = {
  object?: string;
  id: string;
  title?: Array<{ plain_text?: string }>;
  parent?: NotionParent;
  properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
};

function extractNotionDatabaseTitle(
  title: Array<{ plain_text?: string }> | undefined
): string | undefined {
  const text = title?.map((part) => part.plain_text ?? "").join("").trim();
  return text || undefined;
}

function extractNotionParentId(parent: NotionParent | undefined): string | undefined {
  if (!parent?.type) {
    return undefined;
  }
  if (parent.type === "page_id" && parent.page_id) {
    return parent.page_id;
  }
  if (parent.type === "database_id" && parent.database_id) {
    return parent.database_id;
  }
  return undefined;
}

function extractNotionParentType(parent: NotionParent | undefined): string | undefined {
  return parent?.type;
}
