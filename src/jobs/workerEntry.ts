import { loadJobQueueConfig } from "../config/jobQueueConfig";
import { loadWebhookConfig } from "../config/webhookConfig";
import { createGraphCache } from "../cache/graphCachePostgres";
import { GraphConsistencyManager } from "../cache/graphConsistency";
import { createJobRuntime, startJobRuntime, stopJobRuntime } from "./jobRuntime";
import { getDbPool, closeDbPool } from "../server/db";
import { OrgStore } from "../server/orgStore";
import { loadServerConfig } from "../server/serverConfig";
import { loadGitHubAppConfig } from "../server/githubAppConfig";
import { createGithubAppService } from "../server/codeHostCredentialResolver";
import { GitHubConnector } from "../server/codeHostConnectors/githubConnector";
import { loadGitLabAppConfig } from "../server/gitlabAppConfig";
import { createGitLabConnector } from "../server/codeHostConnectors/gitlabConnector";
import { loadBitbucketAppConfig } from "../server/bitbucketAppConfig";
import { createBitbucketConnector } from "../server/codeHostConnectors/bitbucketConnector";
import { registerConnector } from "../server/codeHostConnectors/registry";

async function main(): Promise<void> {
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
  if (githubApp && githubAppConfig) {
    registerConnector(new GitHubConnector(githubApp, githubAppConfig));
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

  startJobRuntime(runtime);
  console.log("[workers] CoopAI job workers started");

  const shutdown = async () => {
    stopJobRuntime(runtime);
    await closeDbPool();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
