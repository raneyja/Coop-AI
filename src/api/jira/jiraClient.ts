import { fetchWithTimeout } from "../networkResilience";

const ISSUE_CACHE_TTL_MS = 30 * 60 * 1000;

export type JiraClientOptions = {
  baseUrl: string;
  email: string;
  apiToken: string;
  now?: () => number;
};

export type JiraIssue = {
  key: string;
  summary: string;
  description?: string;
  status: string;
  issueType: string;
  epicKey?: string;
  epicName?: string;
  acceptanceCriteria: string[];
  labels: string[];
  technicalDebt: boolean;
  assignee?: string;
  reporter?: string;
  created: string;
  updated: string;
  htmlUrl: string;
};

export type JiraEpic = {
  key: string;
  summary: string;
  description?: string;
  status: string;
  htmlUrl: string;
};

export type JiraTransition = {
  date: string;
  fromStatus?: string;
  toStatus: string;
  author?: string;
};

export class JiraApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

type CacheEntry<T> = { data: T; expiresAt: number };

export class JiraClient {
  private readonly authHeader: string;
  private readonly apiBase: string;
  private readonly now: () => number;
  private readonly issueCache = new Map<string, CacheEntry<JiraIssue>>();
  private readonly epicCache = new Map<string, CacheEntry<JiraEpic>>();

  public constructor(private readonly options: JiraClientOptions) {
    const base = options.baseUrl.replace(/\/+$/, "");
    this.apiBase = `${base}/rest/api/3`;
    const encoded = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
    this.authHeader = `Basic ${encoded}`;
    this.now = options.now ?? (() => Date.now());
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request<{ accountId?: string }>("/myself");
      return { ok: true, message: "Jira connection successful." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Jira connection failed."
      };
    }
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    const normalized = issueKey.toUpperCase();
    const cached = this.issueCache.get(normalized);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const fields = [
      "summary",
      "description",
      "status",
      "issuetype",
      "labels",
      "assignee",
      "reporter",
      "created",
      "updated",
      "parent",
      "customfield_10014"
    ].join(",");

    const payload = await this.request<JiraIssuePayload>(`/issue/${encodeURIComponent(normalized)}?fields=${fields}`);
    const issue = mapJiraIssue(payload, this.options.baseUrl);

    const epicKey = issue.epicKey ?? extractEpicFromFields(payload);
    if (epicKey && !issue.epicName) {
      try {
        const epic = await this.getEpic(epicKey);
        issue.epicName = epic.summary;
      } catch {
        /* epic optional */
      }
    }

