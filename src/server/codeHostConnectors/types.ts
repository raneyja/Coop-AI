import type { CodeHostProvider } from "../../api/codeHosts/types";

export type TokenRefreshResult = {
  token: string;
  expiresAt: Date;
};

/**
 * Result returned by a connector's OAuth callback handler before the caller
 * persists the record via OrgStore.upsertCodeHostInstallation.
 */
export type ConnectorInstallCallbackResult = {
  orgId: string;
  installationId: number;
  token: string;
  expiresAt: Date;
};

/**
 * Implemented once per code host.  Adding a fourth host requires only a new
 * class that satisfies this interface plus wiring in the registry — no pipeline
 * changes required.
 */
export interface CodeHostConnector {
  readonly provider: CodeHostProvider;

  /**
   * Returns the URL the user should be redirected to in order to authorise
   * the app installation.  The connector embeds a signed state token so the
   * callback can verify the originating org.
   */
  buildInstallUrl(orgId: string): string;

  /**
   * Exchanges or refreshes an existing installation for a fresh access token.
   * Called by resolveCodeHostTokenForOrg when the stored token is near expiry.
   * The connector is responsible for any OAuth refresh-token round-trip.
   */
  refreshInstallationToken(installationId: number): Promise<TokenRefreshResult>;
}
