import { createHash } from "node:crypto";
import type { OrgStore } from "../orgStore";
import type { GitHubOAuthService } from "../githubOAuthService";
import type { GitHubOAuthConfig } from "../githubOAuthConfig";
import { createGitHubOAuthService } from "../githubOAuthService";
import type { CodeHostConnector, TokenRefreshResult } from "./types";

export class GitHubOAuthConnector implements CodeHostConnector {
  public readonly provider = "github" as const;

  public constructor(
    private readonly service: GitHubOAuthService,
    private readonly orgStore: OrgStore,
    private readonly config: GitHubOAuthConfig
  ) {}

  public buildInstallUrl(orgId: string): string {
    const redirectUri = `${this.config.publicBaseUrl}/v1/github/app/callback`;
    return this.service.buildAuthorizeUrl(redirectUri, orgId);
  }

  public async refreshInstallationToken(installationId: number): Promise<TokenRefreshResult> {
    const orgId = await this.orgStore.findOrgIdByInstallation(installationId, "github");
    if (!orgId) {
      throw new Error(
        `No GitHub connection found for installationId ${installationId}. Re-authorize GitHub in Coop AI settings.`
      );
    }

    const refreshToken = await this.orgStore.getCredential(orgId, "github:refresh");
    if (!refreshToken) {
      throw new Error("GitHub refresh token not found. Re-authorize GitHub in Coop AI settings.");
    }

    const result = await this.service.refreshAccessToken(refreshToken);
    if (result.refreshToken) {
      await this.orgStore.storeCredential(orgId, "github:refresh", result.refreshToken);
    }

    return { token: result.accessToken, expiresAt: result.expiresAt };
  }
}

export function githubOAuthSyntheticInstallationId(orgId: string): number {
  const hash = createHash("sha256").update(`github-oauth:${orgId}`).digest("hex");
  return parseInt(hash.slice(0, 11), 16);
}

export function isGithubOAuthInstallation(orgId: string, installationId: number): boolean {
  return installationId === githubOAuthSyntheticInstallationId(orgId);
}

export function createGitHubOAuthConnector(
  config: GitHubOAuthConfig,
  stateSecret: string,
  orgStore: OrgStore
): GitHubOAuthConnector {
  const service = createGitHubOAuthService(config.clientId, config.clientSecret, stateSecret);
  return new GitHubOAuthConnector(service, orgStore, config);
}
