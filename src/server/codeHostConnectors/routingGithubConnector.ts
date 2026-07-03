import type { OrgStore } from "../orgStore";
import type { CodeHostConnector, TokenRefreshResult } from "./types";
import { GitHubConnector } from "./githubConnector";
import { GitHubOAuthConnector, isGithubOAuthInstallation } from "./githubOAuthConnector";

export type RoutingGitHubConnectorDeps = {
  appConnector?: GitHubConnector;
  oauthConnector?: GitHubOAuthConnector;
  orgStore?: OrgStore;
};

/**
 * Delegates GitHub token refresh to the OAuth or App connector based on whether
 * the stored installationId is the OAuth synthetic ID for the org.
 */
export class RoutingGitHubConnector implements CodeHostConnector {
  public readonly provider = "github" as const;

  public constructor(private readonly deps: RoutingGitHubConnectorDeps) {}

  public buildInstallUrl(orgId: string): string {
    if (this.deps.appConnector) {
      return this.deps.appConnector.buildInstallUrl(orgId);
    }
    if (!this.deps.oauthConnector) {
      throw new Error("No GitHub connector configured");
    }
    return this.deps.oauthConnector.buildInstallUrl(orgId);
  }

  public async refreshInstallationToken(installationId: number): Promise<TokenRefreshResult> {
    const orgId = this.deps.orgStore
      ? await this.deps.orgStore.findOrgIdByInstallation(installationId, "github")
      : undefined;

    if (orgId && isGithubOAuthInstallation(orgId, installationId)) {
      if (!this.deps.oauthConnector) {
        throw new Error("GitHub OAuth connector not configured");
      }
      return this.deps.oauthConnector.refreshInstallationToken(installationId);
    }

    if (this.deps.appConnector) {
      return this.deps.appConnector.refreshInstallationToken(installationId);
    }

    if (this.deps.oauthConnector) {
      return this.deps.oauthConnector.refreshInstallationToken(installationId);
    }

    throw new Error("No GitHub connector configured");
  }
}
