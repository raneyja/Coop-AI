import type { GitHubAppService } from "../githubAppService";
import type { GitHubAppConfig } from "../githubAppConfig";
import type { CodeHostConnector, TokenRefreshResult } from "./types";

/**
 * Wraps the Session 4 GitHubAppService as a CodeHostConnector.
 * No GitHub App flow changes — this is purely a delegation shim.
 */
export class GitHubConnector implements CodeHostConnector {
  public readonly provider = "github" as const;

  public constructor(
    private readonly app: GitHubAppService,
    private readonly config: GitHubAppConfig
  ) {}

  public buildInstallUrl(orgId: string): string {
    return this.app.buildInstallUrl(this.config.slug, orgId);
  }

  public async refreshInstallationToken(installationId: number): Promise<TokenRefreshResult> {
    const result = await this.app.createInstallationAccessToken(installationId);
    return { token: result.token, expiresAt: result.expiresAt };
  }
}
