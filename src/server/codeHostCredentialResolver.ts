import type { OrgStore } from "./orgStore";
import { GitHubAppService } from "./githubAppService";
import type { GitHubAppConfig } from "./githubAppConfig";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type CodeHostCredentialResolverDeps = {
  orgStore: OrgStore;
  githubApp?: GitHubAppService;
  allowPatFallback: boolean;
};

/**
 * Resolves a GitHub access token for an org: installation token first, PAT only when allowed (devMode).
 */
export async function resolveGithubTokenForOrg(
  orgId: string,
  deps: CodeHostCredentialResolverDeps
): Promise<string | undefined> {
  const installation = await deps.orgStore.getCodeHostInstallation(orgId, "github");
  if (installation) {
    const expiresAt = installation.tokenExpiresAt.getTime();
    if (expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      const token = await deps.orgStore.getInstallationToken(orgId, "github");
      if (token) {
        return token;
      }
    }
    if (deps.githubApp) {
      const refreshed = await deps.githubApp.createInstallationAccessToken(installation.installationId);
      await deps.orgStore.upsertCodeHostInstallation(
        orgId,
        "github",
        installation.installationId,
        refreshed.token,
        refreshed.expiresAt
      );
      return refreshed.token;
    }
  }

  if (!deps.allowPatFallback) {
    return undefined;
  }
  return deps.orgStore.getCredential(orgId, "github");
}

export function createGithubAppService(
  config: GitHubAppConfig,
  credentialsEncryptionKey: string
): GitHubAppService {
  return new GitHubAppService({
    appId: config.appId,
    privateKeyPem: config.privateKeyPem,
    stateSecret: credentialsEncryptionKey
  });
}
