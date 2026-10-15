import { createServer } from "node:http";
import { loadJobQueueConfig } from "../config/jobQueueConfig";
import { loadWebhookConfig } from "../config/webhookConfig";
import { createGraphCache } from "../cache/graphCachePostgres";
import { GraphConsistencyManager } from "../cache/graphConsistency";
import { createJobRuntime, startJobRuntime, stopJobRuntime } from "./jobRuntime";
import { resumeEmbeddingFailuresForAllOrgs } from "../server/queueOrgRepoIndex";
import { getDbPool, closeDbPool } from "../server/db";
import { OrgStore } from "../server/orgStore";
import { loadServerConfig } from "../server/serverConfig";
import { initErrorReporter } from "../server/observability/errorReporter";
import { loadGitHubAppConfig } from "../server/githubAppConfig";
import { createGithubAppService } from "../server/codeHostCredentialResolver";
import { GitHubConnector } from "../server/codeHostConnectors/githubConnector";
import { loadGitHubOAuthConfig } from "../server/githubOAuthConfig";
import { createGitHubOAuthConnector } from "../server/codeHostConnectors/githubOAuthConnector";
import { RoutingGitHubConnector } from "../server/codeHostConnectors/routingGithubConnector";
import { loadGitLabAppConfig } from "../server/gitlabAppConfig";
import { createGitLabConnector } from "../server/codeHostConnectors/gitlabConnector";
import { loadBitbucketAppConfig } from "../server/bitbucketAppConfig";
import { createBitbucketConnector } from "../server/codeHostConnectors/bitbucketConnector";
import { registerConnector } from "../server/codeHostConnectors/registry";

/** Railway/Docker healthchecks expect HTTP /health — workers are not the API. */
function startWorkerHealthServer(port: number, acceptingWork: () => boolean): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    if (request.url === "/health" || request.url?.startsWith("/health?")) {
      const ok = acceptingWork();
      response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok, role: "worker" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(port, () => {
    console.log(`[workers] health listening on port ${port}`);
  });
  return server;
}

async function main(): Promise<void> {
  initErrorReporter({ service: "worker" });
  const webhookConfig = loadWebhookConfig();
  const jobConfig = loadJobQueueConfig();
  const serverConfig = loadServerConfig();
  const pool = await getDbPool(webhookConfig.cache.connectionString);
  const orgStore =
    pool && serverConfig.credentialsEncryptionKey
      ? new OrgStore(pool, serverConfig.credentialsEncryptionKey)
      : pool
        ? new OrgStore(pool)
        : undefined;

  const githubAppConfig = loadGitHubAppConfig();
  const githubApp =
    githubAppConfig && serverConfig.credentialsEncryptionKey
      ? createGithubAppService(githubAppConfig, serverConfig.credentialsEncryptionKey)
      : undefined;
  const githubOAuthConfig = loadGitHubOAuthConfig();
  const githubAppConnector =
    githubApp && githubAppConfig ? new GitHubConnector(githubApp, githubAppConfig) : undefined;
  const githubOAuthConnector =
    githubOAuthConfig && orgStore && serverConfig.credentialsEncryptionKey
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

  const gitlabAppConfig = loadGitLabAppConfig();
  if (gitlabAppConfig && orgStore && serverConfig.credentialsEncryptionKey) {
    registerConnector(
      createGitLabConnector(gitlabAppConfig, serverConfig.credentialsEncryptionKey, orgStore)
    );
  }

  const bitbucketAppConfig = loadBitbucketAppConfig();
  if (bitbucketAppConfig && orgStore && serverConfig.credentialsEncryptionKey) {
    registerConnector(
      createBitbucketConnector(bitbucketAppConfig, serverConfig.credentialsEncryptionKey, orgStore)
    );
  }

  const cache = await createGraphCache(webhookConfig.cache.backend, {
    ttlMs: webhookConfig.cache.ttl * 1000,
    maxRepos: webhookConfig.cache.maxRepos,
    pool,
    connectionString: webhookConfig.cache.connectionString
  });
  const consistency = new GraphConsistencyManager(cache);
  const runtime = createJobRuntime({
    config: jobConfig,
    cache,
    consistency,
    orgStore,
    allowPatFallback: serverConfig.devMode
  });

  await startJobRuntime(runtime);

  if (pool && orgStore) {
    void resumeEmbeddingFailuresForAllOrgs({
      pool,
      orgStore,
      jobQueue: runtime.queue
    }).then((result) => {
      if (result.queued > 0) {
        console.log(
          `[jobs] resumed ${result.queued} repo(s) with failed embeddings (${result.skipped} skipped)`
        );
      }
    });
  }

  if (pool) {
    if (!serverConfig.credentialsEncryptionKey) {
      console.warn(
        "[workers] CREDENTIALS_ENCRYPTION_KEY is missing — private repo clones will fail (copy from Coop-AI)"
      );
    }
    if (!githubApp) {
      console.warn(
        "[workers] GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not configured — cannot refresh GitHub tokens (copy from Coop-AI)"
      );
    }
  }

  const healthPort = Number(process.env.PORT ?? 8787);
  const healthServer = startWorkerHealthServer(
    Number.isFinite(healthPort) && healthPort > 0 ? healthPort : 8787,
    () => runtime.workers.acceptingWork
  );

  console.log("[workers] CoopAI job workers started");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const drained = await stopJobRuntime(runtime);
    if (!drained) {
      console.error('[workers] shutdown did not drain admitted work/cache persistence; terminating before replacement may claim work');
      process.exit(1);
    }
    healthServer.closeAllConnections();
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    const backend = runtime.queue.getBackend();
    if ('close' in backend && typeof backend.close === 'function') await backend.close();
    await closeDbPool();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
