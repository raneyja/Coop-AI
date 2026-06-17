import type { OrgStore } from "./orgStore";
import { GitHubAppService } from "./githubAppService";
import type { GitHubAppConfig } from "./githubAppConfig";
import type { CodeHostConnector } from "./codeHostConnectors/types";
import type { CodeHostProvider } from "../api/codeHosts/types";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type GithubConnectionStatus = {
  installed: boolean;
  tokenValid: boolean;
  needsReconnect: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt?: Date;
};

/** Whether the org has a usable GitHub token (live access token or refresh token). */
export async function assessGithubConnection(
  orgStore: OrgStore,
  orgId: string
): Promise<GithubConnectionStatus> {
  const installation = await orgStore.getCodeHostInstallation(orgId, "github");
  if (!installation) {
    return {
      installed: false,
      tokenValid: false,
      needsReconnect: false,
      hasRefreshToken: false
    };
  }

  const hasRefreshToken = Boolean(await orgStore.getCredential(orgId, "github:refresh"));
  const accessValid =
    installation.tokenExpiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS;
  const tokenValid = accessValid || hasRefreshToken;

  return {
    installed: true,
    tokenValid,
    needsReconnect: !tokenValid,
    hasRefreshToken,
    tokenExpiresAt: installation.tokenExpiresAt
  };
}

export type CodeHostCredentialResolverDeps = {
  orgStore: OrgStore;
  githubApp?: GitHubAppService;
  allowPatFallback: boolean;
};

export type GenericCredentialResolverDeps = {
  orgStore: OrgStore;
  /** Connector for the target provider — used to refresh expired tokens.
   *  When undefined the resolver can only return a live cached token or a PAT. */
  connector?: CodeHostConnector;
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

/**
 * Provider-agnostic token resolver.  Follows the same priority order as
 * resolveGithubTokenForOrg but works for any provider stored in
 * code_host_installations:
 *
 *   1. Valid cached installation token (not near expiry) → return immediately.
 *   2. Near-expiry or missing token but connector present → refresh and store.
 *   3. No installation record and allowPatFallback → read from org_credentials.
 *   4. Otherwise → undefined (caller should surface an auth error).
 */
export async function resolveCodeHostTokenForOrg(
  orgId: string,
  provider: CodeHostProvider,
  deps: GenericCredentialResolverDeps
): Promise<string | undefined> {
  const installation = await deps.orgStore.getCodeHostInstallation(orgId, provider);
  if (installation) {
    const expiresAt = installation.tokenExpiresAt.getTime();
    if (expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      const token = await deps.orgStore.getInstallationToken(orgId, provider);
      if (token) {
        return token;
      }
    }
    if (deps.connector) {
      try {
        const refreshed = await deps.connector.refreshInstallationToken(installation.installationId);
        await deps.orgStore.upsertCodeHostInstallation(
          orgId,
          provider,
          installation.installationId,
          refreshed.token,
          refreshed.expiresAt
        );
        return refreshed.token;
      } catch {
        // Refresh failed (missing refresh token, revoked access, etc.).
        // Use the cached token if it has not expired yet.
        if (expiresAt > Date.now()) {
          const cached = await deps.orgStore.getInstallationToken(orgId, provider);
          if (cached) {
            return cached;
          }
        }
      }
    }
  }

  if (!deps.allowPatFallback) {
    return undefined;
  }
  return deps.orgStore.getCredential(orgId, provider);
}
