import type { Pool } from "pg";

export type SsoProvider = "okta" | "azuread" | "saml";

export type OrgSsoConfig = {
  orgId: string;
  provider: SsoProvider;
  idpEntityId: string;
  idpSsoUrl: string;
  idpX509Cert: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type OrgSsoConfigInput = {
  provider: SsoProvider;
  idpEntityId: string;
  idpSsoUrl: string;
  idpX509Cert: string;
  enabled?: boolean;
};

/**
 * Per-org SAML 2.0 IdP configuration (Okta / Azure AD / generic SAML).
 * Enterprise-only — the API layer gates writes/reads behind requireOrgPlan,
 * this store has no opinion on plan.
 */
export class SsoConfigStore {
  public constructor(private readonly pool: Pool) {}

  public async getConfig(orgId: string): Promise<OrgSsoConfig | undefined> {
    const result = await this.pool.query(
      `SELECT org_id, provider, idp_entity_id, idp_sso_url, idp_x509_cert, enabled, created_at, updated_at
       FROM org_sso_config WHERE org_id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    return row ? rowToConfig(row) : undefined;
  }

  /** Returns the config only when SSO is configured AND enabled for the org. */
  public async getEnabledConfig(orgId: string): Promise<OrgSsoConfig | undefined> {
    const config = await this.getConfig(orgId);
    return config?.enabled ? config : undefined;
  }

  public async upsertConfig(orgId: string, input: OrgSsoConfigInput): Promise<OrgSsoConfig> {
    const result = await this.pool.query(
      `INSERT INTO org_sso_config
         (org_id, provider, idp_entity_id, idp_sso_url, idp_x509_cert, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         idp_entity_id = EXCLUDED.idp_entity_id,
         idp_sso_url = EXCLUDED.idp_sso_url,
         idp_x509_cert = EXCLUDED.idp_x509_cert,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING org_id, provider, idp_entity_id, idp_sso_url, idp_x509_cert, enabled, created_at, updated_at`,
      [orgId, input.provider, input.idpEntityId, input.idpSsoUrl, input.idpX509Cert, input.enabled ?? true]
    );
    return rowToConfig(result.rows[0]);
  }

  public async setEnabled(orgId: string, enabled: boolean): Promise<OrgSsoConfig | undefined> {
    const result = await this.pool.query(
      `UPDATE org_sso_config SET enabled = $2, updated_at = NOW()
       WHERE org_id = $1
       RETURNING org_id, provider, idp_entity_id, idp_sso_url, idp_x509_cert, enabled, created_at, updated_at`,
      [orgId, enabled]
    );
    const row = result.rows[0];
    return row ? rowToConfig(row) : undefined;
  }

  public async deleteConfig(orgId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM org_sso_config WHERE org_id = $1`, [orgId]);
    return (result.rowCount ?? 0) > 0;
  }
}

function rowToConfig(row: Record<string, unknown>): OrgSsoConfig {
  return {
    orgId: String(row.org_id),
    provider: String(row.provider) as SsoProvider,
    idpEntityId: String(row.idp_entity_id),
    idpSsoUrl: String(row.idp_sso_url),
    idpX509Cert: String(row.idp_x509_cert),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at))
  };
}
