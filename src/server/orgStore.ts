import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  generateApiKey,
  hashApiKey
} from "./credentialCrypto";
import { clampSeatCountForPlan } from "./planGates";

export type OrgPlan = "free" | "pro" | "enterprise";
export type IndexStatus = "idle" | "queued" | "indexing" | "ready" | "error" | "disabled";

export type Organization = {
  id: string;
  name: string;
  plan: OrgPlan;
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
  /** Human user id — set only for Enterprise SSO sessions; undefined for org API keys. */
  userId?: string;
  /** User role from the SSO session (e.g. 'owner' | 'admin' | 'member'). */
  role?: string;
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
      `SELECT id, name, plan, created_at FROM organizations WHERE id = $1`,
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
      `SELECT id, name, plan, created_at FROM organizations WHERE lower(name) = lower($1) LIMIT 2`,
      [trimmed]
    );
    if (result.rows.length !== 1) {
      return undefined;
    }
    return rowToOrg(result.rows[0]);
  }

  public async setOrganizationPlan(orgId: string, plan: OrgPlan): Promise<Organization | undefined> {
    const result = await this.pool.query(
      `UPDATE organizations SET plan = $2 WHERE id = $1
       RETURNING id, name, plan, created_at`,
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
         AND o.plan IN ('pro', 'enterprise')
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

export function canUseLightningPlan(plan: OrgPlan): boolean {
  return plan === "pro" || plan === "enterprise";
}
