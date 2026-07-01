import type { ServerResponse } from "node:http";
import { ConfluenceClient } from "../api/confluence/confluenceClient";
import { GoogleDocsClient } from "../api/googleDocs/googleDocsClient";
import { JiraClient } from "../api/jira/jiraClient";
import { NotionClient } from "../api/notion/notionClient";
import { SlackClient } from "../api/slack/slackClient";
import {
  applyConfluenceSpaceScope,
  applyJiraProjectScope
} from "../integrationScope/atlassianQuery";
import { filterNotionPagesByScope } from "../integrationScope/notionQuery";
import { applySlackChannelScope } from "../integrationScope/slackQuery";
import { filterGoogleDocsHitsByFolder } from "../integrationScope/googleDocsQuery";
import {
  atlassianPolicyIsActive,
  googleDocsPolicyIsActive,
  notionPolicyIsActive,
  parseAtlassianIntegrationPolicy,
  parseGoogleDocsIntegrationPolicy,
  parseNotionIntegrationPolicy,
  parseSlackIntegrationPolicy,
  slackPolicyIsActive,
  type AtlassianIntegrationPolicy,
  type GoogleDocsIntegrationPolicy,
  type NotionIntegrationPolicy,
  type SlackIntegrationPolicy
} from "../integrationScope/types";
import { auditActor } from "./audit/auditLogger";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import type { AuthContext } from "./orgStore";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveOrgIntegrationAccessToken } from "./integrationApi";
import { resolveIntegrationScope } from "./resolveIntegrationScope";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  body: unknown;
};

const SCOPED_PROVIDERS: IntegrationProvider[] = ["slack", "atlassian", "notion", "google-docs"];

export async function handleAdminIntegrationScopeRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  const scopeMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/scope$/);
  if (scopeMatch) {
    const provider = decodeURIComponent(scopeMatch[1]) as IntegrationProvider;
    if (!SCOPED_PROVIDERS.includes(provider)) {
      writeJson(response, 400, { error: "unknown provider" });
      return true;
    }
    if (parsed.method === "GET") {
      return handleGetScope(response, deps, auth, provider);
    }
    if (parsed.method === "PUT") {
      return handlePutScope(parsed, response, deps, auth, provider);
    }
    writeJson(response, 405, { error: "method not allowed" });
    return true;
  }

  const resourcesMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/resources$/);
  if (resourcesMatch && parsed.method === "GET") {
    const provider = decodeURIComponent(resourcesMatch[1]) as IntegrationProvider;
    if (provider === "slack") {
      return handleGetSlackResources(parsed, response, deps, auth);
    }
    if (provider === "atlassian") {
      return handleGetAtlassianResources(parsed, response, deps, auth);
    }
    if (provider === "notion") {
      return handleGetNotionResources(parsed, response, deps, auth);
    }
    if (provider === "google-docs") {
      return handleGetGoogleDocsResources(parsed, response, deps, auth);
    }
    writeJson(response, 200, { provider, resources: [], comingSoon: true });
    return true;
  }

  const testMatch = parsed.pathname.match(/^\/v1\/admin\/integrations\/([^/]+)\/test$/);
  if (testMatch && parsed.method === "POST") {
    const provider = decodeURIComponent(testMatch[1]) as IntegrationProvider;
    if (provider === "slack") {
      return handleTestSlack(response, deps, auth);
    }
    if (provider === "atlassian") {
      return handleTestAtlassian(response, deps, auth);
    }
    if (provider === "notion") {
      return handleTestNotion(response, deps, auth);
    }
    if (provider === "google-docs") {
      return handleTestGoogleDocs(response, deps, auth);
    }
    writeJson(response, 501, { error: "test not implemented for provider" });
    return true;
  }

  return false;
}

