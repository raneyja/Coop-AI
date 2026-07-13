import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  generateApiKey,
  hashApiKey
} from "./credentialCrypto";
import { clampSeatCountForPlan } from "./planGates";
import type { OrgRepoAccessMode } from "./repoAccessTypes";
import { parseOrgRepoAccessMode } from "./repoAccessTypes";

export type OrgPlan = "free" | "pro" | "enterprise";
export type IndexStatus = "idle" | "queued" | "indexing" | "cloning" | "ready" | "error" | "disabled";

export type Organization = {
  id: string;
  name: string;
  plan: OrgPlan;
  repoAccessMode: OrgRepoAccessMode;
  createdAt: Date;
};

export type OrgBilling = {
  billingEmail?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  seatCount: number;
  billingStatus: string;
  onboardingCompletedAt?: Date;
};

export type ApiKeyRecord = {
  id: string;
  orgId: string;
  label: string;
  createdAt: Date;
};

export type ApiKeyListItem = {
  id: string;
  label: string;
  createdAt: Date;
  /** Populated when api_keys.last_used_at is tracked; otherwise undefined. */
  lastUsed?: Date;
};

export type EmbeddingStatus = "complete" | "failed" | "skipped" | "pending";

export type OrgRepoRecord = {
  orgId: string;
  repoId: string;
  lightningEnabled: boolean;
  indexStatus: IndexStatus;
  embeddingStatus?: EmbeddingStatus;
  lastIndexedAt?: Date;
  lastJobId?: string;
  error?: string;
  embeddingError?: string;
  updatedAt: Date;
};

export type CodeHostInstallationRecord = {
  orgId: string;
  provider: string;
  installationId: number;
  tokenExpiresAt: Date;
  createdAt: Date;
};

export type AuthContext = {
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  apiKeyId: string;
  /** Human user id — set for session-based auth; undefined for org API keys. */
  userId?: string;
  /** User role from the session (e.g. 'owner' | 'admin' | 'member'). */
  role?: string;
  /** How the session was created: password, google, or saml. */
  sessionProvider?: "password" | "google" | "saml";
  /** User email when authenticated via session. */
  email?: string;
};

export type OrgOperatorProvenance =
  | "unknown"
  | "stripe_checkout"
  | "free_signup"
  | "manual_enterprise"
  | "manual_pro";

export type OrgOperatorStatus = "active" | "suspended";

export type OrgOperatorMetadata = {
  operatorStatus: OrgOperatorStatus;
  crmExternalId?: string | null;
  operatorNotes?: string | null;
  suspendedAt?: Date | null;
  suspendedReason?: string | null;
  provenance: OrgOperatorProvenance;
  assigneeOperatorId?: string | null;
};

export type OperatorOrganizationListItem = {
  id: string;
  name: string;
  plan: OrgPlan;
  createdAt: Date;
  billingStatus?: string;
  billingEmail?: string;
  adminEmail?: string;
  seatCount?: number;
  stripeCustomerId?: string;
  operatorStatus?: OrgOperatorStatus;
  provenance?: OrgOperatorProvenance;
};

export class OrgStore {
  public constructor(
    private readonly pool: Pool,
    private readonly credentialsEncryptionKey?: string
  ) {}

  public async createOrganization(name: string, plan: OrgPlan = "free"): Promise<Organization> {
    const result = await this.pool.query(
      `INSERT INTO organizations (name, plan) VALUES ($1, $2)
       RETURNING id, name, plan, created_at`,
      [name, plan]
    );
    return rowToOrg(result.rows[0]);
  }

