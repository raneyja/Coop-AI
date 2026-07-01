import { fetchWithTimeout, isFetchTimeout } from "../networkResilience";
import { confluenceSiteUrlError, isPlaceholderAtlassianSite } from "./resolveConfluenceBaseUrl";

export type ConfluenceClientOptions = {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  oauthAccessToken?: string;
  cloudId?: string;
};

export type ConfluencePage = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
};

export type ConfluenceSpace = {
  id: string;
  key: string;
  name: string;
};

export class ConfluenceApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ConfluenceApiError";
  }
}

const PLATFORM_ACCESS_DENIED = "cannot access Confluence";

function formatConfluenceError(status: number, body: string, oauthMode = false): string {
  if (status === 403 && body.includes(PLATFORM_ACCESS_DENIED)) {
    return (
      "Confluence returned 403: your account or API token cannot access Confluence on this site. " +
      "Use your Atlassian login email, confirm you can open Confluence in the browser, and try a classic " +
      "API token (Create API token — not “with scopes”) at id.atlassian.com."
    );
  }
  if (status === 403) {
    return (
      "Confluence returned 403 Forbidden. Check the site URL is your real Atlassian site " +
      "(e.g. https://your-company.atlassian.net/wiki — not the placeholder), use your Atlassian " +
      "account email, and a classic API token (create without scopes at id.atlassian.com)."
    );
  }
  if (status === 410) {
    return "Confluence search API is unavailable on this site. Try again after reconnecting Atlassian.";
  }
  if (status === 401) {
    if (oauthMode && body.includes("scope does not match")) {
      return (
        "Confluence OAuth scope mismatch. In the Atlassian developer console (CoopAI Local v2), add Classic scopes " +
        "search:confluence and read:confluence-space.summary under Confluence API, then Manage Confluence to re-authorize."
      );
    }
    if (oauthMode) {
      return "Confluence OAuth authentication failed. Click Manage Confluence to re-authorize your organization.";
    }
    return "Confluence authentication failed. Verify your account email and API token, then save credentials again.";
  }
  const parsedMessage = parseConfluenceJsonMessage(body);
  if (parsedMessage) {
    return parsedMessage;
  }
  return body || `Confluence request failed (${status}).`;
}

function parseConfluenceJsonMessage(body: string): string | undefined {
  try {
    const payload = JSON.parse(body) as { message?: string };
    const message = payload.message?.trim();
    if (!message) {
      return undefined;
    }
    if (/GoneException|deprecated endpoint has been removed/i.test(message)) {
      return "Confluence search API is unavailable on this site. Try again after reconnecting Atlassian.";
    }
    return message;
  } catch {
    return undefined;
  }
}

function shouldRetryOnPlatformApi(status: number, body: string): boolean {
  return status === 403 && body.includes(PLATFORM_ACCESS_DENIED);
}

function wikiSiteOrigin(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/wiki") ? base.slice(0, -"/wiki".length) : base;
}

function wikiApiBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const wikiBase = base.endsWith("/wiki") ? base : `${base}/wiki`;
  return `${wikiBase}/rest/api`;
}

export class ConfluenceClient {
  private readonly authHeader: string;
  private apiBase: string;
  private readonly siteOrigin: string;
  private readonly oauthMode: boolean;
  private platformApiBase?: string;

