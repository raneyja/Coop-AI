import { fetchWithTimeout } from "../networkResilience";
import { confluenceSiteUrlError, isPlaceholderAtlassianSite } from "./resolveConfluenceBaseUrl";

export type ConfluenceClientOptions = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

export type ConfluencePage = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
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

function formatConfluenceError(status: number, body: string): string {
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
  if (status === 401) {
    return "Confluence authentication failed. Verify your account email and API token, then save credentials again.";
  }
  return body || `Confluence request failed (${status}).`;
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
  private platformApiBase?: string;

  public constructor(private readonly options: ConfluenceClientOptions) {
    this.siteOrigin = wikiSiteOrigin(options.baseUrl);
    this.apiBase = wikiApiBase(options.baseUrl);
    const encoded = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
    this.authHeader = `Basic ${encoded}`;
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    const siteError = confluenceSiteUrlError(`${this.siteOrigin}/wiki`);
    if (siteError) {
      return { ok: false, message: siteError };
    }
    try {
      await this.request<{ displayName?: string }>("/user/current");
      return { ok: true, message: "Confluence connection successful." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Confluence connection failed."
      };
    }
  }

  public async searchPages(cql: string, limit = 20): Promise<ConfluencePage[]> {
    const result = await this.request<{
      results?: Array<{
        id: string;
        title?: string;
        excerpt?: string;
        history?: { lastUpdated?: { when?: string } };
        _links?: { webui?: string; base?: string };
      }>;
    }>("/content/search", {
      query: {
        cql,
        limit: String(Math.min(limit, 50)),
        expand: "history"
      }
    });

    return (result.results ?? []).map((page) => ({
      id: page.id,
      title: page.title ?? "Untitled",
      excerpt: page.excerpt,
      updated: page.history?.lastUpdated?.when ?? new Date(0).toISOString(),
      htmlUrl: page._links?.base && page._links?.webui ? `${page._links.base}${page._links.webui}` : ""
    }));
  }

  private async resolvePlatformApiBase(): Promise<string> {
    if (this.platformApiBase) {
      return this.platformApiBase;
    }
    const response = await fetchWithTimeout(`${this.siteOrigin}/_edge/tenant_info`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
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
          confluenceSiteUrlError(`${this.siteOrigin}/wiki`) ?? formatConfluenceError(first.status, first.body),
          first.status
        );
      }
      const platformBase = await this.resolvePlatformApiBase();
      const second = await this.requestOnce<T>(platformBase, path, options);
      if (second.ok) {
        this.apiBase = platformBase;
        return second.data;
      }
      throw new ConfluenceApiError(formatConfluenceError(second.status, second.body), second.status);
    }

    throw new ConfluenceApiError(formatConfluenceError(first.status, first.body), first.status);
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

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, status: response.status, body };
    }

    return { ok: true, data: (await response.json()) as T };
  }
}
