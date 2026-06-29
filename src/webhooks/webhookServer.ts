import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { URL } from "node:url";
import { GraphQueryApi, GraphQueryName } from "../api/graphQuery";
import { lightningSearch, type LightningSearchResult } from "../indexing/lightningSearch";
import { parseGraphSearchScope } from "../indexing/graphSearchScope";
import { RateLimitTracker } from "../api/rateLimitTracker";
import { TokenPool } from "../api/tokenPool";
import { GraphCache } from "../cache/graphCache";
import { createGraphCache } from "../cache/graphCachePostgres";
import { GraphConsistencyManager } from "../cache/graphConsistency";
import { loadWebhookConfig, WebhookConfig } from "../config/webhookConfig";
import { GitHubWebhookHandler } from "./handlers/githubWebhookHandler";
import { GitLabWebhookHandler } from "./handlers/gitlabWebhookHandler";
import { SlackWebhookHandler } from "./handlers/slackWebhookHandler";
import type { NormalizedWebhookEvent } from "./types";
import { PlaceholderWebhookClient, WebhookRegistry } from "./webhookRegistry";
import { WebhookMonitor } from "./webhookMonitor";
import { maybeEnqueueStructureManifest } from "./manifestOnboardingTrigger";
import { handleJobsApiRequest } from "../jobs/jobsApi";
import { createJobRuntime, startJobRuntime, type JobRuntime } from "../jobs/jobRuntime";
import { createChatRouter, handleChatApiRequest, llmHealthPayload } from "../api/chatApi";
import { getDbPool } from "../server/db";
import { OrgStore } from "../server/orgStore";
import { handleEnterpriseApiRequest } from "../server/enterpriseApi";
import { handleOrgApiRequest } from "../server/orgApi";
import { createEstateSyncService } from "../server/estateSyncService";
import { UserStore } from "../server/users/userStore";
import { SsoConfigStore } from "../server/sso/ssoConfigStore";
import { SamlService } from "../server/sso/samlService";
import { AuditLogger } from "../server/audit/auditLogger";
import { UsageTracker } from "../server/usageTracker";
import { handleUsageEventsApiRequest } from "../server/usageEventsApi";
import { handleSamlApiRequest } from "../server/sso/samlApi";
import { loadServerConfig, type ServerConfig } from "../server/serverConfig";
import { authUserId, requireAuth, requireOrgPlan, resolveAuthContext } from "../server/authMiddleware";
import { loadGitHubAppConfig } from "../server/githubAppConfig";
import { createGithubAppService } from "../server/codeHostCredentialResolver";
import type { GitHubAppService } from "../server/githubAppService";
import { handleGitHubAppApiRequest } from "../server/githubAppApi";
import { loadGitHubOAuthConfig } from "../server/githubOAuthConfig";
import { createGitHubOAuthService } from "../server/githubOAuthService";
import { createGitHubOAuthConnector } from "../server/codeHostConnectors/githubOAuthConnector";
import { loadGitLabAppConfig } from "../server/gitlabAppConfig";
import type { GitLabAppConfig } from "../server/gitlabAppConfig";
import { GitLabAppService, createGitLabAppService } from "../server/gitlabAppService";
import { handleGitLabAppApiRequest } from "../server/gitlabAppApi";
import { GitHubConnector } from "../server/codeHostConnectors/githubConnector";
import { GitLabConnector, createGitLabConnector } from "../server/codeHostConnectors/gitlabConnector";
import { BitbucketConnector, createBitbucketConnector } from "../server/codeHostConnectors/bitbucketConnector";
import { registerConnector } from "../server/codeHostConnectors/registry";
import { loadBitbucketAppConfig } from "../server/bitbucketAppConfig";
import type { BitbucketAppConfig } from "../server/bitbucketAppConfig";
import { BitbucketAppService, createBitbucketAppService } from "../server/bitbucketAppService";
import { handleBitbucketAppApiRequest } from "../server/bitbucketAppApi";
import { loadSlackAppConfig } from "../server/slackAppConfig";
import { createSlackAppService } from "../server/slackAppService";
import { handleSlackAppApiRequest } from "../server/slackAppApi";
import { loadAtlassianAppConfig } from "../server/atlassianAppConfig";
import { createAtlassianAppService } from "../server/atlassianAppService";
import { handleAtlassianAppApiRequest } from "../server/atlassianAppApi";
import { loadNotionAppConfig } from "../server/notionAppConfig";
import { createNotionAppService } from "../server/notionAppService";
import { handleNotionAppApiRequest } from "../server/notionAppApi";
import { loadGoogleDocsAppConfig } from "../server/googleDocsAppConfig";
import { createGoogleDocsAppService } from "../server/googleDocsAppService";
import { handleGoogleDocsAppApiRequest } from "../server/googleDocsAppApi";
import { loadTeamsAppConfig } from "../server/teamsAppConfig";
import { createTeamsAppService } from "../server/teamsAppService";
import { handleTeamsAppApiRequest } from "../server/teamsAppApi";
import { IntegrationConnectionStore } from "../server/integrationConnectionStore";
import { IntegrationScopePolicyStore } from "../server/integrationScopePolicyStore";
import { handleIntegrationApiRequest } from "../server/integrationApi";
import { handleAdminApiRequest } from "../server/adminApi";
import { handleBillingApiRequest } from "../server/billing/billingApi";
import { loadBillingConfig } from "../server/billing/billingConfig";
import { EmailService } from "../server/email/emailService";
import { applyCors, loadCorsOrigins } from "../server/cors";

