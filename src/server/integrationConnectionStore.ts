import type { Pool } from "pg";
import { decryptCredential, encryptCredential } from "./credentialCrypto";

export type IntegrationProvider = "slack" | "atlassian";

export type IntegrationConnectionMetadata = {
  teamId?: string;
  teamName?: string;
  siteName?: string;
  siteUrl?: string;
  cloudId?: string;
  email?: string;
  userId?: string;
};

export type IntegrationConnectionRecord = {
  provider: IntegrationProvider;
  tokenExpiresAt?: Date;
  metadata: IntegrationConnectionMetadata;
  updatedAt: Date;
};

export class IntegrationConnectionStore {
  public constructor(
    private readonly pool: Pool,
    private readonly credentialsEncryptionKey?: string
  ) {}

  public async upsert(
    orgId: string,
    provider: IntegrationProvider,
    accessToken: string,
    options?: {
      refreshToken?: string;
      expiresAt?: Date;
      metadata?: IntegrationConnectionMetadata;
    }
  ): Promise<void> {
    if (!this.credentialsEncryptionKey) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const encryptedAccess = encryptCredential(accessToken.trim(), this.credentialsEncryptionKey);
    const encryptedRefresh = options?.refreshToken
      ? encryptCredential(options.refreshToken.trim(), this.credentialsEncryptionKey)
      : null;
    await this.pool.query(
      `INSERT INTO org_integration_connections
         (org_id, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (org_id, provider) DO UPDATE SET
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        orgId,
        provider,
        encryptedAccess,
        encryptedRefresh,
        options?.expiresAt ?? null,
        JSON.stringify(options?.metadata ?? {})
      ]
    );
  }

  public async get(orgId: string, provider: IntegrationProvider): Promise<IntegrationConnectionRecord | undefined> {
    const result = await this.pool.query(
      `SELECT provider, token_expires_at, metadata, updated_at
       FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      provider,
      tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : undefined,
      metadata: parseMetadata(row.metadata),
      updatedAt: new Date(row.updated_at)
    };
  }

  public async getAccessToken(orgId: string, provider: IntegrationProvider): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT encrypted_access_token FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row?.encrypted_access_token) {
      return undefined;
    }
    return decryptCredential(String(row.encrypted_access_token), this.credentialsEncryptionKey);
  }

  public async getRefreshToken(orgId: string, provider: IntegrationProvider): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT encrypted_refresh_token FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row?.encrypted_refresh_token) {
      return undefined;
    }
    return decryptCredential(String(row.encrypted_refresh_token), this.credentialsEncryptionKey);
  }

  public async delete(orgId: string, provider: IntegrationProvider): Promise<void> {
    await this.pool.query(
      `DELETE FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
  }
}

function parseMetadata(raw: unknown): IntegrationConnectionMetadata {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const record = raw as IntegrationConnectionMetadata;
  return {
    teamId: typeof record.teamId === "string" ? record.teamId : undefined,
    teamName: typeof record.teamName === "string" ? record.teamName : undefined,
    siteName: typeof record.siteName === "string" ? record.siteName : undefined,
    siteUrl: typeof record.siteUrl === "string" ? record.siteUrl : undefined,
    cloudId: typeof record.cloudId === "string" ? record.cloudId : undefined,
    email: typeof record.email === "string" ? record.email : undefined,
    userId: typeof record.userId === "string" ? record.userId : undefined
  };
}