  public constructor(private readonly options: ConfluenceClientOptions) {
    if (options.oauthAccessToken && options.cloudId) {
      this.oauthMode = true;
      this.siteOrigin = wikiSiteOrigin(options.baseUrl);
      this.apiBase = `https://api.atlassian.com/ex/confluence/${options.cloudId}/wiki/rest/api`;
      this.authHeader = `Bearer ${options.oauthAccessToken}`;
    } else {
      this.oauthMode = false;
      if (!options.email || !options.apiToken) {
        throw new Error("Confluence email and API token are required.");
      }
      this.siteOrigin = wikiSiteOrigin(options.baseUrl);
      this.apiBase = wikiApiBase(options.baseUrl);
      const encoded = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    const siteError = confluenceSiteUrlError(`${this.siteOrigin}/wiki`);
    if (siteError) {
      return { ok: false, message: siteError };
    }
    try {
      if (this.oauthMode) {
        await this.request<{ results?: unknown[] }>("/search", {
          query: { cql: "type=page", limit: "1" }
        });
      } else {
        await this.request<{ displayName?: string }>("/user/current");
      }
      return { ok: true, message: "Confluence is reachable." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Confluence test failed."
      };
    }
  }

  public async searchPages(cql: string, limit = 20): Promise<ConfluencePage[]> {
    const result = await this.request<{
      results?: Array<{
        content?: {
          id: string;
          title?: string;
          history?: { lastUpdated?: { when?: string } };
          _links?: { webui?: string; base?: string; self?: string };
        };
        title?: string;
        excerpt?: string;
        url?: string;
        lastModified?: string;
      }>;
    }>("/search", {
      query: {
        cql,
        limit: String(Math.min(limit, 50))
      }
    });

    return (result.results ?? [])
      .map((item) => {
        const content = item.content;
        const id = content?.id ?? "";
        const title = content?.title ?? item.title ?? "Untitled";
        return {
          id,
          title,
          excerpt: item.excerpt,
          updated:
            item.lastModified ??
            content?.history?.lastUpdated?.when ??
            new Date(0).toISOString(),
          htmlUrl: item.url ?? this.buildPageHtmlUrl(id, content?._links)
        };
      })
      .filter((page) => page.id);
  }

  public async listSpaces(options?: { limit?: number }): Promise<ConfluenceSpace[]> {
    const limit = Math.min(options?.limit ?? 500, 1000);
    const spaces: ConfluenceSpace[] = [];
    let start = 0;

    while (spaces.length < limit) {
      const pageSize = Math.min(50, limit - spaces.length);
      const result = await this.request<{
        results?: Array<{ id?: string | number; key?: string; name?: string }>;
        size?: number;
      }>("/space", {
        query: {
          start: String(start),
          limit: String(pageSize)
        }
      });

      const batch = result.results ?? [];
      for (const space of batch) {
        const id = space.id !== undefined ? String(space.id).trim() : "";
        const key = typeof space.key === "string" ? space.key.trim() : "";
        const name = typeof space.name === "string" ? space.name.trim() : "";
        if (id && key && name) {
          spaces.push({ id, key, name });
        }
      }

      if (batch.length < pageSize) {
        break;
      }
      start += batch.length;
    }

    return spaces;
  }

  private buildPageHtmlUrl(
    pageId: string,
    links?: { webui?: string; base?: string; self?: string }
  ): string {
    const webui = links?.webui?.trim();
    const base = links?.base?.replace(/\/+$/, "");
    if (base && webui) {
      return `${base}${webui.startsWith("/") ? webui : `/${webui}`}`;
    }
    if (webui) {
      const wikiPath = webui.startsWith("/wiki") ? webui : `/wiki${webui.startsWith("/") ? webui : `/${webui}`}`;
      return `${this.siteOrigin}${wikiPath}`;
    }
    return `${this.siteOrigin}/wiki/pages/${pageId}`;
  }

  private async resolvePlatformApiBase(): Promise<string> {
    if (this.platformApiBase) {
      return this.platformApiBase;
    }
    const response = await fetchWithTimeout(`${this.siteOrigin}/_edge/tenant_info`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (isFetchTimeout(response)) {
      throw new ConfluenceApiError(response.message);
    }
    if (!response.ok) {
      throw new ConfluenceApiError(
        `Could not resolve Confluence cloud ID (${response.status}). Check the site URL.`,
        response.status
      );
    }
    const payload = (await response.json()) as { cloudId?: string };
    if (!payload.cloudId?.trim()) {
      throw new ConfluenceApiError("Could not resolve Confluence cloud ID from site URL.");
    }
    this.platformApiBase = `https://api.atlassian.com/ex/confluence/${payload.cloudId.trim()}/wiki/rest/api`;
    return this.platformApiBase;
  }

  private async request<T>(
    path: string,
    options?: { query?: Record<string, string> }
  ): Promise<T> {
    const first = await this.requestOnce<T>(this.apiBase, path, options);
    if (first.ok) {
      return first.data;
    }

    if (shouldRetryOnPlatformApi(first.status, first.body)) {
      if (isPlaceholderAtlassianSite(`${this.siteOrigin}/wiki`)) {
        throw new ConfluenceApiError(
          confluenceSiteUrlError(`${this.siteOrigin}/wiki`) ??
            formatConfluenceError(first.status, first.body, this.oauthMode),
          first.status
        );
      }
      const platformBase = await this.resolvePlatformApiBase();
      const second = await this.requestOnce<T>(platformBase, path, options);
      if (second.ok) {
        this.apiBase = platformBase;
        return second.data;
      }
      throw new ConfluenceApiError(
        formatConfluenceError(second.status, second.body, this.oauthMode),
        second.status
      );
    }

    throw new ConfluenceApiError(
      formatConfluenceError(first.status, first.body, this.oauthMode),
      first.status
    );
  }

  private async requestOnce<T>(
    apiBase: string,
    path: string,
    options?: { query?: Record<string, string> }
  ): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
    const url = new URL(`${apiBase}${path}`);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json"
      }
    });

    if (isFetchTimeout(response)) {
      return { ok: false, status: 0, body: response.message };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, status: response.status, body };
    }

    return { ok: true, data: (await response.json()) as T };
  }
}
