import type { IntegrationProxy } from "../integrations/integrationOperations";
import { fetchIntegrationResponse, INTEGRATION_HTTP_TIMEOUT_MS, integrationAuthFailureMessage } from "../integrations/integrationHttp";

const ISSUE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Spec/encoding tokens that match KEY-123 but are not Jira issues. */
const NON_JIRA_ISSUE_KEY_PREFIXES = new Set([
  "UTF",
  "ISO",
  "RFC",
  "CVE",
  "SHA",
  "AES",
  "TLS",
  "SSL",
  "HTTP",
  "HTTPS",
  "HTML",
  "ASCII",
  "ANSI"
]);

export type JiraClientOptions = {
  proxy?: IntegrationProxy;
  baseUrl: string;
  email?: string;
  apiToken?: string;
  oauthAccessToken?: string;
  cloudId?: string;
  now?: () => number;
  signal?: AbortSignal;
  /** Server-owned project admission, including optional nested epic reads. */
  isIssueKeyAllowed?: (key: string) => boolean;
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

export type JiraProject = {
  id: string;
  key: string;
  name: string;
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
  private readonly siteBaseUrl: string;
  private readonly oauthMode: boolean;
  private readonly now: () => number;
  private readonly issueCache = new Map<string, CacheEntry<JiraIssue>>();
  private readonly epicCache = new Map<string, CacheEntry<JiraEpic>>();

  public constructor(private readonly options: JiraClientOptions) {
    if (options.proxy) {
      this.oauthMode = false;
      this.apiBase = "";
      this.authHeader = "";
      this.siteBaseUrl = options.baseUrl;
    } else if (options.oauthAccessToken && options.cloudId) {
      this.oauthMode = true;
      this.apiBase = `https://api.atlassian.com/ex/jira/${options.cloudId}/rest/api/3`;
      this.authHeader = `Bearer ${options.oauthAccessToken}`;
      this.siteBaseUrl = options.baseUrl.replace(/\/+$/, "");
    } else {
      this.oauthMode = false;
      if (!options.email || !options.apiToken) {
        throw new Error("Jira email and API token are required.");
      }
      const base = options.baseUrl.replace(/\/+$/, "");
      this.apiBase = `${base}/rest/api/3`;
      this.siteBaseUrl = base;
      const encoded = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }
    this.now = options.now ?? (() => Date.now());
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.options.proxy) return this.options.proxy("jira.testConnection", [], this.options.signal);
    try {
      if (this.oauthMode) {
        // OAuth tokens from Coop's Atlassian app include read:jira-work, not read:jira-user (/myself).
        await this.searchIssues("updated >= -30d ORDER BY updated DESC", 1);
      } else {
        await this.request<{ accountId?: string }>("/myself");
      }
      return { ok: true, message: "Jira is reachable." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Jira test failed."
      };
    }
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    if (this.options.proxy) return this.options.proxy("jira.getIssue", [issueKey], this.options.signal);
    const normalized = issueKey.toUpperCase();
    this.requireAllowedIssueKey(normalized);
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
    if (this.options.isIssueKeyAllowed && payload.key !== normalized) throw new JiraApiError("Jira source identity changed.", 403);
    const issue = this.admitIssue(payload);

    const epicKey = issue.epicKey ?? extractEpicFromFields(payload);
    if (epicKey && !issue.epicName && (!this.options.isIssueKeyAllowed || this.options.isIssueKeyAllowed(epicKey.toUpperCase()))) {
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
    if (this.options.proxy) return this.options.proxy("jira.getEpic", [epicKey], this.options.signal);
    const normalized = epicKey.toUpperCase();
    this.requireAllowedIssueKey(normalized);
    const cached = this.epicCache.get(normalized);
    if (cached && cached.expiresAt > this.now()) {
      return cached.data;
    }

    const payload = await this.request<JiraIssuePayload>(
      `/issue/${encodeURIComponent(normalized)}?fields=summary,description,status`
    );
    if (this.options.isIssueKeyAllowed && payload.key !== normalized) throw new JiraApiError("Jira source identity changed.", 403);
    const epic: JiraEpic = {
      key: payload.key,
      summary: payload.fields.summary,
      description: extractDescription(payload.fields.description),
      status: payload.fields.status?.name ?? "unknown",
      htmlUrl: `${this.siteBaseUrl.replace(/\/+$/, "")}/browse/${payload.key}`
    };

    this.epicCache.set(normalized, { data: epic, expiresAt: this.now() + ISSUE_CACHE_TTL_MS });
    return epic;
  }

  public async searchIssues(jql: string, limit = 20): Promise<JiraIssue[]> {
    if (this.options.proxy) return this.options.proxy("jira.searchIssues", [jql, limit], this.options.signal);
    const result = await this.request<{ issues?: JiraIssuePayload[] }>("/search/jql", {
      method: "POST",
      body: {
        jql,
        maxResults: Math.min(limit, 50),
        fields: ["summary", "description", "status", "issuetype", "labels", "updated"]
      }
    });

    return (result.issues ?? []).map(issue => this.admitIssue(issue));
  }

  public async listProjects(options?: { limit?: number }): Promise<JiraProject[]> {
    const limit = Math.min(options?.limit ?? 500, 1000);
    const projects: JiraProject[] = [];
    let startAt = 0;

    while (projects.length < limit) {
      const pageSize = Math.min(50, limit - projects.length);
      const result = await this.request<{
        values?: Array<{ id?: string; key?: string; name?: string }>;
        isLast?: boolean;
      }>(`/project/search?startAt=${startAt}&maxResults=${pageSize}&orderBy=name`);

      for (const project of result.values ?? []) {
        const id = typeof project.id === "string" ? project.id.trim() : "";
        const key = typeof project.key === "string" ? project.key.trim() : "";
        const name = typeof project.name === "string" ? project.name.trim() : "";
        if (id && key && name) {
          projects.push({ id, key, name });
        }
      }

      if (result.isLast || !result.values?.length) {
        break;
      }
      startAt += result.values.length;
    }

    return projects;
  }

  public async getTransitionHistory(issueKey: string): Promise<JiraTransition[]> {
    if (this.options.proxy) return this.options.proxy("jira.getTransitionHistory", [issueKey], this.options.signal);
    this.requireAllowedIssueKey(issueKey.toUpperCase());
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
    const matches = text.match(/\b[A-Za-z][A-Za-z0-9]+-\d+\b/g) ?? [];
    return [
      ...new Set(
        matches
          .map((key) => key.toUpperCase())
          .filter((key) => !NON_JIRA_ISSUE_KEY_PREFIXES.has(key.split("-")[0] ?? ""))
      )
    ];
  }

  private requireAllowedIssueKey(key: string): void {
    if (this.options.isIssueKeyAllowed && !this.options.isIssueKeyAllowed(key)) {
      throw new JiraApiError("Jira source is not authorized.", 403);
    }
  }

  private admitIssue(payload: JiraIssuePayload): JiraIssue {
    this.requireAllowedIssueKey(payload.key);
    const issue = mapJiraIssue(payload, this.siteBaseUrl);
    if (issue.epicKey && this.options.isIssueKeyAllowed && !this.options.isIssueKeyAllowed(issue.epicKey.toUpperCase())) {
      delete issue.epicKey;
      delete issue.epicName;
    }
    return issue;
  }

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const response = await fetchIntegrationResponse(
      url,
      {
        method: options?.method ?? "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: this.options.signal, redirect: "error"
      },
      INTEGRATION_HTTP_TIMEOUT_MS
    );

    if ("timeout" in response) {
      throw new JiraApiError(response.message);
    }
    if (!response.ok) {
      const auth = integrationAuthFailureMessage(response.status);
      if (auth) {
        throw new JiraApiError(auth, response.status);
      }
      const text = await response.text().catch(() => "");
      throw new JiraApiError(formatJiraErrorBody(text, response.status, this.oauthMode), response.status);
    }
    return (await response.json()) as T;
  }
}

function formatJiraErrorBody(text: string, status: number, oauthMode = false): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `Jira HTTP ${status}`;
  }
  try {
    const parsed = JSON.parse(trimmed) as { errorMessages?: string[]; message?: string };
    if (Array.isArray(parsed.errorMessages) && parsed.errorMessages.length > 0) {
      return formatJiraParsedError(parsed.errorMessages.join(" "), status, oauthMode);
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return formatJiraParsedError(parsed.message.trim(), status, oauthMode);
    }
  } catch {
    /* not JSON */
  }
  return formatJiraParsedError(trimmed, status, oauthMode);
}

function formatJiraParsedError(message: string, status: number, oauthMode: boolean): string {
  if (status === 401 && oauthMode && message.includes("scope does not match")) {
    return (
      "Jira OAuth scope mismatch. Disconnect and reconnect Atlassian so your token includes read:jira-work " +
      "(Atlassian developer console → Permissions → Jira API). Then Test Jira again."
    );
  }
  return message;
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
