import { fetchWithTimeout, isFetchTimeout } from "../networkResilience";
import { applyGoogleDocsFolderScope } from "../../integrationScope/googleDocsQuery";
import type { GoogleDocsFolderKind } from "../../integrationScope/types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type GoogleDocsClientOptions = {
  accessToken: string;
};

export type GoogleDoc = {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
  parents?: string[];
};

export type GoogleDriveFolder = {
  id: string;
  name: string;
  kind: GoogleDocsFolderKind;
};

export type GoogleDocsSearchScope = {
  expandedFolderIds: string[];
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

  public async listSharedDrives(options?: { limit?: number }): Promise<GoogleDriveFolder[]> {
    const limit = options?.limit ?? 100;
    const result = await this.request<{
      drives?: Array<{ id: string; name?: string }>;
    }>("/drives", {
      query: {
        pageSize: String(Math.min(limit, 100)),
        fields: "drives(id,name)"
      }
    });
    return (result.drives ?? []).map((drive) => ({
      id: drive.id,
      name: drive.name ?? "Untitled shared drive",
      kind: "shared_drive" as const
    }));
  }

  public async listFolders(options?: {
    query?: string;
    limit?: number;
  }): Promise<GoogleDriveFolder[]> {
    const limit = options?.limit ?? 200;
    const clauses = [
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false"
    ];
    const search = options?.query?.trim().toLowerCase();
    if (search) {
      clauses.push(`name contains '${escapeDriveQuery(search)}'`);
    }

    const result = await this.request<{
      files?: Array<{ id: string; name?: string }>;
    }>("/files", {
      query: {
        q: clauses.join(" and "),
        pageSize: String(Math.min(limit, 200)),
        fields: "files(id,name)",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        corpora: "allDrives"
      }
    });

    return (result.files ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name ?? "Untitled folder",
      kind: "folder" as const
    }));
  }

  public async expandFolderTree(
    folders: Array<{ id: string; kind: GoogleDocsFolderKind }>
  ): Promise<string[]> {
    const expanded = new Set<string>();
    for (const folder of folders) {
      const id = folder.id.trim();
      if (!id) {
        continue;
      }
      expanded.add(id);
      await this.expandFolderDescendants(id, folder.kind === "shared_drive" ? id : undefined, expanded);
    }
    return [...expanded];
  }

  public async searchDocumentsForTerms(
    terms: string[],
    limit = 20,
    scope?: GoogleDocsSearchScope
  ): Promise<GoogleDoc[]> {
    return this.searchDocuments(terms.join(" OR "), limit, scope);
  }

  public async searchDocuments(
    query: string,
    limit = 20,
    scope?: GoogleDocsSearchScope
  ): Promise<GoogleDoc[]> {
    const terms = splitDriveSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }
    if (terms.length === 1) {
      return this.searchDocumentsForTerm(terms[0]!, limit, scope);
    }

    const seen = new Map<string, GoogleDoc>();
    for (const term of terms) {
      if (seen.size >= limit) {
        break;
      }
      const hits = await this.searchDocumentsForTerm(term, limit - seen.size, scope);
      for (const doc of hits) {
        seen.set(doc.id, doc);
      }
    }
    return [...seen.values()].slice(0, limit);
  }

  private async expandFolderDescendants(
    parentId: string,
    driveId: string | undefined,
    expanded: Set<string>
  ): Promise<void> {
    const children = await this.listChildFolders(parentId, driveId);
    for (const child of children) {
      if (expanded.has(child.id)) {
        continue;
      }
      expanded.add(child.id);
      await this.expandFolderDescendants(child.id, driveId, expanded);
    }
  }

  private async listChildFolders(parentId: string, driveId?: string): Promise<Array<{ id: string }>> {
    const q = [
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
      `'${escapeDriveQuery(parentId)}' in parents`
    ].join(" and ");

    const query: Record<string, string> = {
      q,
      pageSize: "200",
      fields: "files(id)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    };

    if (driveId) {
      query.corpora = "drive";
      query.driveId = driveId;
    }

    const result = await this.request<{
      files?: Array<{ id: string }>;
    }>("/files", { query });

    return result.files ?? [];
  }

  private async searchDocumentsForTerm(
    term: string,
    limit: number,
    scope?: GoogleDocsSearchScope
  ): Promise<GoogleDoc[]> {
    const baseQ = [
      `fullText contains '${escapeDriveQuery(term)}'`,
      "mimeType='application/vnd.google-apps.document'",
      "trashed=false"
    ].join(" and ");
    const [q] =
      scope && scope.expandedFolderIds.length > 0
        ? applyGoogleDocsFolderScope([baseQ], scope.expandedFolderIds)
        : [baseQ];

    const query: Record<string, string> = {
      q: q!,
      pageSize: String(Math.min(limit, 50)),
      fields: "files(id,name,modifiedTime,webViewLink,parents)",
      orderBy: "modifiedTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives"
    };

    const result = await this.request<{
      files?: Array<{
        id: string;
        name?: string;
        modifiedTime?: string;
        webViewLink?: string;
        parents?: string[];
      }>;
    }>("/files", { query });

    return (result.files ?? []).map((file) => ({
      id: file.id,
      title: file.name ?? "Untitled",
      updated: file.modifiedTime ?? new Date(0).toISOString(),
      htmlUrl: file.webViewLink ?? "",
      parents: file.parents
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
