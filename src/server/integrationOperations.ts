import { SlackClient, type SlackSearchHit } from "../api/slack/slackClient";
import { JiraClient, type JiraIssue } from "../api/jira/jiraClient";
import { ConfluenceClient, type ConfluencePage } from "../api/confluence/confluenceClient";
import { NotionClient, type NotionPage } from "../api/notion/notionClient";
import { GoogleDocsClient, type GoogleDoc } from "../api/googleDocs/googleDocsClient";
import { TeamsClient, type TeamsSearchHit } from "../api/teams/teamsClient";
import { applyJiraProjectScope, applyConfluenceSpaceScope } from "../integrationScope/atlassianQuery";
import { applySlackChannelScope, stripSlackSearchOperators } from "../integrationScope/slackQuery";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import type { IntegrationConnectionRecord, IntegrationProvider } from "./integrationConnectionStore";

export class IntegrationOperationError extends Error {
  public constructor(public readonly status: number, message: string) { super(message); }
}

export function operationProvider(operation: string): IntegrationProvider | undefined {
  const product = operation.split(".")[0];
  if (product === "jira" || product === "confluence") return "atlassian";
  if (product === "googleDocs") return "google-docs";
  if (product === "slack" || product === "notion" || product === "teams") return product;
  return undefined;
}

function deny(): never { throw new IntegrationOperationError(403, "Integration source is not authorized."); }
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:@-]{1,200}$/.test(value)) throw new IntegrationOperationError(400, "Invalid source identity.");
  return value;
}
function query(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000 || /[\x00-\x1f]/.test(value)) throw new IntegrationOperationError(400, "Invalid integration query.");
  return value;
}
function limit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) throw new IntegrationOperationError(400, "Integration limit must be between 1 and 50.");
  return value;
}
function objectLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => k !== "limit")) throw new IntegrationOperationError(400, "Invalid integration options.");
  return limit((value as { limit?: unknown }).limit);
}
function requireSources(values: string[] | undefined): string[] {
  if (!values?.length) deny();
  return values;
}
function only<T>(values: T[], permitted: (value: T) => boolean): T[] {
  // Foreign hits invalidate the complete response instead of silently certifying a partial page.
  if (values.length > 50 || values.some(value => !permitted(value))) deny();
  return values;
}
function site(connection: IntegrationConnectionRecord): string {
  const raw = connection.metadata.siteUrl;
  if (!raw) throw new IntegrationOperationError(403, "Integration site is not configured.");
  const url = new URL(raw);
  const approved = (process.env.COOP_INTEGRATION_ALLOWED_HOSTS ?? "").split(",").map(v => v.trim().toLowerCase());
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      (!url.hostname.endsWith(".atlassian.net") && !approved.includes(url.hostname.toLowerCase())) ||
      !["/", "/wiki", "/wiki/"].includes(url.pathname) || url.search || url.hash) deny();
  return url.origin;
}

