import type { Pool } from "pg";

export type OrgAuthPolicy = {
  orgId: string;
  requireSso: boolean;
  allowPassword: boolean;
  allowGoogle: boolean;
  updatedAt: Date;
};

export type OrgAuthPolicyInput = {
  requireSso?: boolean;
  allowPassword?: boolean;
  allowGoogle?: boolean;
};

const DEFAULT_POLICY: Omit<OrgAuthPolicy, "orgId" | "updatedAt"> = {
  requireSso: false,
  allowPassword: true,
  allowGoogle: true
};

/**
 * Per-org sign-in policy for Enterprise SSO enforcement.
 * When requireSso is true, password and Google sign-in are blocked at login time.
 */
export class AuthPolicyStore {
  public constructor(private readonly pool: Pool) {}

  public async getPolicy(orgId: string): Promise<OrgAuthPolicy> {
    const result = await this.pool.query(
      `SELECT org_id, require_sso, allow_password, allow_google, updated_at
       FROM org_auth_policy WHERE org_id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    if (!row) {
      return { orgId, ...DEFAULT_POLICY, updatedAt: new Date() };
    }
    return rowToPolicy(row);
  }

  public async upsertPolicy(orgId: string, input: OrgAuthPolicyInput): Promise<OrgAuthPolicy> {
    const current = await this.getPolicy(orgId);
    const requireSso = input.requireSso ?? current.requireSso;
    let allowPassword = input.allowPassword ?? current.allowPassword;
    let allowGoogle = input.allowGoogle ?? current.allowGoogle;

    if (requireSso) {
      allowPassword = false;
      allowGoogle = false;
    }

    const result = await this.pool.query(
      `INSERT INTO org_auth_policy (org_id, require_sso, allow_password, allow_google, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         require_sso = EXCLUDED.require_sso,
         allow_password = EXCLUDED.allow_password,
         allow_google = EXCLUDED.allow_google,
         updated_at = NOW()
       RETURNING org_id, require_sso, allow_password, allow_google, updated_at`,
      [orgId, requireSso, allowPassword, allowGoogle]
    );
    return rowToPolicy(result.rows[0]);
  }
}

function rowToPolicy(row: Record<string, unknown>): OrgAuthPolicy {
  return {
    orgId: String(row.org_id),
    requireSso: Boolean(row.require_sso),
    allowPassword: row.allow_password !== false,
    allowGoogle: row.allow_google !== false,
    updatedAt: new Date(String(row.updated_at))
  };
}