async function handleGetScope(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext,
  provider: IntegrationProvider
): Promise<boolean> {
  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = deps.integrationStore
    ? await deps.integrationStore.get(auth.orgId, provider)
    : undefined;
  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider,
    orgPlan: org?.plan ?? "free",
    connected: Boolean(connection),
    scopePolicyStore: deps.scopePolicyStore
  });
  const record = deps.scopePolicyStore
    ? await deps.scopePolicyStore.get(auth.orgId, provider)
    : undefined;

  writeJson(response, 200, {
    provider,
    installed: Boolean(connection),
    scopeStatus: resolved.scopeStatus,
    enforced: resolved.enforced,
    allowed: resolved.allowed,
    policy: record?.policy ?? {},
    summary: scopeSummary(provider, record?.policy),
    updatedAt: record?.updatedAt?.toISOString()
  });
  return true;
}

async function handlePutScope(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext,
  provider: IntegrationProvider
): Promise<boolean> {
  if (!deps.scopePolicyStore) {
    writeJson(response, 503, { error: "scope policy store not configured" });
    return true;
  }
  if (provider !== "slack" && provider !== "atlassian" && provider !== "notion" && provider !== "google-docs") {
    writeJson(response, 501, { error: "scope configuration coming soon for this provider" });
    return true;
  }

  const connection = deps.integrationStore
    ? await deps.integrationStore.get(auth.orgId, provider)
    : undefined;
  if (!connection) {
    writeJson(response, 400, { error: "integration not connected" });
    return true;
  }

  const body = parsed.body as { policy?: unknown } | null;
  let policy:
    | SlackIntegrationPolicy
    | AtlassianIntegrationPolicy
    | NotionIntegrationPolicy
    | GoogleDocsIntegrationPolicy
    | undefined;
  if (provider === "slack") {
    policy = parseSlackIntegrationPolicy(body?.policy);
    if (!policy) {
      writeJson(response, 400, { error: "invalid slack scope policy" });
      return true;
    }
  } else if (provider === "atlassian") {
    policy = parseAtlassianIntegrationPolicy(body?.policy);
    if (!policy) {
      writeJson(response, 400, { error: "invalid atlassian scope policy" });
      return true;
    }
  } else if (provider === "notion") {
    policy = parseNotionIntegrationPolicy(body?.policy);
    if (!policy) {
      writeJson(response, 400, { error: "invalid notion scope policy" });
      return true;
    }
  } else {
    const parsedPolicy = parseGoogleDocsIntegrationPolicy(body?.policy);
    if (!parsedPolicy) {
      writeJson(response, 400, { error: "invalid google-docs scope policy" });
      return true;
    }
    const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "google-docs", deps);
    if (!accessToken) {
      writeJson(response, 400, { error: "Google Docs access token unavailable." });
      return true;
    }
    const client = new GoogleDocsClient({ accessToken });
    const expandedFolderIds = await client.expandFolderTree(parsedPolicy.folders);
    policy = { ...parsedPolicy, expandedFolderIds };
  }

  const saved = await deps.scopePolicyStore.upsert(auth.orgId, provider, policy);
  const actor = auditActor(auth);
  await deps.auditLogger?.record({
    orgId: auth.orgId,
    userId: actor.userId,
    principal: actor.principal,
    action: "admin.integration.scope.updated",
    metadata: scopeAuditMetadata(provider, policy)
  });

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider,
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  writeJson(response, 200, {
    provider,
    scopeStatus: resolved.scopeStatus,
    policy: saved.policy,
    summary: scopeSummary(provider, saved.policy)
  });
  return true;
}