/** Executes a closed set of read-only vendor operations under a server-resolved shared-source policy. */
export async function executeIntegrationOperation(options: {
  operation: string; args: unknown[]; accessToken: string; connection: IntegrationConnectionRecord;
  scope: ResolvedIntegrationScope; directoryAccess: boolean; signal: AbortSignal;
}): Promise<unknown> {
  const { operation, args, accessToken, connection, scope, directoryAccess, signal } = options;
  if (args.length > 3) throw new IntegrationOperationError(400, "Invalid integration arguments.");
  if (!scope.allowed || !scope.enforced) deny();
  const product = operation.split(".")[0];
  if (operation.endsWith(".testConnection")) {
    // A real authorized search verifies token and source scope without exposing vendor auth metadata.
    const search = product === "slack" ? "searchMessages" : product === "teams" ? "searchMessages" :
      product === "jira" ? "searchIssues" : product === "confluence" ? "searchPages" :
      product === "notion" ? "searchPages" : product === "googleDocs" ? "listRecentDocuments" : undefined;
    if (!search || args.length) throw new IntegrationOperationError(400, "Invalid integration operation.");
    await executeIntegrationOperation({ ...options, operation: `${product}.${search}`, args: product === "googleDocs" ? [1] : [product === "jira" || product === "confluence" || product === "notion" ? "" : "*", product === "slack" || product === "teams" ? { limit: 1 } : 1] });
    return { ok: true, message: "Authorized integration search succeeded." };
  }
  if (product === "slack") {
    const channels = requireSources(scope.slack?.channelIds);
    const client = new SlackClient({ token: accessToken, signal, resolveThreadUserNames: directoryAccess });
    switch (operation) {
      case "slack.searchMessages": {
        const q = stripSlackSearchOperators(query(args[0])); const n = objectLimit(args[1]);
        const scopedQueries = applySlackChannelScope([q], channels, scope.slack?.channelNames ?? []);
        const hits: SlackSearchHit[] = [];
        for (const scoped of scopedQueries.slice(0, 50)) {
          const page = await client.searchMessages(scoped, { limit: n });
          hits.push(...only(page, hit => channels.includes(hit.channelId)));
          if (hits.length >= n) break;
        }
        return hits.slice(0, n);
      }
      case "slack.getThread": {
        const channel = id(args[0]); if (!channels.includes(channel)) deny();
        const ts = id(args[1]); const thread = await client.getThread(channel, ts);
        if (thread.channelId !== channel || thread.threadTs !== ts) deny();
        return thread;
      }
      case "slack.getChannelInfo": {
        const channel = id(args[0]); if (!channels.includes(channel)) deny();
        const info = await client.getChannelInfo(channel); if (info.id !== channel) deny(); return info;
      }
      case "slack.getUserInfo": if (!directoryAccess) deny(); return client.getUserInfo(id(args[0]));
      case "slack.getUserPresence": if (!directoryAccess) deny(); return client.getUserPresence(id(args[0]));
      case "slack.findUserByEmail": if (!directoryAccess) deny(); return client.findUserByEmail(query(args[0]));
      case "slack.findUserByName": if (!directoryAccess) deny(); return client.findUserByName(query(args[0]));
    }
  }
  if (product === "jira" || product === "confluence") {
    const baseUrl = site(connection);
    const cloudId = connection.metadata.cloudId;
    if (cloudId && !/^[a-zA-Z0-9-]{1,128}$/.test(cloudId)) deny();
    if (!cloudId && !connection.metadata.email) deny();
    if (product === "jira") {
      const keys = requireSources(scope.atlassian?.jiraProjectKeys);
      const permitted = (issue: { key: string }) => keys.includes(issue.key.split("-")[0]!);
      const client = new JiraClient({ baseUrl, oauthAccessToken: cloudId ? accessToken : undefined, cloudId, email: connection.metadata.email, apiToken: cloudId ? undefined : accessToken, signal,
        isIssueKeyAllowed: key => /^[A-Z][A-Z0-9_]*-\d+$/.test(key) && permitted({ key }) });
      if (operation === "jira.searchIssues") {
        const [jql] = applyJiraProjectScope([query(args[0])], scope.atlassian?.jiraProjectIds ?? [], keys);
        return only(await client.searchIssues(jql!, limit(args[1])), permitted);
      }
      if (["jira.getIssue", "jira.getEpic", "jira.getTransitionHistory"].includes(operation)) {
        const key = id(args[0]); if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key) || !permitted({ key })) deny();
        const issue: JiraIssue = await client.getIssue(key); if (issue.key !== key || !permitted(issue)) deny();
        if (operation === "jira.getIssue") return issue;
        if (operation === "jira.getTransitionHistory") return client.getTransitionHistory(key);
        const epic = await client.getEpic(key); if (epic.key !== key) deny(); return epic;
      }
    } else {
      const spaces = requireSources(scope.atlassian?.confluenceSpaceKeys);
      const allowedIds = requireSources(scope.atlassian?.confluenceSpaceIds);
      const permitted = (page: ConfluencePage) => Boolean(page.spaceId && allowedIds.includes(page.spaceId) && page.spaceKey && spaces.includes(page.spaceKey));
      const client = new ConfluenceClient({ baseUrl: `${baseUrl}/wiki`, oauthAccessToken: cloudId ? accessToken : undefined, cloudId, email: connection.metadata.email, apiToken: cloudId ? undefined : accessToken, signal });
      if (operation === "confluence.searchPages") {
        const [cql] = applyConfluenceSpaceScope([query(args[0])], allowedIds, spaces);
        return only(await client.searchPages(cql!, limit(args[1])), permitted);
      }
      if (operation === "confluence.getPageBody") {
        const pageId = id(args[0]);
        const [cql] = applyConfluenceSpaceScope([`id = "${pageId}"`], allowedIds, spaces);
        const pages = only(await client.searchPages(cql!, 1), permitted);
        if (pages.length !== 1 || pages[0]!.id !== pageId) deny();
        return client.getPageBody(pageId);
      }
    }
  }
  if (product === "notion") {
    const resources = requireSources(scope.notion?.resourceIds);
    const client = new NotionClient({ token: accessToken, signal });
    const permitted = (page: NotionPage) => resources.includes(page.id) || Boolean(page.parentId && resources.includes(page.parentId));
    if (operation === "notion.searchPages") {
      return only(await client.searchScopedPages(resources.map((resourceId, i) => ({ id: id(resourceId), type: scope.notion!.resourceTypes[i]! })), query(args[0]), limit(args[1])), permitted);
    }
    if (operation === "notion.getPagePlainText") {
      const pageId = id(args[0]); const page = await client.getPageMetadata(pageId);
      if (page.id !== pageId || !permitted(page)) deny();
      return client.getPagePlainText(pageId);
    }
  }
  if (product === "googleDocs") {
    const folders = requireSources(scope.googleDocs?.expandedFolderIds);
    const searchScope = { expandedFolderIds: folders };
    const client = new GoogleDocsClient({ accessToken, signal });
    const permitted = (doc: GoogleDoc) => Boolean(doc.parents?.some(parent => folders.includes(parent)));
    switch (operation) {
      case "googleDocs.searchDocuments": return only(await client.searchDocuments(query(args[0]), limit(args[1]), searchScope), permitted);
      case "googleDocs.searchDocumentsForTerms": {
        if (!Array.isArray(args[0]) || args[0].length > 10) throw new IntegrationOperationError(400, "Invalid search terms.");
        return only(await client.searchDocumentsForTerms(args[0].map(query), limit(args[1]), searchScope), permitted);
      }
      case "googleDocs.listRecentDocuments": return only(await client.listRecentDocuments(limit(args[0]), searchScope), permitted);
      case "googleDocs.getDocument":
      case "googleDocs.getDocumentPlainText": {
        const docId = id(args[0]); const doc = await client.getDocument(docId);
        if (!doc || doc.id !== docId || !permitted(doc)) deny();
        return operation === "googleDocs.getDocument" ? doc : client.getDocumentPlainText(docId);
      }
    }
  }
  if (product === "teams") {
    const channels = requireSources(scope.teams?.channelIds);
    const teams = requireSources(scope.teams?.teamIds);
    const client = new TeamsClient({ accessToken, signal });
    const pairs = scope.teams?.channelTeamIds ?? {};
    const permitted = (hit: TeamsSearchHit) => Boolean(hit.channelId && channels.includes(hit.channelId) && hit.teamId && pairs[hit.channelId] === hit.teamId);
    if (operation === "teams.searchMessages") return only(await client.searchChannelMessages(channels.map(channel => ({ channelId: id(channel), teamId: id(pairs[channel]) })), query(args[0]), objectLimit(args[1])), permitted);
    if (operation === "teams.getThread") {
      const team = id(args[0]); const channel = id(args[1]); const message = id(args[2]);
      if (!teams.includes(team) || !channels.includes(channel) || pairs[channel] !== team) deny();
      const thread = await client.getThread(team, channel, message);
      if (thread.teamId !== team || thread.channelId !== channel || thread.rootMessageId !== message) deny();
      return thread;
    }
    if (operation === "teams.getUserInfo") { if (!directoryAccess) deny(); return client.getUserInfo(id(args[0])); }
  }
  throw new IntegrationOperationError(400, "Unsupported integration operation.");
}