export type WebhookServerOptions = {
  config?: WebhookConfig;
  cache?: GraphCache;
  monitor?: WebhookMonitor;
  consistency?: GraphConsistencyManager;
  jobs?: JobRuntime;
  orgStore?: OrgStore;
  serverConfig?: ServerConfig;
};

export type WebhookServerRuntime = {
  server: Server;
  config: WebhookConfig;
  cache: GraphCache;
  consistency: GraphConsistencyManager;
  monitor: WebhookMonitor;
  registry: WebhookRegistry;
  rateLimits: RateLimitTracker;
  tokenPool: TokenPool;
  jobs: JobRuntime;
  orgStore?: OrgStore;
  serverConfig: ServerConfig;
  githubApp?: GitHubAppService;
  githubAppConfig?: ReturnType<typeof loadGitHubAppConfig>;
  gitlabApp?: GitLabAppService;
  gitlabAppConfig?: GitLabAppConfig;
  bitbucketApp?: BitbucketAppService;
  bitbucketAppConfig?: BitbucketAppConfig;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function createWebhookServer(options: WebhookServerOptions = {}): Promise<WebhookServerRuntime> {
  const config = options.config ?? loadWebhookConfig();
  const serverConfig = options.serverConfig ?? loadServerConfig();
  const pool = await getDbPool(config.cache.connectionString);
  const orgStore =
    options.orgStore ??
    (pool && serverConfig.credentialsEncryptionKey
      ? new OrgStore(pool, serverConfig.credentialsEncryptionKey)
      : pool
        ? new OrgStore(pool)
        : undefined);

  // Per-user identity, SSO, and audit logging (Enterprise). All no-op without a DB pool.
  const userStore = pool ? new UserStore(pool) : undefined;
  const ssoConfigStore = pool ? new SsoConfigStore(pool) : undefined;
  const auditLogger = new AuditLogger(pool ?? null);
  const usageTracker = new UsageTracker(pool ?? null);
  const samlService = serverConfig.ssoBaseUrl
    ? new SamlService({ baseUrl: serverConfig.ssoBaseUrl, spEntityId: serverConfig.ssoSpEntityId })
    : undefined;

  const githubAppConfig = loadGitHubAppConfig();
  const githubApp =
    githubAppConfig && serverConfig.credentialsEncryptionKey
      ? createGithubAppService(githubAppConfig, serverConfig.credentialsEncryptionKey)
      : undefined;

  const githubOAuthConfig = loadGitHubOAuthConfig();
  const githubOAuth =
    githubOAuthConfig && serverConfig.credentialsEncryptionKey
      ? createGitHubOAuthService(
          githubOAuthConfig.clientId,
          githubOAuthConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const gitlabAppConfig = loadGitLabAppConfig();
  const gitlabApp =
    gitlabAppConfig && serverConfig.credentialsEncryptionKey
      ? createGitLabAppService(
          gitlabAppConfig.clientId,
          gitlabAppConfig.clientSecret,
          gitlabAppConfig.gitlabBaseUrl,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  // Register connectors once per server instance so the generic
  // resolveCodeHostTokenForOrg can refresh tokens for any provider.
  if (githubApp && githubAppConfig) {
    registerConnector(new GitHubConnector(githubApp, githubAppConfig));
  } else if (githubOAuth && githubOAuthConfig && orgStore && serverConfig.credentialsEncryptionKey) {
    registerConnector(
      createGitHubOAuthConnector(githubOAuthConfig, serverConfig.credentialsEncryptionKey, orgStore)
    );
  }
  if (gitlabApp && gitlabAppConfig && orgStore && serverConfig.credentialsEncryptionKey) {
    registerConnector(
      createGitLabConnector(gitlabAppConfig, serverConfig.credentialsEncryptionKey, orgStore)
    );
  }

  const bitbucketAppConfig = loadBitbucketAppConfig();
  const bitbucketApp =
    bitbucketAppConfig && serverConfig.credentialsEncryptionKey
      ? createBitbucketAppService(
          bitbucketAppConfig.clientId,
          bitbucketAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  if (bitbucketApp && bitbucketAppConfig && orgStore && serverConfig.credentialsEncryptionKey) {
    registerConnector(
      createBitbucketConnector(bitbucketAppConfig, serverConfig.credentialsEncryptionKey, orgStore)
    );
  }

  const integrationStore =
    pool && serverConfig.credentialsEncryptionKey
      ? new IntegrationConnectionStore(pool, serverConfig.credentialsEncryptionKey)
      : pool
        ? new IntegrationConnectionStore(pool)
        : undefined;

  const scopePolicyStore = pool ? new IntegrationScopePolicyStore(pool) : undefined;

  const slackAppConfig = loadSlackAppConfig();
  const slackApp =
    slackAppConfig && serverConfig.credentialsEncryptionKey
      ? createSlackAppService(
          slackAppConfig.clientId,
          slackAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const atlassianAppConfig = loadAtlassianAppConfig();
  const atlassianApp =
    atlassianAppConfig && serverConfig.credentialsEncryptionKey
      ? createAtlassianAppService(
          atlassianAppConfig.clientId,
          atlassianAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const notionAppConfig = loadNotionAppConfig();
  const notionApp =
    notionAppConfig && serverConfig.credentialsEncryptionKey
      ? createNotionAppService(
          notionAppConfig.clientId,
          notionAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const googleDocsAppConfig = loadGoogleDocsAppConfig();
  const googleDocsApp =
    googleDocsAppConfig && serverConfig.credentialsEncryptionKey
      ? createGoogleDocsAppService(
          googleDocsAppConfig.clientId,
          googleDocsAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const teamsAppConfig = loadTeamsAppConfig();
  const teamsApp =
    teamsAppConfig && serverConfig.credentialsEncryptionKey
      ? createTeamsAppService(
          teamsAppConfig.clientId,
          teamsAppConfig.clientSecret,
          serverConfig.credentialsEncryptionKey
        )
      : undefined;

  const cache =
    options.cache ??
    (await createGraphCache(config.cache.backend, {
      ttlMs: config.cache.ttl * 1000,
      maxRepos: config.cache.maxRepos,
      pool,
      connectionString: config.cache.connectionString
    }));

  const consistency = options.consistency ?? new GraphConsistencyManager(cache);
  const monitor = options.monitor ?? new WebhookMonitor();
  const rateLimits = new RateLimitTracker({ warnThreshold: config.rateLimit.warnThreshold });
  const tokenPool = new TokenPool(config.tokenPools);
  const graphQuery = new GraphQueryApi({ cache });
  const registry = new WebhookRegistry({
    github: new PlaceholderWebhookClient(),
    gitlab: new PlaceholderWebhookClient(),
    monitor
  });

  const jobs =
    options.jobs ??
    createJobRuntime({
      cache,
      consistency,
      orgStore,
      allowPatFallback: serverConfig.devMode
    });
  if (serverConfig.jobsWorkersEnabled) {
    startJobRuntime(jobs);
  }

  const queue = {
    enqueue: async (event: NormalizedWebhookEvent) => {
      await consistency.enqueue(event);
      await maybeEnqueueStructureManifest(jobs.queue, orgStore, event);
    }
  };

  const estateSync = createEstateSyncService({ orgStore, githubApp, jobQueue: jobs.queue });

  const github = new GitHubWebhookHandler({
    secret: config.webhooks.github.secret ?? githubAppConfig?.webhookSecret,
    monitor,
    queue,
    orgStore,
    githubApp,
    estateSync
  });
  const gitlab = new GitLabWebhookHandler({
    token: config.webhooks.gitlab.secret,
    monitor,
    queue
  });
  const slack = new SlackWebhookHandler({
    signingSecret: config.webhooks.slack.signingSecret,
    monitor,
    queue
  });
  const chatRouter = createChatRouter();
  const billingConfig = loadBillingConfig();
  const emailService = new EmailService(billingConfig);

  const corsOrigins = loadCorsOrigins();

  const server = createServer(async (request, response) => {
    try {
      const parsed = await parseRequest(request);
      if (
        parsed.pathname.startsWith("/v1/") ||
        parsed.pathname === "/health" ||
        parsed.pathname === "/webhooks/stripe"
      ) {
        if (applyCors(request, response, corsOrigins)) {
          return;
        }
      }

      if (parsed.method === "GET" && parsed.pathname === "/health") {
        const jobStats = jobs.monitor.getStats(jobs.queue);
        writeJson(response, 200, {
          ok: true,
          cache: {
            backend: config.cache.backend,
            repos: cache.listRepoIds().length
          },
          webhooks: monitor.getAllHealth(),
          jobs: jobStats,
          llm: llmHealthPayload(chatRouter),
          orgDb: Boolean(orgStore)
        });
        return;
      }

      const orgParsed = {
        method: parsed.method,
        pathname: parsed.pathname,
        query: parsed.query,
        headers: parsed.headers,
        body: parsed.body
      };

      const auth = await resolveAuthContext(
        parsed.headers,
        orgStore,
        serverConfig.legacyApiToken,
        serverConfig.requireApiAuth,
        userStore
      );

      if (
        await handleGitHubAppApiRequest(orgParsed, response, {
          orgStore,
          githubApp,
          githubAppConfig,
          githubOAuth,
          githubOAuthConfig,
          jobQueue: jobs.queue,
          estateSync
        }, auth)
      ) {
        return;
      }

      if (
        await handleGitLabAppApiRequest(orgParsed, response, {
          orgStore,
          gitlabApp,
          gitlabAppConfig,
          jobQueue: jobs.queue
        }, auth)
      ) {
        return;
      }

      if (
        await handleBitbucketAppApiRequest(orgParsed, response, {
          orgStore,
          bitbucketApp,
          bitbucketAppConfig,
          jobQueue: jobs.queue
        }, auth)
      ) {
        return;
      }

      if (
        await handleSlackAppApiRequest(orgParsed, response, {
          integrationStore,
          slackApp,
          slackAppConfig
        }, auth)
      ) {
        return;
      }

      if (
        await handleAtlassianAppApiRequest(orgParsed, response, {
          integrationStore,
          atlassianApp,
          atlassianAppConfig
        }, auth)
      ) {
        return;
      }

      if (
        await handleNotionAppApiRequest(orgParsed, response, {
          integrationStore,
          notionApp,
          notionAppConfig
        }, auth)
      ) {
        return;
      }

      if (
        await handleGoogleDocsAppApiRequest(orgParsed, response, {
          integrationStore,
          googleDocsApp,
          googleDocsAppConfig
        }, auth)
      ) {
        return;
      }

      if (
        await handleTeamsAppApiRequest(orgParsed, response, {
          integrationStore,
          teamsApp,
          teamsAppConfig
        }, auth)
      ) {
        return;
      }

      if (
        await handleSamlApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            query: parsed.query,
            headers: parsed.headers,
            body: parsed.body,
            // CRITICAL: SAML callback is form-encoded — pass the raw body so
            // SAMLResponse isn't lost by JSON parsing.
            rawBody: parsed.rawBody.toString("utf8")
          },
          response,
          { orgStore, userStore, ssoConfigStore, samlService, auditLogger, serverConfig }
        )
      ) {
        return;
      }

      // Chat + inline completion routes must run before handleOrgApiRequest:
      // the org handler greedily claims every "/v1/*" path and 404s anything it
      // doesn't recognize, which would otherwise swallow "/v1/chat".
      if (
        await handleUsageEventsApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          { orgStore, userStore, serverConfig, usageTracker }
        )
      ) {
        return;
      }

      if (
        await handleChatApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          { router: chatRouter, orgStore, serverConfig, userStore, auditLogger, usageTracker },
          request
        )
      ) {
        return;
      }

      if (
        await handleIntegrationApiRequest(orgParsed, response, {
          integrationStore,
          scopePolicyStore,
          orgStore,
          atlassianApp,
          notionApp,
          googleDocsApp,
          teamsApp,
          slackApp
        }, auth)
      ) {
        return;
      }

      if (
        await handleBillingApiRequest(
          { ...orgParsed, rawBody: parsed.rawBody },
          response,
          { orgStore, userStore, emailService, auditLogger, serverConfig, pool }
        )
      ) {
        return;
      }

      if (
        await handleAdminApiRequest(orgParsed, response, {
          orgStore,
          userStore,
          integrationStore,
          scopePolicyStore,
          serverConfig,
          auditLogger,
          usageTracker
        })
      ) {
        return;
      }

      if (await handleOrgApiRequest(orgParsed, response, {
        orgStore,
        jobQueue: jobs.queue,
        githubApp,
        estateSync,
        serverConfig,
        userStore,
        auditLogger,
        usageTracker,
        integrationStore
      })) {
        return;
      }

      if (
        await handleEnterpriseApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          { orgStore, ssoConfigStore, userStore, serverConfig }
        )
      ) {
        return;
      }

      if (
        await handleJobsApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          {
            queue: jobs.queue,
            monitor: jobs.monitor,
            workers: jobs.workers,
            config: jobs.config,
            orgStore,
            serverConfig,
            userStore,
            auditLogger
          }
        )
      ) {
        return;
      }

      if (parsed.method === "GET" && parsed.pathname === "/webhooks/health") {
        writeJson(response, 200, {
          webhooks: monitor.getAllHealth(),
          deliveries: monitor.recentDeliveries(25),
          registrations: registry.health()
        });
        return;
      }

      if (parsed.method === "POST" && parsed.pathname === "/webhooks/github") {
        const result = await github.handle(parsed);
        writeJson(response, result.statusCode, result);
        return;
      }

      if (parsed.method === "POST" && parsed.pathname === "/webhooks/gitlab") {
        const result = await gitlab.handle(parsed);
        writeJson(response, result.statusCode, result);
        return;
      }

      if (parsed.method === "POST" && parsed.pathname === "/webhooks/slack") {
        const challenge = slackChallenge(parsed.body);
        const result = await slack.handle(parsed);
        if (challenge && result.accepted) {
          writeJson(response, 200, { challenge });
          return;
        }
        writeJson(response, result.statusCode, result);
        return;
      }

      if (parsed.method === "GET" && parsed.pathname.startsWith("/graph/")) {
        const auth = await resolveAuthContext(
          parsed.headers,
          orgStore,
          serverConfig.legacyApiToken,
          serverConfig.requireApiAuth,
          userStore
        );
        if (!requireAuth(auth, serverConfig.requireApiAuth)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        if (!orgStore || auth!.orgId === "legacy") {
          writeJson(response, 503, { error: "organization database not configured" });
          return;
        }
        if (!(await requireOrgPlan(orgStore, auth!, response, "pro", "enterprise"))) {
          return;
        }
        const [repoId, query] = parseGraphPath(parsed.pathname);
        const filters = {
          file: parsed.query.get("file") ?? undefined,
          pattern: parsed.query.get("pattern") ?? undefined,
          collectionId: parsed.query.get("collectionId") ?? undefined,
          scope: parseGraphSearchScope(parsed.query.get("scope")),
          mention: parsed.query.get("mention") === "true",
          days: numberParam(parsed.query.get("days")),
          forceRefresh: parsed.query.get("forceRefresh") === "true"
        };
        let result: unknown;
        if (query === "searchFiles" && filters.pattern) {
          const pool = await getDbPool();
          if (pool) {
            const searchOptions = filters.collectionId
              ? {
                  collectionId: filters.collectionId,
                  pattern: filters.pattern,
                  mention: filters.mention
                }
              : filters.scope
                ? {
                    scope: filters.scope,
                    pattern: filters.pattern,
                    mention: filters.mention
                  }
                : {
                    repoId,
                    pattern: filters.pattern,
                    mention: filters.mention
                  };
            const lightning = await lightningSearch(pool, auth!.orgId, searchOptions);
            if (lightning.hits.length > 0 || lightning.symbols.length > 0) {
              result = formatLightningSearchResult(
                filters.collectionId ? undefined : repoId,
                lightning,
                filters.collectionId
              );
            }
            if (query === "searchFiles") {
              await usageTracker.record({
                orgId: auth!.orgId,
                userId: auth!.userId,
                principal: authUserId(auth!),
                eventType: "lightning.search",
                metadata: {
                  pattern: filters.pattern,
                  collectionId: filters.collectionId,
                  repoId: filters.collectionId ? undefined : repoId,
                  hitCount: lightning.hits.length + lightning.symbols.length
                }
              });
            }
          }
        }
        if (!result) {
          result = await graphQuery.queryGraph({
            repoId,
            query,
            filters
          });
        }
        writeJson(response, result ? 200 : 404, result ?? { error: "graph not found" });
        return;
      }

      if (parsed.method === "GET" && parsed.pathname === "/rate-limits") {
        const auth = await resolveAuthContext(
          parsed.headers,
          orgStore,
          serverConfig.legacyApiToken,
          serverConfig.requireApiAuth,
          userStore
        );
        if (!requireAuth(auth, serverConfig.requireApiAuth)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        writeJson(response, 200, {
          states: rateLimits.getAll(),
          predictions: ["github", "gitlab", "slack"].map((provider) =>
            rateLimits.prediction(provider as "github" | "gitlab" | "slack")
          )
        });
        return;
      }

      if (parsed.method === "GET" && parsed.pathname === "/token-pools") {
        const auth = await resolveAuthContext(
          parsed.headers,
          orgStore,
          serverConfig.legacyApiToken,
          serverConfig.requireApiAuth,
          userStore
        );
        if (!requireAuth(auth, serverConfig.requireApiAuth)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        writeJson(response, 200, { tokens: tokenPool.list() });
        return;
      }

      writeJson(response, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected server error";
      writeJson(response, 500, { error: message });
    }
  });

  return {
    server,
    config,
    cache,
    consistency,
    monitor,
    registry,
    rateLimits,
    tokenPool,
    jobs,
    orgStore,
    serverConfig,
    githubApp,
    githubAppConfig,
    gitlabApp,
    gitlabAppConfig,
    bitbucketApp,
    bitbucketAppConfig
  };
}

export async function startWebhookServer(options: WebhookServerOptions = {}): Promise<WebhookServerRuntime> {
  const runtime = await createWebhookServer(options);
  runtime.server.listen(runtime.config.port, () => {
    console.log(`CoopAI webhook server listening on port ${runtime.config.port}`);
  });
  return runtime;
}

async function parseRequest(request: IncomingMessage): Promise<ParsedRequest> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const rawBody = await readBody(request);
  return {
    method: request.method ?? "GET",
    pathname: url.pathname,
    query: url.searchParams,
    headers: normalizeHeaders(request.headers),
    rawBody,
    body: parseJson(rawBody)
  };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseJson(rawBody: Buffer): unknown {
  if (rawBody.length === 0) {
    return {};
  }
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return {};
  }
}

function normalizeHeaders(headers: IncomingMessage["headers"]): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, dateReplacer));
}

function dateReplacer(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function slackChallenge(body: unknown): string | undefined {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return record.type === "url_verification" && typeof record.challenge === "string"
    ? record.challenge
    : undefined;
}

function parseGraphPath(pathname: string): [string, GraphQueryName] {
  const parts = pathname.split("/").filter(Boolean);
  const repoId = decodeURIComponent(parts[1] ?? "");
  const segment = parts[2] ?? "tree";
  const queryBySegment: Record<string, GraphQueryName> = {
    tree: "getFileTree",
    ownership: "getOwnership",
    dependents: "getDependents",
    "transitive-dependents": "getTransitiveDependents",
    changes: "getRecentChanges",
    search: "searchFiles",
    conflicts: "getConflicts"
  };
  const query = queryBySegment[segment];
  if (!repoId || !query) {
    throw new Error("invalid graph query path");
  }
  return [repoId, query];
}

function numberParam(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatLightningSearchResult(
  repoId: string | undefined,
  search: LightningSearchResult,
  collectionId?: string
): unknown {
  return {
    repoId,
    collectionId,
    data: search.hits.map((hit) => ({
      repoId: hit.repoId,
      path: hit.path,
      size: hit.content.length,
      lastModified: new Date(),
      lastAuthor: "lightning-index",
      sha: String(hit.lineNumber),
      score: hit.score
    })),
    symbols: search.symbols.map((symbol) => ({
      repoId: symbol.repoId,
      symbol: symbol.symbol,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      character: 0,
      displayName: symbol.displayName
    })),
    freshness: search.source,
    lastUpdated: new Date(),
    stale: false
  };
}

if (require.main === module) {
  void startWebhookServer();
}
