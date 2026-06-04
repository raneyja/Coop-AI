import type { OrgStore } from "../orgStore";
import type { BitbucketAppService } from "../bitbucketAppService";
import type { BitbucketAppConfig } from "../bitbucketAppConfig";
import { createBitbucketAppService } from "../bitbucketAppService";
import type { CodeHostConnector, TokenRefreshResult } from "./types";

/**
 * CodeHostConnector for Bitbucket OAuth 2.0 installations.
 *
 * Refresh-token storage: refresh tokens are stored in org_credentials with
 * provider key "bitbucket:refresh" so access-token expiry can be handled
 * without a new user authorization flow.
 *
 * Installation ID: Bitbucket OAuth has no native installation concept.  We
 * store a deterministic synthetic ID (bitbucketSyntheticInstallationId).
 */
export class BitbucketConnector implements CodeHostConnector {
  public readonly provider = "bitbucket" as const;

  public constructor(
    private readonly service: BitbucketAppService,
    private readonly orgStore: OrgStore,
    private readonly config: BitbucketAppConfig
  ) {}

  public buildInstallUrl(orgId: string): string {
    const redirectUri = `${this.config.publicBaseUrl}/v1/bitbucket/app/callback`;
    return this.service.buildAuthorizeUrl(redirectUri, orgId);
  }

  public async refreshInstallationToken(installationId: number): Promise<TokenRefreshResult> {
    const orgId = await this.orgStore.findOrgIdByInstallation(installationId, "bitbucket");
    if (!orgId) {
      throw new Error(
        `No Bitbucket installation found for installationId ${installationId}. Re-authorize the Bitbucket App in CoopAI settings.`
      );
    }

    const refreshToken = await this.orgStore.getCredential(orgId, "bitbucket:refresh");
    if (!refreshToken) {
      throw new Error(
        "Bitbucket refresh token not found. Re-authorize the Bitbucket App in CoopAI settings."
      );
    }

    const result = await this.service.refreshAccessToken(refreshToken);

    if (result.refreshToken) {
      await this.orgStore.storeCredential(orgId, "bitbucket:refresh", result.refreshToken);
    }

    return { token: result.accessToken, expiresAt: result.expiresAt };
  }
}

export function createBitbucketConnector(
  config: BitbucketAppConfig,
  stateSecret: string,
  orgStore: OrgStore
): BitbucketConnector {
  const service = createBitbucketAppService(config.clientId, config.clientSecret, stateSecret);
  return new BitbucketConnector(service, orgStore, config);
}
