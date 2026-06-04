import type { OrgStore } from "../orgStore";
import type { GitLabAppService } from "../gitlabAppService";
import type { GitLabAppConfig } from "../gitlabAppConfig";
import { createGitLabAppService } from "../gitlabAppService";
import type { CodeHostConnector, TokenRefreshResult } from "./types";

/**
 * CodeHostConnector for GitLab OAuth App installations.
 *
 * Refresh-token storage: GitLab issues a refresh token alongside the access
 * token.  We store the refresh token in org_credentials with provider key
 * "gitlab:refresh" so it survives access-token expiry without requiring a
 * new user authorization flow.
 *
 * Installation ID: GitLab has no native installation concept.  We store a
 * deterministic synthetic ID (gitlabSyntheticInstallationId) so the
 * code_host_installations record can be looked up bidirectionally.
 */
export class GitLabConnector implements CodeHostConnector {
  public readonly provider = "gitlab" as const;

  public constructor(
    private readonly service: GitLabAppService,
    private readonly orgStore: OrgStore,
    private readonly config: GitLabAppConfig
  ) {}

  public buildInstallUrl(orgId: string): string {
    const redirectUri = `${this.config.publicBaseUrl}/v1/gitlab/app/callback`;
    return this.service.buildAuthorizeUrl(redirectUri, orgId);
  }

  /**
   * Refreshes the GitLab access token using the stored refresh token.
   *
   * The installationId is used to look up the owning orgId so the connector
   * can retrieve the per-org refresh token from org_credentials — this avoids
   * adding orgId to the CodeHostConnector interface while keeping the operation
   * fully self-contained.
   */
  public async refreshInstallationToken(installationId: number): Promise<TokenRefreshResult> {
    const orgId = await this.orgStore.findOrgIdByInstallation(installationId, "gitlab");
    if (!orgId) {
      throw new Error(
        `No GitLab installation found for installationId ${installationId}. Re-authorize the GitLab App in CoopAI settings.`
      );
    }

    const refreshToken = await this.orgStore.getCredential(orgId, "gitlab:refresh");
    if (!refreshToken) {
      throw new Error(
        "GitLab refresh token not found. Re-authorize the GitLab App in CoopAI settings."
      );
    }

    const result = await this.service.refreshAccessToken(refreshToken);

    // GitLab may rotate the refresh token on each exchange; persist if provided.
    if (result.refreshToken) {
      await this.orgStore.storeCredential(orgId, "gitlab:refresh", result.refreshToken);
    }

    return { token: result.accessToken, expiresAt: result.expiresAt };
  }
}

/**
 * Factory that constructs a GitLabAppService and GitLabConnector together.
 * Pass serverConfig.credentialsEncryptionKey as stateSecret.
 */
export function createGitLabConnector(
  config: GitLabAppConfig,
  stateSecret: string,
  orgStore: OrgStore
): GitLabConnector {
  const service = createGitLabAppService(
    config.clientId,
    config.clientSecret,
    config.gitlabBaseUrl,
    stateSecret
  );
  return new GitLabConnector(service, orgStore, config);
}
