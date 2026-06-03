import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { URL } from "node:url";
import { GraphQueryApi, GraphQueryName } from "../api/graphQuery";
import { lightningSearch, type LightningSearchResult } from "../indexing/lightningSearch";
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
import { loadServerConfig, type ServerConfig } from "../server/serverConfig";
import { requireAuth, requireOrgPlan, resolveAuthContext } from "../server/authMiddleware";
import { loadGitHubAppConfig } from "../server/githubAppConfig";
import { createGithubAppService } from "../server/codeHostCredentialResolver";
import type { GitHubAppService } from "../server/githubAppService";
import { handleGitHubAppApiRequest } from "../server/githubAppApi";

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

  const githubAppConfig = loadGitHubAppConfig();
  const githubApp =
    githubAppConfig && serverConfig.credentialsEncryptionKey
      ? createGithubAppService(githubAppConfig, serverConfig.credentialsEncryptionKey)
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
      githubApp,
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

  const github = new GitHubWebhookHandler({
    secret: config.webhooks.github.secret ?? githubAppConfig?.webhookSecret,
    monitor,
    queue,
    orgStore,
    githubApp
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

  const server = createServer(async (request, response) => {
    try {
      const parsed = await parseRequest(request);
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
        serverConfig.requireApiAuth
      );

      if (
        await handleGitHubAppApiRequest(orgParsed, response, {
          orgStore,
          githubApp,
          githubAppConfig
        }, auth)
      ) {
        return;
      }

      if (await handleOrgApiRequest(orgParsed, response, {
        orgStore,
        jobQueue: jobs.queue,
        serverConfig,
        githubApp
      })) {
        return;
      }

      if (
        await handleEnterpriseApiRequest(
          {
            method: parsed.method,
            pathname: parsed.pathname,
            headers: parsed.headers
          },
          response,
          { orgStore, serverConfig }
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
          { router: chatRouter, orgStore, serverConfig },
          request
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
            serverConfig
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
          serverConfig.requireApiAuth
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
          days: numberParam(parsed.query.get("days")),
          forceRefresh: parsed.query.get("forceRefresh") === "true"
        };
        let result: unknown;
        if (query === "searchFiles" && filters.pattern) {
          const pool = await getDbPool();
          if (pool) {
            const lightning = filters.collectionId
              ? await lightningSearch(pool, auth!.orgId, {
                  collectionId: filters.collectionId,
                  pattern: filters.pattern
                })
              : await lightningSearch(pool, auth!.orgId, repoId, filters.pattern);
            if (lightning.hits.length > 0 || lightning.symbols.length > 0) {
              result = formatLightningSearchResult(
                filters.collectionId ? undefined : repoId,
                lightning,
                filters.collectionId
              );
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
          serverConfig.requireApiAuth
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
          serverConfig.requireApiAuth
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
    githubAppConfig
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
