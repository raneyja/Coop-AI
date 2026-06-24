import { fetchWithTimeout, isFetchTimeout } from "../networkResilience";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type GoogleDocsClientOptions = {
  accessToken: string;
};

export type GoogleDoc = {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
};

export class GoogleDocsApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "GoogleDocsApiError";
  }
}

export class GoogleDocsClient {
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: GoogleDocsClientOptions) {
    this.headers = {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "application/json"
    };
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.request<{ user?: { displayName?: string } }>("/about", {
        query: { fields: "user" }
      });
      const name = result.user?.displayName;
      return {
        ok: true,
        message: name ? `Google Docs is reachable (${name}).` : "Google Docs is reachable."
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Google Docs test failed."
      };
    }
  }

  public async searchDocumentsForTerms(terms: string[], limit = 20): Promise<GoogleDoc[]> {
    return this.searchDocuments(terms.join(" OR "), limit);
  }

  public async searchDocuments(query: string, limit = 20): Promise<GoogleDoc[]> {
    const terms = splitDriveSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }
    if (terms.length === 1) {
      return this.searchDocumentsForTerm(terms[0]!, limit);
    }

    const seen = new Map<string, GoogleDoc>();
    for (const term of terms) {
      if (seen.size >= limit) {
        break;
      }
      const hits = await this.searchDocumentsForTerm(term, limit - seen.size);
      for (const doc of hits) {
        seen.set(doc.id, doc);
      }
    }
    return [...seen.values()].slice(0, limit);
  }

  private async searchDocumentsForTerm(term: string, limit: number): Promise<GoogleDoc[]> {
    const q = [
      `fullText contains '${escapeDriveQuery(term)}'`,
      "mimeType='application/vnd.google-apps.document'",
      "trashed=false"
    ].join(" and ");

    const result = await this.request<{
      files?: Array<{
        id: string;
        name?: string;
        modifiedTime?: string;
        webViewLink?: string;
      }>;
    }>("/files", {
      query: {
        q,
        pageSize: String(Math.min(limit, 50)),
        fields: "files(id,name,modifiedTime,webViewLink)",
        orderBy: "modifiedTime desc"
      }
    });

    return (result.files ?? []).map((file) => ({
      id: file.id,
      title: file.name ?? "Untitled",
      updated: file.modifiedTime ?? new Date(0).toISOString(),
      htmlUrl: file.webViewLink ?? ""
    }));
  }

  private async request<T>(
    path: string,
    options?: { query?: Record<string, string> }
  ): Promise<T> {
    const url = new URL(`${DRIVE_API}${path}`);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: this.headers
    });

    if (isFetchTimeout(response)) {
      throw new GoogleDocsApiError(response.message);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleDocsApiError(body || `Google Docs request failed (${response.status}).`, response.status);
    }

    return (await response.json()) as T;
  }
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Drive fullText does not treat OR as boolean logic — search each term separately. */
function splitDriveSearchTerms(query: string): string[] {
  return [...new Set(query.split(/\s+OR\s+/i).map((term) => term.trim()).filter(Boolean))];
}