async function handleGetSlackResources(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const botToken = await deps.integrationStore.getBotAccessToken(auth.orgId, "slack");
  if (!botToken) {
    writeJson(response, 400, {
      error: "Slack bot token unavailable. Disconnect and reconnect Slack to refresh channel access."
    });
    return true;
  }

  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";

  try {
    const client = new SlackClient({ token: botToken });
    const channels = await client.listChannelsForScopePicker({ limit: 500 });
    const filtered = query
      ? channels.filter(
          (channel) =>
            channel.name.toLowerCase().includes(query) ||
            channel.id.toLowerCase().includes(query) ||
            channel.topic?.toLowerCase().includes(query)
        )
      : channels;

    writeJson(response, 200, {
      provider: "slack",
      resources: filtered.map((channel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.isPrivate,
        topic: channel.topic
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list Slack channels.";
    writeJson(response, 400, { error: message });
  }
  return true;
}

async function handleGetAtlassianResources(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const product = parsed.query?.get("product")?.trim().toLowerCase();
  if (product !== "jira" && product !== "confluence") {
    writeJson(response, 400, { error: "product query param must be jira or confluence" });
    return true;
  }

  const connection = await deps.integrationStore.get(auth.orgId, "atlassian");
  if (!connection) {
    writeJson(response, 400, { error: "Atlassian is not connected." });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "atlassian", deps);
  if (!accessToken) {
    writeJson(response, 400, { error: "Atlassian access token unavailable." });
    return true;
  }

  const cloudId = String(connection.metadata.cloudId ?? "").trim();
  const siteUrl = String(connection.metadata.siteUrl ?? "").trim() || "https://your-domain.atlassian.net";
  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";

  try {
    if (product === "jira") {
      const client = new JiraClient({
        baseUrl: siteUrl,
        oauthAccessToken: accessToken,
        cloudId: cloudId || undefined
      });
      const projects = await client.listProjects({ limit: 500 });
      const filtered = query
        ? projects.filter(
            (project) =>
              project.name.toLowerCase().includes(query) ||
              project.key.toLowerCase().includes(query) ||
              project.id.toLowerCase().includes(query)
          )
        : projects;
      writeJson(response, 200, {
        provider: "atlassian",
        product,
        resources: filtered.map((project) => ({
          id: project.id,
          key: project.key,
          name: project.name
        }))
      });
      return true;
    }

    const wikiBase = siteUrl.endsWith("/wiki") ? siteUrl : `${siteUrl.replace(/\/+$/, "")}/wiki`;
    const client = new ConfluenceClient({
      baseUrl: wikiBase,
      oauthAccessToken: accessToken,
      cloudId: cloudId || undefined
    });
    const spaces = await client.listSpaces({ limit: 500 });
    const filtered = query
      ? spaces.filter(
          (space) =>
            space.name.toLowerCase().includes(query) ||
            space.key.toLowerCase().includes(query) ||
            space.id.toLowerCase().includes(query)
        )
      : spaces;
    writeJson(response, 200, {
      provider: "atlassian",
      product,
      resources: filtered.map((space) => ({
        id: space.id,
        key: space.key,
        name: space.name
      }))
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list Atlassian resources.";
    writeJson(response, 400, { error: message });
    return true;
  }
}

async function handleGetNotionResources(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const connection = await deps.integrationStore.get(auth.orgId, "notion");
  if (!connection) {
    writeJson(response, 400, { error: "Notion is not connected." });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "notion", deps);
  if (!accessToken) {
    writeJson(response, 400, { error: "Notion access token unavailable." });
    return true;
  }

  const query = parsed.query?.get("q")?.trim() ?? "";
  const client = new NotionClient({ token: accessToken });

  try {
    const resources = await client.searchResources({ query, limit: 200 });
    const filtered = query
      ? resources.filter(
          (resource) =>
            resource.title.toLowerCase().includes(query.toLowerCase()) ||
            resource.id.toLowerCase().includes(query.toLowerCase()) ||
            resource.type.toLowerCase().includes(query.toLowerCase())
        )
      : resources;

    writeJson(response, 200, {
      provider: "notion",
      resources: filtered.map((resource) => ({
        id: resource.id,
        name: resource.title,
        type: resource.type,
        parentId: resource.parentId,
        parentType: resource.parentType,
        parentTitle: resource.parentTitle
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list Notion resources.";
    writeJson(response, 400, { error: message });
  }
  return true;
}

async function handleGetGoogleDocsResources(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const connection = await deps.integrationStore.get(auth.orgId, "google-docs");
  if (!connection) {
    writeJson(response, 400, { error: "Google Docs is not connected." });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "google-docs", deps);
  if (!accessToken) {
    writeJson(response, 400, { error: "Google Docs access token unavailable." });
    return true;
  }

  const query = parsed.query?.get("q")?.trim().toLowerCase() ?? "";
  const client = new GoogleDocsClient({ accessToken });

  try {
    const [sharedDrives, folders] = await Promise.all([
      client.listSharedDrives({ limit: 100 }),
      client.listFolders({ query: query || undefined, limit: 200 })
    ]);
    const resources = [
      ...sharedDrives.map((drive) => ({
        id: drive.id,
        name: drive.name,
        kind: drive.kind
      })),
      ...folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        kind: folder.kind
      }))
    ];
    const filtered = query
      ? resources.filter(
          (resource) =>
            resource.name.toLowerCase().includes(query) ||
            resource.id.toLowerCase().includes(query) ||
            resource.kind.toLowerCase().includes(query)
        )
      : resources;

    writeJson(response, 200, {
      provider: "google-docs",
      resources: filtered
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list Google Docs resources.";
    writeJson(response, 400, { error: message });
  }
  return true;
}

async function handleTestSlack(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = await deps.integrationStore.get(auth.orgId, "slack");
  if (!connection) {
    writeJson(response, 200, { ok: false, message: "Slack is not connected." });
    return true;
  }

  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider: "slack",
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  if (resolved.enforced && !resolved.allowed) {
    writeJson(response, 200, {
      ok: false,
      message: resolved.reason ?? "Configure allowed Slack channels before testing."
    });
    return true;
  }

  const userToken = await deps.integrationStore.getAccessToken(auth.orgId, "slack");
  if (!userToken) {
    writeJson(response, 400, { ok: false, message: "Slack access token unavailable." });
    return true;
  }

  const client = new SlackClient({ token: userToken });
  const channelIds = resolved.slack?.channelIds ?? [];
  const channelNames = resolved.slack?.channelNames ?? [];
  const baseQuery = channelNames[0] ? `in:${channelNames[0]}` : "*";
  const queries =
    resolved.enforced && channelIds.length > 0
      ? applySlackChannelScope([baseQuery], channelIds, channelNames)
      : [baseQuery];

  try {
    const hits = await client.searchMessages(queries[0] ?? baseQuery, { limit: 3 });
    const allowed = new Set(channelIds);
    const scopedHits =
      allowed.size > 0
        ? hits.filter((hit) => !hit.channelId || allowed.has(hit.channelId))
        : hits;
    const channelLabel = channelNames[0] ? `#${channelNames[0]}` : "workspace";
    writeJson(response, 200, {
      ok: true,
      message:
        resolved.enforced && channelIds.length > 0
          ? `Scoped Slack search succeeded (${scopedHits.length} recent hit(s) in allowlisted channels; tested ${channelLabel}).`
          : `Slack search succeeded (${scopedHits.length} recent hit(s) in ${channelLabel}).`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack scoped test failed.";
    writeJson(response, 200, { ok: false, message });
  }
  return true;
}

async function handleTestAtlassian(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = await deps.integrationStore.get(auth.orgId, "atlassian");
  if (!connection) {
    writeJson(response, 200, { ok: false, message: "Atlassian is not connected." });
    return true;
  }

  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider: "atlassian",
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  if (resolved.enforced && !resolved.allowed) {
    writeJson(response, 200, {
      ok: false,
      message:
        resolved.reason ??
        "Configure allowed Jira projects or Confluence spaces before testing."
    });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "atlassian", deps);
  if (!accessToken) {
    writeJson(response, 400, { ok: false, message: "Atlassian access token unavailable." });
    return true;
  }

  const cloudId = String(connection.metadata.cloudId ?? "").trim();
  const siteUrl = String(connection.metadata.siteUrl ?? "").trim() || "https://your-domain.atlassian.net";
  const wikiBase = siteUrl.endsWith("/wiki") ? siteUrl : `${siteUrl.replace(/\/+$/, "")}/wiki`;
  const jiraProjectKeys = resolved.atlassian?.jiraProjectKeys ?? [];
  const confluenceSpaceKeys = resolved.atlassian?.confluenceSpaceKeys ?? [];
  const messages: string[] = [];
  let ok = true;

  try {
    if (jiraProjectKeys.length > 0) {
      const jiraClient = new JiraClient({
        baseUrl: siteUrl,
        oauthAccessToken: accessToken,
        cloudId: cloudId || undefined
      });
      const baseJql = "updated >= -30d ORDER BY updated DESC";
      const scopedJql =
        resolved.enforced && jiraProjectKeys.length > 0
          ? applyJiraProjectScope(
              [baseJql],
              resolved.atlassian?.jiraProjectIds ?? [],
              jiraProjectKeys
            )[0] ?? baseJql
          : baseJql;
      const issues = await jiraClient.searchIssues(scopedJql, 3);
      const projectLabel = jiraProjectKeys[0] ?? "project";
      messages.push(
        resolved.enforced
          ? `Scoped Jira search succeeded (${issues.length} recent issue(s); tested ${projectLabel}).`
          : `Jira search succeeded (${issues.length} recent issue(s) in ${projectLabel}).`
      );
    }

    if (confluenceSpaceKeys.length > 0) {
      const confluenceClient = new ConfluenceClient({
        baseUrl: wikiBase,
        oauthAccessToken: accessToken,
        cloudId: cloudId || undefined
      });
      const baseCql = "type=page ORDER BY lastModified DESC";
      const scopedCql =
        resolved.enforced && confluenceSpaceKeys.length > 0
          ? applyConfluenceSpaceScope(
              [baseCql],
              resolved.atlassian?.confluenceSpaceIds ?? [],
              confluenceSpaceKeys
            )[0] ?? baseCql
          : baseCql;
      const pages = await confluenceClient.searchPages(scopedCql, 3);
      const spaceLabel = confluenceSpaceKeys[0] ?? "space";
      messages.push(
        resolved.enforced
          ? `Scoped Confluence search succeeded (${pages.length} recent page(s); tested ${spaceLabel}).`
          : `Confluence search succeeded (${pages.length} recent page(s) in ${spaceLabel}).`
      );
    }

    if (messages.length === 0) {
      writeJson(response, 200, {
        ok: false,
        message: "Configure allowed Jira projects or Confluence spaces before testing."
      });
      return true;
    }

    writeJson(response, 200, {
      ok,
      message: messages.join(" ")
    });
  } catch (error) {
    ok = false;
    const message = error instanceof Error ? error.message : "Atlassian scoped test failed.";
    writeJson(response, 200, { ok, message });
  }
  return true;
}

async function handleTestNotion(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = await deps.integrationStore.get(auth.orgId, "notion");
  if (!connection) {
    writeJson(response, 200, { ok: false, message: "Notion is not connected." });
    return true;
  }

  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider: "notion",
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  if (resolved.enforced && !resolved.allowed) {
    writeJson(response, 200, {
      ok: false,
      message: resolved.reason ?? "Configure allowed Notion pages and databases before testing."
    });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "notion", deps);
  if (!accessToken) {
    writeJson(response, 400, { ok: false, message: "Notion access token unavailable." });
    return true;
  }

  const resourceIds = resolved.notion?.resourceIds ?? [];
  const resourceTitles = resolved.notion?.resourceTitles ?? [];
  const client = new NotionClient({ token: accessToken });

  try {
    const pages = await client.searchPages(resourceTitles[0] ?? "", 10);
    const allowed = new Set(resourceIds);
    const scopedPages =
      resolved.enforced && allowed.size > 0
        ? filterNotionPagesByScope(pages, allowed)
        : pages;
    const resourceLabel = resourceTitles[0] ?? "workspace";
    writeJson(response, 200, {
      ok: true,
      message:
        resolved.enforced && allowed.size > 0
          ? `Scoped Notion search succeeded (${scopedPages.length} recent hit(s) in allowlisted resources; tested ${resourceLabel}).`
          : `Notion search succeeded (${scopedPages.length} recent hit(s) in ${resourceLabel}).`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notion scoped test failed.";
    writeJson(response, 200, { ok: false, message });
  }
  return true;
}

async function handleTestGoogleDocs(
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.integrationStore) {
    writeJson(response, 503, { error: "integration store not configured" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(auth.orgId);
  const connection = await deps.integrationStore.get(auth.orgId, "google-docs");
  if (!connection) {
    writeJson(response, 200, { ok: false, message: "Google Docs is not connected." });
    return true;
  }

  const resolved = await resolveIntegrationScope({
    orgId: auth.orgId,
    provider: "google-docs",
    orgPlan: org?.plan ?? "free",
    connected: true,
    scopePolicyStore: deps.scopePolicyStore
  });

  if (resolved.enforced && !resolved.allowed) {
    writeJson(response, 200, {
      ok: false,
      message:
        resolved.reason ??
        "Configure allowed folders or shared drives before testing."
    });
    return true;
  }

  const accessToken = await resolveOrgIntegrationAccessToken(auth.orgId, "google-docs", deps);
  if (!accessToken) {
    writeJson(response, 400, { ok: false, message: "Google Docs access token unavailable." });
    return true;
  }

  const expandedFolderIds = resolved.googleDocs?.expandedFolderIds ?? [];
  const folderNames = resolved.googleDocs?.folderNames ?? [];
  const client = new GoogleDocsClient({ accessToken });

  try {
    const searchTerm = folderNames[0] ?? "document";
    const searchScope =
      resolved.enforced && expandedFolderIds.length > 0 ? { expandedFolderIds } : undefined;
    const documents = await client.searchDocumentsForTerms([searchTerm], 10, searchScope);
    const allowed = new Set(expandedFolderIds);
    const scopedDocuments =
      resolved.enforced && allowed.size > 0
        ? filterGoogleDocsHitsByFolder(documents, allowed)
        : documents;
    const folderLabel = folderNames[0] ?? "workspace";
    writeJson(response, 200, {
      ok: true,
      message:
        resolved.enforced && allowed.size > 0
          ? `Scoped Google Docs search succeeded (${scopedDocuments.length} recent document(s) in allowlisted folders; tested ${folderLabel}).`
          : `Google Docs search succeeded (${scopedDocuments.length} recent document(s) in ${folderLabel}).`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Docs scoped test failed.";
    writeJson(response, 200, { ok: false, message });
  }
  return true;
}

function scopeAuditMetadata(
  provider: IntegrationProvider,
  policy:
    | SlackIntegrationPolicy
    | AtlassianIntegrationPolicy
    | NotionIntegrationPolicy
    | GoogleDocsIntegrationPolicy
): Record<string, unknown> {
  if (provider === "slack") {
    const slackPolicy = policy as SlackIntegrationPolicy;
    return { provider, channelCount: slackPolicy.channels.length };
  }
  if (provider === "atlassian") {
    const atlassianPolicy = policy as AtlassianIntegrationPolicy;
    return {
      provider,
      jiraProjectCount: atlassianPolicy.jiraProjects.length,
      confluenceSpaceCount: atlassianPolicy.confluenceSpaces.length
    };
  }
  if (provider === "notion") {
    const notionPolicy = policy as NotionIntegrationPolicy;
    return { provider, resourceCount: notionPolicy.resources.length };
  }
  const googleDocsPolicy = policy as GoogleDocsIntegrationPolicy;
  return {
    provider,
    folderCount: googleDocsPolicy.folders.length,
    expandedFolderCount: googleDocsPolicy.expandedFolderIds.length
  };
}

function scopeSummary(provider: IntegrationProvider, policy: unknown): string | undefined {
  if (provider === "slack") {
    const slackPolicy = parseSlackIntegrationPolicy(policy);
    if (!slackPolicyIsActive(slackPolicy)) {
      return undefined;
    }
    const count = slackPolicy!.channels.length;
    return count === 1 ? "1 channel selected" : `${count} channels selected`;
  }

  if (provider === "atlassian") {
    const atlassianPolicy = parseAtlassianIntegrationPolicy(policy);
    if (!atlassianPolicyIsActive(atlassianPolicy)) {
      return undefined;
    }
    const parts: string[] = [];
    const jiraCount = atlassianPolicy!.jiraProjects.length;
    const spaceCount = atlassianPolicy!.confluenceSpaces.length;
    if (jiraCount > 0) {
      parts.push(jiraCount === 1 ? "1 Jira project" : `${jiraCount} Jira projects`);
    }
    if (spaceCount > 0) {
      parts.push(spaceCount === 1 ? "1 Confluence space" : `${spaceCount} Confluence spaces`);
    }
    return parts.join(", ");
  }

  if (provider === "notion") {
    const notionPolicy = parseNotionIntegrationPolicy(policy);
    if (!notionPolicyIsActive(notionPolicy)) {
      return undefined;
    }
    const count = notionPolicy!.resources.length;
    const pageCount = notionPolicy!.resources.filter((resource) => resource.type === "page").length;
    const databaseCount = notionPolicy!.resources.filter((resource) => resource.type === "database").length;
    const parts: string[] = [];
    if (pageCount > 0) {
      parts.push(pageCount === 1 ? "1 page" : `${pageCount} pages`);
    }
    if (databaseCount > 0) {
      parts.push(databaseCount === 1 ? "1 database" : `${databaseCount} databases`);
    }
    return parts.length > 0 ? parts.join(", ") : count === 1 ? "1 resource selected" : `${count} resources selected`;
  }

  if (provider === "google-docs") {
    const googleDocsPolicy = parseGoogleDocsIntegrationPolicy(policy);
    if (!googleDocsPolicyIsActive(googleDocsPolicy)) {
      return undefined;
    }
    const folderCount = googleDocsPolicy!.folders.filter((folder) => folder.kind === "folder").length;
    const driveCount = googleDocsPolicy!.folders.filter((folder) => folder.kind === "shared_drive").length;
    const parts: string[] = [];
    if (folderCount > 0) {
      parts.push(folderCount === 1 ? "1 folder" : `${folderCount} folders`);
    }
    if (driveCount > 0) {
      parts.push(driveCount === 1 ? "1 shared drive" : `${driveCount} shared drives`);
    }
    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  return undefined;
}

export async function resolveScopeStatusForIntegration(
  deps: AdminApiDeps,
  orgId: string,
  orgPlan: string,
  provider: IntegrationProvider,
  installed: boolean
): Promise<{ scopeStatus: string; scopeSummary?: string }> {
  if (!SCOPED_PROVIDERS.includes(provider)) {
    return { scopeStatus: "none" };
  }
  const resolved = await resolveIntegrationScope({
    orgId,
    provider,
    orgPlan,
    connected: installed,
    scopePolicyStore: deps.scopePolicyStore
  });
  const record = deps.scopePolicyStore ? await deps.scopePolicyStore.get(orgId, provider) : undefined;
  return {
    scopeStatus: resolved.scopeStatus,
    scopeSummary: scopeSummary(provider, record?.policy)
  };
}
