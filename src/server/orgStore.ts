import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  generateApiKey,
  hashApiKey
} from "./credentialCrypto";

export type OrgPlan = "free" | "team" | "enterprise";
export type IndexStatus = "idle" | "queued" | "indexing" | "ready" | "error" | "disabled";

export type Organization = {
  id: string;
  name: string;
  plan: OrgPlan;
  createdAt: Date;
};

export type ApiKeyRecord = {
  id: string;
  orgId: string;
  label: string;
  createdAt: Date;
};

export type OrgRepoRecord = {
  orgId: string;
  repoId: string;
  lightningEnabled: boolean;
  indexStatus: IndexStatus;
  lastIndexedAt?: Date;
  lastJobId?: string;
  error?: string;
  updatedAt: Date;
};

export type AuthContext = {
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  apiKeyId: string;
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

  public async resolveAuth(rawKey: string): Promise<AuthContext | undefined> {
    const keyHash = hashApiKey(rawKey);
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

  public async upsertOrgRepo(
    orgId: string,
    repoId: string,
    patch: Partial<Pick<OrgRepoRecord, "lightningEnabled" | "indexStatus" | "lastIndexedAt" | "lastJobId" | "error">>
  ): Promise<OrgRepoRecord> {
    const existing = await this.getOrgRepo(orgId, repoId);
    const record: OrgRepoRecord = {
      orgId,
      repoId,
      lightningEnabled: patch.lightningEnabled ?? existing?.lightningEnabled ?? false,
      indexStatus: patch.indexStatus ?? existing?.indexStatus ?? "idle",
      lastIndexedAt: patch.lastIndexedAt ?? existing?.lastIndexedAt,
      lastJobId: patch.lastJobId ?? existing?.lastJobId,
      error: patch.error ?? existing?.error,
      updatedAt: new Date()
    };
    await this.pool.query(
      `INSERT INTO org_repos (org_id, repo_id, lightning_enabled, index_status, last_indexed_at, last_job_id, error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (org_id, repo_id) DO UPDATE SET
         lightning_enabled = EXCLUDED.lightning_enabled,
         index_status = EXCLUDED.index_status,
         last_indexed_at = EXCLUDED.last_indexed_at,
         last_job_id = EXCLUDED.last_job_id,
         error = EXCLUDED.error,
         updated_at = NOW()`,
      [
        record.orgId,
        record.repoId,
        record.lightningEnabled,
        record.indexStatus,
        record.lastIndexedAt ?? null,
        record.lastJobId ?? null,
        record.error ?? null
      ]
    );
    return record;
  }

  public async getOrgRepo(orgId: string, repoId: string): Promise<OrgRepoRecord | undefined> {
    const result = await this.pool.query(
      `SELECT org_id, repo_id, lightning_enabled, index_status, last_indexed_at, last_job_id, error, updated_at
       FROM org_repos WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    const row = result.rows[0];
    return row ? rowToOrgRepo(row) : undefined;
  }

  public async listOrgRepos(orgId: string): Promise<OrgRepoRecord[]> {
    const result = await this.pool.query(
      `SELECT org_id, repo_id, lightning_enabled, index_status, last_indexed_at, last_job_id, error, updated_at
       FROM org_repos WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    return result.rows.map(rowToOrgRepo);
  }
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

function rowToOrgRepo(row: Record<string, unknown>): OrgRepoRecord {
  return {
    orgId: String(row.org_id),
    repoId: String(row.repo_id),
    lightningEnabled: Boolean(row.lightning_enabled),
    indexStatus: String(row.index_status) as IndexStatus,
    lastIndexedAt: row.last_indexed_at ? new Date(String(row.last_indexed_at)) : undefined,
    lastJobId: row.last_job_id ? String(row.last_job_id) : undefined,
    error: row.error ? String(row.error) : undefined,
    updatedAt: new Date(String(row.updated_at))
  };
}

export function canUseLightningPlan(plan: OrgPlan): boolean {
  return plan === "team" || plan === "enterprise";
}