    this.issueCache.set(normalized, { data: issue, expiresAt: this.now() + ISSUE_CACHE_TTL_MS });
    return issue;
  }

  public async getEpic(epicKey: string): Promise<JiraEpic> {
    const normalized = epicKey.toUpperCase();
    const cached = this.epicCache.get(normalized);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const payload = await this.request<JiraIssuePayload>(
      `/issue/${encodeURIComponent(normalized)}?fields=summary,description,status`
    );
    const epic: JiraEpic = {
      key: payload.key,
      summary: payload.fields.summary,
      description: extractDescription(payload.fields.description),
      status: payload.fields.status?.name ?? "unknown",
      htmlUrl: `${this.options.baseUrl}/browse/${payload.key}`
    };

    this.epicCache.set(normalized, { data: epic, expiresAt: this.now() + ISSUE_CACHE_TTL_MS });
    return epic;
  }

  public async searchIssues(jql: string, limit = 20): Promise<JiraIssue[]> {
    const result = await this.request<{ issues?: JiraIssuePayload[] }>("/search", {
      method: "POST",
      body: {
        jql,
        maxResults: Math.min(limit, 50),
        fields: ["summary", "status", "issuetype", "labels", "updated"]
      }
    });

    return (result.issues ?? []).map((issue) => mapJiraIssue(issue, this.options.baseUrl));
  }

  public async getTransitionHistory(issueKey: string): Promise<JiraTransition[]> {
    const changelog = await this.request<{
      values?: Array<{
        created: string;
        author?: { displayName?: string };
        items?: Array<{ field: string; fromString?: string; toString?: string }>;
      }>;
    }>(`/issue/${encodeURIComponent(issueKey.toUpperCase())}/changelog?maxResults=100`);

    const transitions: JiraTransition[] = [];
    for (const history of changelog.values ?? []) {
      for (const item of history.items ?? []) {
        if (item.field === "status" && item.toString) {
          transitions.push({
            date: history.created,
            fromStatus: item.fromString,
            toStatus: item.toString,
            author: history.author?.displayName
          });
        }
      }
    }
    return transitions.sort((a, b) => a.date.localeCompare(b.date));
  }

  public static extractIssueKeys(text: string): string[] {
    const matches = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
    return [...new Set(matches.map((key) => key.toUpperCase()))];
  }

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const response = await fetchWithTimeout(
      url,
      {
        method: options?.method ?? "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: options?.body ? JSON.stringify(options.body) : undefined
      },
      20_000
    );

    if ("timeout" in response) {
      throw new JiraApiError(response.message);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new JiraApiError(text || `Jira HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }
}

type JiraIssuePayload = {
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    status?: { name?: string };
    issuetype?: { name?: string };
    labels?: string[];
    assignee?: { displayName?: string };
    reporter?: { displayName?: string };
    created?: string;
    updated?: string;
    parent?: { key?: string; fields?: { summary?: string } };
    customfield_10014?: string;
  };
};

function mapJiraIssue(payload: JiraIssuePayload, baseUrl: string): JiraIssue {
  const description = extractDescription(payload.fields.description);
  const acceptanceCriteria = extractAcceptanceCriteria(description);
  const labels = payload.fields.labels ?? [];
  const technicalDebt =
    labels.some((l) => /tech(nical)?[-_\s]?debt/i.test(l)) ||
    /technical debt/i.test(description) ||
    /tech debt/i.test(payload.fields.summary);

  return {
    key: payload.key,
    summary: payload.fields.summary,
    description,
    status: payload.fields.status?.name ?? "unknown",
    issueType: payload.fields.issuetype?.name ?? "Task",
    epicKey: payload.fields.parent?.key ?? payload.fields.customfield_10014,
    epicName: payload.fields.parent?.fields?.summary,
    acceptanceCriteria,
    labels,
    technicalDebt,
    assignee: payload.fields.assignee?.displayName,
    reporter: payload.fields.reporter?.displayName,
    created: payload.fields.created ?? new Date(0).toISOString(),
    updated: payload.fields.updated ?? new Date(0).toISOString(),
    htmlUrl: `${baseUrl.replace(/\/+$/, "")}/browse/${payload.key}`
  };
}

function extractEpicFromFields(payload: JiraIssuePayload): string | undefined {
  return payload.fields.customfield_10014 ?? payload.fields.parent?.key;
}

function extractDescription(description: unknown): string {
  if (!description) {
    return "";
  }
  if (typeof description === "string") {
    return description;
  }
  if (typeof description === "object" && description !== null && "content" in description) {
    return flattenAdf(description).trim();
  }
  return JSON.stringify(description);
}

function flattenAdf(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const record = node as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content.map((child) => flattenAdf(child));
  if (record.type === "paragraph" || record.type === "heading") {
    return `${parts.join("")}\n`;
  }
  return parts.join("");
}

function extractAcceptanceCriteria(description: string): string[] {
  const section = /acceptance criteria[:\s]*([\s\S]*?)(?:\n#{1,3}\s|\n\n[A-Z]|$)/i.exec(description);
  if (!section) {
    return [];
  }
  return section[1]
    .split(/\n/)
    .map((line) => line.replace(/^[-*•\d.)]+\s*/, "").trim())
    .filter((line) => line.length > 4);
}
