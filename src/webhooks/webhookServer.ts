import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { URL } from "node:url";
import { GraphQueryApi } from "../api/graphQuery";
import { handleGraphHttp } from "./graphHttp";
import { RateLimitTracker } from "../api/rateLimitTracker";
import { TokenPool } from "../api/tokenPool";
import { GraphCache } from "../cache/graphCache";
import { createGraphCache } from "../cache/graphCachePostgres";
import { GraphConsistencyManager } from "../cache/graphConsistency";
import { loadWebhookConfig, WebhookConfig } from "../config/webhookConfig";
import { GitHubWebhookHandler } from "./handlers/githubWebhookHandler";
import { GitLabWebhookHandler } from "./handlers/gitlabWebhookHandler";
import { BitbucketWebhookHandler } from "./handlers/bitbucketWebhookHandler";
import { SlackWebhookHandler } from "./handlers/slackWebhookHandler";
import type { NormalizedWebhookEvent } from "./types";
import { PlaceholderWebhookClient, WebhookRegistry } from "./webhookRegistry";
import { WebhookMonitor } from "./webhookMonitor";
import { handleJobsApiRequest } from "../jobs/jobsApi";
import { createJobRuntime, startJobRuntime, stopJobRuntime, type JobRuntime } from "../jobs/jobRuntime";
import { createChatRouter, handleChatApiRequest, llmHealthPayload } from "../api/chatApi";
import { createOrgInlineGraphFileSnippetFetcher } from "../api/inlineGraphFileSnippet";
import { getDbPool, closeDbPool } from "../server/db";
import { OrgStore } from "../server/orgStore";
import { handleEnterpriseApiRequest } from "../server/enterpriseApi";
import { handleOrgApiRequest } from "../server/orgApi";
import { createEstateSyncService } from "../server/estateSyncService";
import { UserStore } from "../server/users/userStore";
import { SsoConfigStore } from "../server/sso/ssoConfigStore";
import { AuthPolicyStore } from "../server/sso/authPolicyStore";
import { PostgresSamlRequestStore } from "../server/sso/samlRequestStore";
import { SamlService } from "../server/sso/samlService";
import { AuditLogger } from "../server/audit/auditLogger";
import { UsageTracker } from "../server/usageTracker";
import { createPlanQuotaService } from "../server/planQuota";
import { SourceTurnAuthority } from "../server/sourceTurnAuthority";
import { handleUsageEventsApiRequest } from "../server/usageEventsApi";
import { handleChatThreadsApiRequest } from "../server/chatThreadsApi";
import { handleSamlApiRequest } from "../server/sso/samlApi";
import { loadServerConfig, type ServerConfig } from "../server/serverConfig";
import {
  authUserId,
  requireAuth,
  requireOrgPlan,
  resolveAuthContext,
  resolveAuthContextDetailed,
  writeOrgSuspended
} from "../server/authMiddleware";
import { requireRemoteCodePlan } from "../server/planGates";
import { loadGitHubAppConfig } from "../server/githubAppConfig";
import { createGithubAppService } from "../server/codeHostCredentialResolver";
import type { GitHubAppService } from "../server/githubAppService";
import { handleGitHubAppApiRequest } from "../server/githubAppApi";
import { loadGitHubOAuthConfig } from "../server/githubOAuthConfig";
import { createGitHubOAuthService } from "../server/githubOAuthService";
import { createGitHubOAuthConnector } from "../server/codeHostConnectors/githubOAuthConnector";
import { RoutingGitHubConnector } from "../server/codeHostConnectors/routingGithubConnector";
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
import { loadNotionAppConfig, isNotionOAuthConfig } from "../server/notionAppConfig";
import { createNotionAppService } from "../server/notionAppService";
import { handleNotionAppApiRequest } from "../server/notionAppApi";
import { loadGoogleDocsAppConfig } from "../server/googleDocsAppConfig";
import { createGoogleDocsAppService } from "../server/googleDocsAppService";
import { handleGoogleDocsAppApiRequest } from "../server/googleDocsAppApi";
import { loadTeamsAppConfig } from "../server/teamsAppConfig";
import { createTeamsAppService } from "../server/teamsAppService";
import { handleTeamsAppApiRequest } from "../server/teamsAppApi";
import { resolveAdminPortalUrl } from "../config/publicUrls";
import { resolvePublicBaseUrl } from "../server/publicBaseUrl";
import { IntegrationConnectionStore } from "../server/integrationConnectionStore";
import { IntegrationScopePolicyStore } from "../server/integrationScopePolicyStore";
import { handleIntegrationApiRequest } from "../server/integrationApi";
import { handleAdminApiRequest } from "../server/adminApi";
import { handleOperatorApiRequest } from "../server/operatorApi";
import { loadOperatorAuthConfig } from "../server/operators/operatorAuthConfig";
import { OperatorStore } from "../server/operators/operatorStore";
import { OperatorReadiness } from "../server/operators/readiness";
import { handleBillingApiRequest } from "../server/billing/billingApi";
import { StripeService } from "../server/billing/stripeService";
import { loadBillingConfig } from "../server/billing/billingConfig";
import { EmailService } from "../server/email/emailService";
import { SupportStore } from "../server/support/supportStore";
import { handleSupportSubmission } from "../server/support/supportApi";
import { startSupportNotifications } from "../server/support/supportNotifications";
import { applyCors, loadCorsOrigins } from "../server/cors";
import { loadAuthConfig } from "../server/auth/authConfig";
import { AuthIdentityStore } from "../server/auth/authIdentityStore";
import { AuthTokenStore } from "../server/auth/authTokenStore";
import { GoogleAuthService } from "../server/auth/googleAuthService";
import { handleUserAuthApiRequest } from "../server/auth/userAuthApi";
import { AuthRateLimitStore } from "../server/auth/authRateLimit";
import { initErrorReporter, reportServerError } from "../server/observability/errorReporter";
import { resolveHttpRequestId } from "../server/observability/requestId";

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
  jobStartup?: Promise<void>;
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
  peerAddress?: string;
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function createWebhookServer(options: WebhookServerOptions = {}): Promise<WebhookServerRuntime> {
  initErrorReporter({ service: "api" });
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
  const authIdentityStore = pool ? new AuthIdentityStore(pool) : undefined;
  const authTokenStore = pool ? new AuthTokenStore(pool) : undefined;
  const authConfig = loadAuthConfig();
  const googleAuth =
    authConfig.googleClientId && authConfig.googleClientSecret
      ? new GoogleAuthService({
          clientId: authConfig.googleClientId,
          clientSecret: authConfig.googleClientSecret,
          stateSecret: authConfig.oauthStateSecret
        })
      : undefined;
  if (googleAuth) {
    const clientSuffix = authConfig.googleClientId?.slice(-12) ?? "unknown";
    console.log(
      `[auth] Google sign-in enabled via ${authConfig.googleOAuthCredentialSource ?? "unknown"} ` +
        `(client …${clientSuffix}, callback ${authConfig.publicBaseUrl}/v1/auth/google/callback)`
    );
  } else {
    console.warn(
      "[auth] Google sign-in disabled — set GOOGLE_AUTH_CLIENT_* or GOOGLE_DOCS_APP_CLIENT_* as a matched pair"
    );
  }
  const ssoConfigStore = pool ? new SsoConfigStore(pool) : undefined;
  const authPolicyStore = pool ? new AuthPolicyStore(pool) : undefined;
  const auditLogger = new AuditLogger(pool ?? null);
  const usageTracker = new UsageTracker(pool ?? null);
  const authRateLimitStore = pool ? new AuthRateLimitStore(pool) : undefined;
  const planQuota = createPlanQuotaService(usageTracker);
  const sourceTurnAuthority = pool ? new SourceTurnAuthority(pool) : undefined;
  const operatorStore = pool ? new OperatorStore(pool) : undefined;
  const operatorAuthConfig = loadOperatorAuthConfig();
  if (operatorStore && operatorAuthConfig.googleClientId) {
    console.log(
      `[operator] Google sign-in enabled via ${operatorAuthConfig.googleOAuthCredentialSource ?? "unknown"} ` +
        `(ops portal ${operatorAuthConfig.opsPortalUrl})`
    );
  } else if (operatorStore) {
    console.warn(
      "[operator] Operator API enabled but Google sign-in disabled — set GOOGLE_AUTH_CLIENT_* or COOP_OPERATOR_GOOGLE_*"
    );
  }
  const samlService = serverConfig.ssoBaseUrl && pool
    ? new SamlService({ baseUrl: serverConfig.ssoBaseUrl, spEntityId: serverConfig.ssoSpEntityId,
      requestStore: new PostgresSamlRequestStore(pool) })
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
  const githubAppConnector =
    githubApp && githubAppConfig ? new GitHubConnector(githubApp, githubAppConfig) : undefined;
  const githubOAuthConnector =
    githubOAuth && githubOAuthConfig && orgStore && serverConfig.credentialsEncryptionKey
      ? createGitHubOAuthConnector(
          githubOAuthConfig,
          serverConfig.credentialsEncryptionKey,
          orgStore
        )
      : undefined;
  if (githubAppConnector || githubOAuthConnector) {
    registerConnector(
      new RoutingGitHubConnector({
        appConnector: githubAppConnector,
        oauthConnector: githubOAuthConnector,
        orgStore
      })
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
    notionAppConfig &&
    isNotionOAuthConfig(notionAppConfig) &&
    serverConfig.credentialsEncryptionKey
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
  const inlineGraphFileSnippetFetcher =
    orgStore && serverConfig
      ? createOrgInlineGraphFileSnippetFetcher({ orgStore, serverConfig })
      : undefined;
  const registry = new WebhookRegistry({
    github: new PlaceholderWebhookClient(),
    gitlab: new PlaceholderWebhookClient(),
    bitbucket: new PlaceholderWebhookClient(),
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
  const jobStartup = serverConfig.jobsWorkersEnabled
    ? startJobRuntime(jobs).catch(error => console.error("[jobs] runtime startup failed", error))
    : undefined;

  const queue = {
    enqueue: async (event: NormalizedWebhookEvent) => {
      await consistency.enqueue(event);
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
  const bitbucket = new BitbucketWebhookHandler({
    secret: config.webhooks.bitbucket.secret,
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
  const operatorStripeService = new StripeService(billingConfig);
  const emailService = new EmailService(billingConfig);
  const supportStore = pool ? new SupportStore(pool) : undefined;

  const readiness = new OperatorReadiness({
    databaseUrl: config.cache.connectionString ?? process.env.DATABASE_URL,
    serverConfig, cacheConfig: config.cache, cache, jobs
  });
  const corsOrigins = loadCorsOrigins();

  const server = createServer(async (request, response) => {
    const requestId = resolveHttpRequestId(normalizeHeaders(request.headers));
    response.setHeader("x-request-id", requestId);
    try {
      // This exact diagnostic GET is header-only: generic readBody must not delay
      // authorization/admission behind an unfinished or arbitrarily large body.
      if (request.method === "GET" && new URL(request.url ?? "/", "http://localhost").pathname === "/v1/operator/readiness") {
        if (applyCors(request, response, corsOrigins)) return;
        const headers = normalizeHeaders(request.headers);
        const length = headers["content-length"];
        const unexpectedBody = Boolean(headers["transfer-encoding"]) || (length !== undefined && Number(length) > 0);
        if (unexpectedBody) {
          response.shouldKeepAlive = false;
          response.setHeader("connection", "close");
          response.once("finish", () => request.destroy());
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        request.on("error", cancel); // An unread request disconnect must cancel diagnostics, not crash the server.
        let discardedBytes = 0;
        request.on("data", (chunk: Buffer) => {
          // Discard, never collect; retain the existing body limit while auth is in flight.
          discardedBytes += chunk.length;
          if (discardedBytes > MAX_BODY_BYTES) { cancel(); request.destroy(); }
        });
        request.once("aborted", cancel);
        request.socket.once("close", cancel);
        const incompleteEnd = () => { if (!request.complete) cancel(); };
        request.socket.once("end", incompleteEnd);
        try {
          await readiness.handle(headers, response, unexpectedBody
            ? { oversized: length !== undefined && Number(length) > MAX_BODY_BYTES }
            : undefined, controller.signal);
        } finally {
          request.off("aborted", cancel);
          request.socket.off("close", cancel);
          request.socket.off("end", incompleteEnd);
        }
        return;
      }
      const parsed = await parseRequest(request);
      parsed.headers["x-request-id"] = requestId;
      if (
        parsed.pathname.startsWith("/v1/") ||
        parsed.pathname === "/health" ||
        parsed.pathname === "/webhooks/stripe"
      ) {
        if (applyCors(request, response, corsOrigins)) {
          return;
        }
      }

      const orgParsed = {
        method: parsed.method,
        pathname: parsed.pathname,
        query: parsed.query,
        headers: parsed.headers,
        body: parsed.body
      };

      const { auth, orgSuspended } = await resolveAuthContextDetailed(
        parsed.headers,
        orgStore,
        serverConfig.legacyApiToken,
        serverConfig.requireApiAuth,
        userStore
      );

      if (parsed.method === "GET" && parsed.pathname === "/health") {
        const publicProbe = { ok: true as const, commit: deployedCommitSha() };
        if (!requireAuth(auth, serverConfig.requireApiAuth)) {
          writeJson(response, 200, publicProbe);
          return;
        }
        const jobStats = jobs.monitor.getStats(jobs.queue);
        writeJson(response, 200, {
          ...publicProbe,
          cache: {
            backend: config.cache.backend,
            repos: cache.size()
          },
          webhooks: monitor.getAllHealth(),
          jobs: jobStats,
          llm: llmHealthPayload(chatRouter),
          orgDb: Boolean(orgStore)
        });
        return;
      }

      if (orgSuspended && !parsed.pathname.startsWith("/v1/operator/")) {
        writeOrgSuspended(response);
        return;
      }

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
        await handleUserAuthApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            query: parsed.query,
            headers: parsed.headers,
            peerAddress: parsed.peerAddress,
            body: parsed.body
          },
          response,
          {
            orgStore,
            userStore,
            authIdentityStore,
            authTokenStore,
            emailService,
            googleAuth,
            authConfig,
            auditLogger,
            serverConfig,
            authRateLimitStore,
            pool
          }
        )
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
          { orgStore, userStore, ssoConfigStore, samlService, auditLogger, serverConfig, authConfig }
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
          { orgStore, userStore, serverConfig, usageTracker, planQuota, sourceTurnAuthority }
        )
      ) {
        return;
      }

      if (
        await handleChatThreadsApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            query: parsed.query,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          { orgStore, userStore, serverConfig }
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
          { router: chatRouter, orgStore, serverConfig, userStore, auditLogger, usageTracker, planQuota, sourceTurnAuthority, graphQuery, fetchFileSnippet: inlineGraphFileSnippetFetcher },
          request
        )
      ) {
        return;
      }

      if (
        await handleIntegrationApiRequest(orgParsed, response, {
          pool: pool ?? undefined,
          integrationStore,
          scopePolicyStore,
          orgStore,
          userStore,
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
          { ...orgParsed, rawBody: parsed.rawBody, peerAddress: parsed.peerAddress },
          response,
          { orgStore, userStore, emailService, auditLogger, serverConfig, pool, authIdentityStore, authTokenStore, authConfig, authRateLimitStore }
        )
      ) {
        return;
      }

      if (await handleSupportSubmission(orgParsed, response, supportStore, auth)) return;

      // Operator console routes must run before handleOrgApiRequest (which claims all /v1/*).
      if (
        await handleOperatorApiRequest(orgParsed, response, {
          supportStore,
          orgStore,
          userStore,
          operatorStore,
          authIdentityStore,
          authTokenStore,
          integrationStore,
          serverConfig,
          operatorAuthConfig,
          stripeService: operatorStripeService,
          emailService,
          auditLogger,
          jobQueue: jobs.queue,
          usageTracker
        })
      ) {
        return;
      }

      if (
        await handleAdminApiRequest(orgParsed, response, {
          orgStore,
          userStore,
          authTokenStore,
          integrationStore,
          scopePolicyStore,
          operatorStore,
          serverConfig,
          auditLogger,
          usageTracker,
          atlassianApp,
          notionApp,
          googleDocsApp,
          teamsApp,
          slackApp
        })
      ) {
        return;
      }

      // Enterprise SSO config/policy must run before handleOrgApiRequest:
      // the org handler greedily claims every "/v1/*" path and 404s unknowns.
      if (
        await handleEnterpriseApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers,
            body: parsed.body
          },
          response,
          { orgStore, ssoConfigStore, authPolicyStore, userStore, authTokenStore, serverConfig }
        )
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
        integrationStore,
        scopePolicyStore,
        atlassianApp,
        notionApp,
        googleDocsApp,
        teamsApp,
        slackApp,
        graphCache: cache
      })) {
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
        if (!requireAuth(auth, serverConfig.requireApiAuth)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
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

      if (parsed.method === "POST" && parsed.pathname === "/webhooks/bitbucket") {
        const result = await bitbucket.handle(parsed);
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
        if (!(await requireRemoteCodePlan(orgStore, auth!, response))) {
          return;
        }
        const pool = await getDbPool();
        if (!pool) {
          writeJson(response, 503, { error: "organization database not configured" });
          return;
        }
        const graphResult = await handleGraphHttp({
          pathname: parsed.pathname,
          searchParams: parsed.query,
          orgId: auth!.orgId,
          caller: auth!.userId ? { userId: auth!.userId, enforceUserGrants: true } : undefined,
          pool,
          cache,
          graphQuery,
          onSearch: async (metadata) => {
            await usageTracker.record({
              orgId: auth!.orgId,
              userId: auth!.userId,
              principal: authUserId(auth!),
              eventType: "lightning.search",
              metadata
            });
          }
        });
        writeJson(response, graphResult.statusCode, graphResult.body);
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
          predictions: ["github", "gitlab", "bitbucket", "slack"].map((provider) =>
            rateLimits.prediction(provider as "github" | "gitlab" | "bitbucket" | "slack")
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

      if (parsed.method === "GET" && parsed.pathname === "/") {
        const adminPortal = resolveAdminPortalUrl(process.env, resolvePublicBaseUrl());
        const integrationsUrl = `${adminPortal.replace(/\/$/, "")}/integrations`;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Coop AI API</title></head>` +
            `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5">` +
            `<h1>Coop AI API</h1>` +
            `<p>This host serves the Coop backend (not the admin UI).</p>` +
            `<p>If you were connecting Microsoft Teams, return to ` +
            `<a href="${integrationsUrl}">${integrationsUrl}</a> and click Connect again.</p>` +
            `<p>Azure redirect URI must be exactly ` +
            `<code>https://api.coop-ai.dev/v1/teams/app/callback</code> (not the API root).</p>` +
            `</body></html>`
        );
        return;
      }

      writeJson(response, 404, { error: "not found" });
    } catch (error) {
      const route = (request.url ?? "").split("?")[0];
      if (response.headersSent) {
        reportServerError(error, { requestId, route, service: "api" });
        return;
      }
      writeJson(response, 500, reportServerError(error, { requestId, route, service: "api" }));
    }
  });

  if (supportStore) {
    const stopSupport = startSupportNotifications(supportStore, emailService, operatorAuthConfig.opsPortalUrl,
      process.env.COOP_SUPPORT_NOTIFICATION_EMAIL?.trim() || "support@coop-ai.dev");
    server.on("close", stopSupport);
  }

  server.once("close", () => readiness.close());

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
    jobStartup,
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

const shutdowns = new WeakMap<Server, Promise<boolean>>();

/** A failed drain requires process termination before a replacement may claim work. */
export function stopWebhookServer(runtime: Pick<WebhookServerRuntime, "server" | "jobs" | "jobStartup">): Promise<boolean> {
  const existing = shutdowns.get(runtime.server);
  if (existing) return existing;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  let idleCloser: ReturnType<typeof setInterval> | undefined;
  // close() stops acceptance immediately; admitted HTTP writes finish before cache close.
  const httpClosed = new Promise<boolean>(resolve => {
    runtime.server.close(error => {
      if (idleCloser) clearInterval(idleCloser);
      resolve(!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING");
    });
    runtime.server.closeIdleConnections();
    // An admitted response may become keep-alive idle after close() began.
    // Close only idle connections while that response drains, never its active body.
    idleCloser = setInterval(() => runtime.server.closeIdleConnections(), 20);
  });
  const work = (async () => {
    await runtime.jobStartup;
    if (!await httpClosed || timedOut) return false;
    if (!await stopJobRuntime(runtime.jobs) || timedOut) return false;
    const backend = runtime.jobs.queue.getBackend();
    if ("close" in backend && typeof backend.close === "function") await backend.close();
    if (timedOut) return false;
    await closeDbPool();
    return !timedOut;
  })();
  const shutdown = Promise.race([
    work.catch(() => false),
    new Promise<false>(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        runtime.server.closeAllConnections();
        resolve(false);
      }, runtime.jobs.config.shutdownTimeoutMs ?? 10_000);
    })
  ]).finally(() => {
    clearTimeout(timer);
    if (idleCloser) clearInterval(idleCloser);
  });
  shutdowns.set(runtime.server, shutdown);
  return shutdown;
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
    peerAddress: request.socket.remoteAddress,
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

/** Lets an operator confirm which build answered, instead of guessing at deploy timing. */
function deployedCommitSha(): string {
  const raw =
    process.env.COOP_BUILD_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "";
  return raw.trim().slice(0, 12) || "unknown";
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const requestId = response.getHeader("x-request-id");
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (typeof requestId === "string" && requestId) {
    headers["x-request-id"] = requestId;
  }
  response.writeHead(statusCode, headers);
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

if (require.main === module) {
  void startWebhookServer().then(runtime => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void stopWebhookServer(runtime).then(drained => {
        if (!drained) console.error("[api] shutdown did not drain HTTP/jobs/cache; terminating before replacement may claim work");
        process.exit(drained ? 0 : 1);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }).catch(() => {
    console.error("[api] startup failed");
    process.exit(1);
  });
}