  public async getOrganization(orgId: string): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `SELECT id, name, plan, repo_access_mode, created_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async findOrganizationByName(name: string): Promise<Organization | undefined> {
    const trimmed = name.trim();
    if (!trimmed) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT id, name, plan, repo_access_mode, created_at FROM organizations WHERE lower(name) = lower($1) LIMIT 2`,
      [trimmed]
    );
    if (result.rows.length !== 1) {
      return undefined;
    }
    return rowToOrg(result.rows[0]);
  }

  public async updateRepoAccessMode(orgId: string, mode: OrgRepoAccessMode): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `UPDATE organizations SET repo_access_mode = $2 WHERE id = $1
       RETURNING id, name, plan, repo_access_mode, created_at`,
      [orgId, mode]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async setOrganizationPlan(orgId: string, plan: OrgPlan): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `UPDATE organizations SET plan = $2 WHERE id = $1
       RETURNING id, name, plan, repo_access_mode, created_at`,
      [orgId, plan]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async createApiKey(orgId: string, label = "default"): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const result = await this.pool.query(
      `INSERT INTO api_keys (org_id, key_hash, label) VALUES ($1, $2, $3)
       RETURNING id, org_id, label, created_at`,
      [orgId, keyHash, label]
    );
    return {
      record: rowToApiKey(result.rows[0]),
      rawKey
    };
  }

  public async listApiKeys(orgId: string): Promise<ApiKeyListItem[]> {
    const result = await this.pool.query(
      `SELECT id, label, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows.map(rowToApiKeyListItem);
  }

  public async revokeApiKey(orgId: string, keyId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM api_keys WHERE id = $1 AND org_id = $2`, [
      keyId,
      orgId
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  public async resolveAuth(rawKey: string): Promise<AuthContext | undefined> {
    const normalized = rawKey.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (!normalized) {
      return undefined;
    }
    const keyHash = hashApiKey(normalized);
    const result = await this.pool.query(
      `SELECT k.id AS key_id, o.id AS org_id, o.name AS org_name, o.plan
       FROM api_keys k
       JOIN organizations o ON o.id = k.org_id
       WHERE k.key_hash = $1`,
      [keyHash]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      orgId: String(row.org_id),
      orgName: String(row.org_name),
      plan: String(row.plan) as OrgPlan,
      apiKeyId: String(row.key_id)
    };
  }

  public async storeCredential(orgId: string, provider: string, token: string): Promise<void> {
    if (!this.credentialsEncryptionKey) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const encrypted = encryptCredential(token.trim(), this.credentialsEncryptionKey);
    await this.pool.query(
      `INSERT INTO org_credentials (org_id, provider, encrypted_token, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, provider) DO UPDATE SET
         encrypted_token = EXCLUDED.encrypted_token,
         updated_at = NOW()`,
      [orgId, provider, encrypted]
    );
  }

  public async getCredential(orgId: string, provider: string): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT encrypted_token FROM org_credentials WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row?.encrypted_token) {
      return undefined;
    }
    return decryptCredential(String(row.encrypted_token), this.credentialsEncryptionKey);
  }

  public async upsertCodeHostInstallation(
    orgId: string,
    provider: string,
    installationId: number,
    token: string,
    tokenExpiresAt: Date
  ): Promise<void> {
    if (!this.credentialsEncryptionKey) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const encrypted = encryptCredential(token.trim(), this.credentialsEncryptionKey);
    await this.pool.query(
      `INSERT INTO code_host_installations (org_id, provider, installation_id, encrypted_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, provider) DO UPDATE SET
         installation_id = EXCLUDED.installation_id,
         encrypted_token = EXCLUDED.encrypted_token,
         token_expires_at = EXCLUDED.token_expires_at`,
      [orgId, provider, installationId, encrypted, tokenExpiresAt]
    );
  }

  public async getCodeHostInstallation(
    orgId: string,
    provider: string
  ): Promise<CodeHostInstallationRecord | undefined> {
    const result = await this.pool.query(
      `SELECT org_id, provider, installation_id, token_expires_at, created_at
       FROM code_host_installations WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    return row ? rowToInstallation(row) : undefined;
  }

  public async getInstallationToken(orgId: string, provider: string): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT encrypted_token FROM code_host_installations WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row?.encrypted_token) {
      return undefined;
    }
    return decryptCredential(String(row.encrypted_token), this.credentialsEncryptionKey);
  }

  public async findOrgIdByInstallation(
    installationId: number,
    provider: string
  ): Promise<string | undefined> {
    const result = await this.pool.query(
      `SELECT org_id FROM code_host_installations WHERE installation_id = $1 AND provider = $2`,
      [installationId, provider]
    );
    const row = result.rows[0];
    return row ? String(row.org_id) : undefined;
  }

  /** Reverse lookup for encrypted org_credentials (e.g. github:install-hint after disconnect). */
  public async findOrgIdByCredentialValue(
    provider: string,
    value: string
  ): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const needle = value.trim();
    if (!needle) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT org_id, encrypted_token FROM org_credentials WHERE provider = $1`,
      [provider]
    );
    for (const row of result.rows) {
      const decrypted = decryptCredential(String(row.encrypted_token), this.credentialsEncryptionKey);
      if (decrypted.trim() === needle) {
        return String(row.org_id);
      }
    }
    return undefined;
  }

  public async deleteCodeHostInstallation(orgId: string, provider: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM code_host_installations WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
  }

  public async deleteCredential(orgId: string, provider: string): Promise<void> {
    await this.pool.query(`DELETE FROM org_credentials WHERE org_id = $1 AND provider = $2`, [orgId, provider]);
  }

  public async upsertOrgRepo(
    orgId: string,
    repoId: string,
    patch: Partial<
      Pick<
        OrgRepoRecord,
        | "lightningEnabled"
        | "indexStatus"
        | "embeddingStatus"
        | "lastIndexedAt"
        | "lastJobId"
        | "error"
        | "embeddingError"
      >
    >
  ): Promise<OrgRepoRecord> {
    const existing = await this.getOrgRepo(orgId, repoId);
    const record: OrgRepoRecord = {
      orgId,
      repoId,
      lightningEnabled: patch.lightningEnabled ?? existing?.lightningEnabled ?? false,
      indexStatus: patch.indexStatus ?? existing?.indexStatus ?? "idle",
      embeddingStatus:
        "embeddingStatus" in patch ? patch.embeddingStatus : existing?.embeddingStatus,
      lastIndexedAt: patch.lastIndexedAt ?? existing?.lastIndexedAt,
      lastJobId: patch.lastJobId ?? existing?.lastJobId,
      error: "error" in patch ? patch.error : existing?.error,
      embeddingError: "embeddingError" in patch ? patch.embeddingError : existing?.embeddingError,
      updatedAt: new Date()
    };
    await this.pool.query(
      `INSERT INTO org_repos (
         org_id, repo_id, lightning_enabled, index_status, embedding_status,
         last_indexed_at, last_job_id, error, embedding_error, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (org_id, repo_id) DO UPDATE SET
         lightning_enabled = EXCLUDED.lightning_enabled,
         index_status = EXCLUDED.index_status,
         embedding_status = EXCLUDED.embedding_status,
         last_indexed_at = EXCLUDED.last_indexed_at,
         last_job_id = EXCLUDED.last_job_id,
         error = EXCLUDED.error,
         embedding_error = EXCLUDED.embedding_error,
         updated_at = NOW()`,
      [
        record.orgId,
        record.repoId,
        record.lightningEnabled,
        record.indexStatus,
        record.embeddingStatus ?? null,
        record.lastIndexedAt ?? null,
        record.lastJobId ?? null,
        record.error ?? null,
        record.embeddingError ?? null
      ]
    );
    return record;
  }

  public async getOrgRepo(orgId: string, repoId: string): Promise<OrgRepoRecord | undefined> {
    const result = await this.pool.query(
      `SELECT org_id, repo_id, lightning_enabled, index_status, embedding_status,
              last_indexed_at, last_job_id, error, embedding_error, updated_at
       FROM org_repos WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    const row = result.rows[0];
    return row ? rowToOrgRepo(row) : undefined;
  }

  public async listOrgRepos(orgId: string): Promise<OrgRepoRecord[]> {
    const result = await this.pool.query(
      `SELECT org_id, repo_id, lightning_enabled, index_status, embedding_status,
              last_indexed_at, last_job_id, error, embedding_error, updated_at
       FROM org_repos WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    return result.rows.map(rowToOrgRepo);
  }

  public async listLightningEnabledReposForScheduledIndex(): Promise<
    Array<{ orgId: string; repoId: string }>
  > {
    const result = await this.pool.query<{ org_id: string; repo_id: string }>(
      `SELECT r.org_id, r.repo_id
       FROM org_repos r
       JOIN organizations o ON o.id = r.org_id
       WHERE r.lightning_enabled = true
         AND o.plan IN ('free', 'pro', 'enterprise')
       ORDER BY r.org_id, r.repo_id`
    );
    return result.rows.map((row) => ({
      orgId: String(row.org_id),
      repoId: String(row.repo_id)
    }));
  }

  public async getOrganizationBilling(orgId: string): Promise<OrgBilling | undefined> {
    const result = await this.pool.query(
      `SELECT billing_email, stripe_customer_id, stripe_subscription_id, seat_count, billing_status, onboarding_completed_at
       FROM organizations WHERE id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return rowToBilling(row);
  }

  public async findOrganizationByStripeCustomerId(customerId: string): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `SELECT id, name, plan, created_at FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async updateOrganizationBilling(
    orgId: string,
    patch: Partial<{
      billingEmail: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      seatCount: number;
      billingStatus: string;
    }>
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [orgId];
    let idx = 2;
    if (patch.billingEmail !== undefined) {
      fields.push(`billing_email = $${idx++}`);
      values.push(patch.billingEmail);
    }
    if (patch.stripeCustomerId !== undefined) {
      fields.push(`stripe_customer_id = $${idx++}`);
      values.push(patch.stripeCustomerId);
    }
    if (patch.stripeSubscriptionId !== undefined) {
      fields.push(`stripe_subscription_id = $${idx++}`);
      values.push(patch.stripeSubscriptionId);
    }
    if (patch.seatCount !== undefined) {
      const org = await this.getOrganization(orgId);
      const seatCount = clampSeatCountForPlan(org?.plan ?? "free", patch.seatCount);
      fields.push(`seat_count = $${idx++}`);
      values.push(seatCount);
    }
    if (patch.billingStatus !== undefined) {
      fields.push(`billing_status = $${idx++}`);
      values.push(patch.billingStatus);
    }
    if (fields.length === 0) return;
    await this.pool.query(`UPDATE organizations SET ${fields.join(", ")} WHERE id = $1`, values);
  }

  public async markOnboardingComplete(orgId: string): Promise<void> {
    await this.pool.query(
      `UPDATE organizations SET onboarding_completed_at = NOW() WHERE id = $1`,
      [orgId]
    );
  }

  public async isOrgSuspended(orgId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT operator_status FROM organizations WHERE id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    return row ? String(row.operator_status ?? "active") === "suspended" : false;
  }

  public async getOrgOperatorMetadata(orgId: string): Promise<OrgOperatorMetadata | undefined> {
    const result = await this.pool.query(
      `SELECT operator_status, crm_external_id, operator_notes, suspended_at, suspended_reason, provenance, assignee_operator_id
       FROM organizations WHERE id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    return row ? rowToOperatorMetadata(row) : undefined;
  }

  public async updateOrgOperatorMetadata(
    orgId: string,
    patch: Partial<{
      operatorNotes: string | null;
      crmExternalId: string | null;
      assigneeOperatorId: string | null;
      provenance: OrgOperatorProvenance;
    }>
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [orgId];
    let idx = 2;
    if (patch.operatorNotes !== undefined) {
      fields.push(`operator_notes = $${idx++}`);
      values.push(patch.operatorNotes);
    }
    if (patch.crmExternalId !== undefined) {
      fields.push(`crm_external_id = $${idx++}`);
      values.push(patch.crmExternalId);
    }
    if (patch.assigneeOperatorId !== undefined) {
      fields.push(`assignee_operator_id = $${idx++}`);
      values.push(patch.assigneeOperatorId);
    }
    if (patch.provenance !== undefined) {
      fields.push(`provenance = $${idx++}`);
      values.push(patch.provenance);
    }
    if (fields.length === 0) {
      return;
    }
    await this.pool.query(`UPDATE organizations SET ${fields.join(", ")} WHERE id = $1`, values);
  }

  public async suspendOrganization(orgId: string, reason: string): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `UPDATE organizations
       SET operator_status = 'suspended', suspended_at = NOW(), suspended_reason = $2
       WHERE id = $1
       RETURNING id, name, plan, repo_access_mode, created_at`,
      [orgId, reason]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async activateOrganization(orgId: string): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `UPDATE organizations
       SET operator_status = 'active', suspended_at = NULL, suspended_reason = NULL
       WHERE id = $1
       RETURNING id, name, plan, repo_access_mode, created_at`,
      [orgId]
    );
    const row = result.rows[0];
    return row ? rowToOrg(row) : undefined;
  }

  public async revokeAllApiKeys(orgId: string): Promise<number> {
    const result = await this.pool.query(`DELETE FROM api_keys WHERE org_id = $1`, [orgId]);
    return result.rowCount ?? 0;
  }

  public async listOrganizationsForOperator(filters: {
    search?: string;
    plan?: OrgPlan;
    billingStatus?: string;
    sort?: "created_desc" | "created_asc" | "name_asc" | "name_desc";
    limit?: number;
  }): Promise<{ organizations: OperatorOrganizationListItem[]; total: number }> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.search?.trim()) {
      const built = buildOperatorOrgSearchClause(filters.search.trim(), idx);
      clauses.push(built.clause);
      params.push(...built.params);
      idx = built.nextIdx;
    }
    if (filters.plan) {
      clauses.push(`o.plan = $${idx++}`);
      params.push(filters.plan);
    }
    if (filters.billingStatus?.trim()) {
      clauses.push(`COALESCE(o.billing_status, 'none') = $${idx++}`);
      params.push(filters.billingStatus.trim());
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderBy =
      filters.sort === "created_asc"
        ? "o.created_at ASC"
        : filters.sort === "name_asc"
          ? "o.name ASC"
          : filters.sort === "name_desc"
            ? "o.name DESC"
            : "o.created_at DESC";
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM organizations o ${where}`,
      params
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await this.pool.query(
      `SELECT o.id, o.name, o.plan, o.created_at, o.operator_status, o.provenance,
              o.billing_status, o.billing_email, o.seat_count, o.stripe_customer_id,
              (
                SELECT u.email
                FROM users u
                WHERE u.org_id = o.id
                  AND u.deactivated_at IS NULL
                  AND u.role IN ('owner', 'admin')
                ORDER BY CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END, u.created_at ASC
                LIMIT 1
              ) AS admin_email
       FROM organizations o
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx}`,
      [...params, limit]
    );

    return {
      organizations: result.rows.map(rowToOperatorOrganizationListItem),
      total
    };
  }
}

/**
 * Builds the operator org search WHERE fragment.
 * Exported for regression tests — `organizations.id` is UUID; text operators must cast.
 */
export function buildOperatorOrgSearchClause(
  search: string,
  startIdx: number
): { clause: string; params: unknown[]; nextIdx: number } {
  let idx = startIdx;
  const params: unknown[] = [];
  const fuzzyParam = `$${idx++}`;
  params.push(`%${search}%`);
  const exactParam = `$${idx++}`;
  params.push(search);
  const prefixParam = `$${idx++}`;
  params.push(`${search}%`);
  // o.id is UUID — cast to text before ILIKE/= or Postgres rejects the statement.
  const clause = `(
        o.name ILIKE ${fuzzyParam}
        OR COALESCE(o.billing_email, '') ILIKE ${fuzzyParam}
        OR COALESCE(o.stripe_customer_id, '') ILIKE ${fuzzyParam}
        OR o.id::text = ${exactParam}
        OR o.id::text ILIKE ${prefixParam}
        OR EXISTS (
          SELECT 1
          FROM users u
          WHERE u.org_id = o.id
            AND u.deactivated_at IS NULL
            AND u.role IN ('admin', 'owner')
            AND u.email ILIKE ${fuzzyParam}
        )
      )`;
  return { clause, params, nextIdx: idx };
}

function rowToBilling(row: Record<string, unknown>): OrgBilling {
  return {
    billingEmail: row.billing_email ? String(row.billing_email) : undefined,
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : undefined,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : undefined,
    seatCount: Number(row.seat_count ?? 1),
    billingStatus: String(row.billing_status ?? "none"),
    onboardingCompletedAt: row.onboarding_completed_at
      ? new Date(String(row.onboarding_completed_at))
      : undefined
  };
}

function rowToOrg(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    plan: String(row.plan) as OrgPlan,
    repoAccessMode: parseOrgRepoAccessMode(row.repo_access_mode) ?? "all_indexed",
    createdAt: new Date(String(row.created_at))
  };
}

function rowToApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    label: String(row.label),
    createdAt: new Date(String(row.created_at))
  };
}

function rowToApiKeyListItem(row: Record<string, unknown>): ApiKeyListItem {
  return {
    id: String(row.id),
    label: String(row.label),
    createdAt: new Date(String(row.created_at))
  };
}

function rowToInstallation(row: Record<string, unknown>): CodeHostInstallationRecord {
  return {
    orgId: String(row.org_id),
    provider: String(row.provider),
    installationId: Number(row.installation_id),
    tokenExpiresAt: new Date(String(row.token_expires_at)),
    createdAt: new Date(String(row.created_at))
  };
}

function rowToOrgRepo(row: Record<string, unknown>): OrgRepoRecord {
  return {
    orgId: String(row.org_id),
    repoId: String(row.repo_id),
    lightningEnabled: Boolean(row.lightning_enabled),
    indexStatus: String(row.index_status) as IndexStatus,
    embeddingStatus: row.embedding_status
      ? (String(row.embedding_status) as OrgRepoRecord["embeddingStatus"])
      : undefined,
    lastIndexedAt: row.last_indexed_at ? new Date(String(row.last_indexed_at)) : undefined,
    lastJobId: row.last_job_id ? String(row.last_job_id) : undefined,
    error: row.error ? String(row.error) : undefined,
    embeddingError: row.embedding_error ? String(row.embedding_error) : undefined,
    updatedAt: new Date(String(row.updated_at))
  };
}

function rowToOperatorMetadata(row: Record<string, unknown>): OrgOperatorMetadata {
  return {
    operatorStatus: String(row.operator_status ?? "active") as OrgOperatorStatus,
    crmExternalId: row.crm_external_id ? String(row.crm_external_id) : null,
    operatorNotes: row.operator_notes ? String(row.operator_notes) : null,
    suspendedAt: row.suspended_at ? new Date(String(row.suspended_at)) : null,
    suspendedReason: row.suspended_reason ? String(row.suspended_reason) : null,
    provenance: String(row.provenance ?? "unknown") as OrgOperatorProvenance,
    assigneeOperatorId: row.assignee_operator_id ? String(row.assignee_operator_id) : null
  };
}

function rowToOperatorOrganizationListItem(row: Record<string, unknown>): OperatorOrganizationListItem {
  return {
    id: String(row.id),
    name: String(row.name),
    plan: String(row.plan) as OrgPlan,
    createdAt: new Date(String(row.created_at)),
    billingStatus: row.billing_status ? String(row.billing_status) : undefined,
    billingEmail: row.billing_email ? String(row.billing_email) : undefined,
    adminEmail: row.admin_email ? String(row.admin_email) : undefined,
    seatCount: row.seat_count != null ? Number(row.seat_count) : undefined,
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : undefined,
    operatorStatus: row.operator_status
      ? (String(row.operator_status) as OrgOperatorStatus)
      : undefined,
    provenance: row.provenance ? (String(row.provenance) as OrgOperatorProvenance) : undefined
  };
}

export function canUseLightningPlan(plan: OrgPlan): boolean {
  return plan === "free" || plan === "pro" || plan === "enterprise";
}
