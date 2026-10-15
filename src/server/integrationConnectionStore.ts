import type { Pool, PoolClient } from "pg";
import { decryptCredential, encryptCredential } from "./credentialCrypto";

export type IntegrationProvider = "slack" | "atlassian" | "notion" | "google-docs" | "teams";

export type IntegrationConnectionMetadata = {
  teamId?: string;
  teamName?: string;
  siteName?: string;
  siteUrl?: string;
  cloudId?: string;
  email?: string;
  userId?: string;
  workspaceId?: string;
  workspaceName?: string;
  botId?: string;
  displayName?: string;
  tenantId?: string;
  /** AES-GCM encrypted Slack bot token (channels:read for admin scope picker). */
  encryptedBotToken?: string;
};

export type IntegrationConnectionRecord = {
  provider: IntegrationProvider;
  /** Database-generated generation; every write invalidates prior credentials/admission. */
  revision: string;
  tokenExpiresAt?: Date;
  metadata: IntegrationConnectionMetadata;
  updatedAt: Date;
};

export class IntegrationConnectionStore {
  public constructor(
    private readonly pool: Pool,
    private readonly credentialsEncryptionKey?: string,
    private readonly sql: Pick<Pool, "query"> = pool
  ) {}

  public inTransaction(client: PoolClient): IntegrationConnectionStore {
    return new IntegrationConnectionStore(this.pool, this.credentialsEncryptionKey, client);
  }

  public async upsert(
    orgId: string,
    provider: IntegrationProvider,
    accessToken: string,
    options?: {
      refreshToken?: string;
      expiresAt?: Date;
      metadata?: IntegrationConnectionMetadata;
      botAccessToken?: string;
    }
  ): Promise<void> {
    if (!this.credentialsEncryptionKey) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const encryptedAccess = encryptCredential(accessToken.trim(), this.credentialsEncryptionKey);
    const encryptedRefresh = options?.refreshToken
      ? encryptCredential(options.refreshToken.trim(), this.credentialsEncryptionKey)
      : null;
    const metadata: IntegrationConnectionMetadata = { ...(options?.metadata ?? {}) };
    if (options?.botAccessToken?.trim()) {
      metadata.encryptedBotToken = encryptCredential(
        options.botAccessToken.trim(),
        this.credentialsEncryptionKey
      );
    }
    await this.sql.query(
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
        JSON.stringify(metadata)
      ]
    );
  }

  public async get(orgId: string, provider: IntegrationProvider): Promise<IntegrationConnectionRecord | undefined> {
    const result = await this.sql.query(
      `SELECT provider, revision, token_expires_at, metadata, updated_at
       FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    assertRevision(row.revision);
    return {
      provider,
      revision: row.revision,
      tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : undefined,
      metadata: parseMetadata(row.metadata),
      updatedAt: new Date(row.updated_at)
    };
  }

  public async getAccessToken(orgId: string, provider: IntegrationProvider, expectedRevision?: string): Promise<string | undefined> {
    return this.readToken(orgId, provider, "encrypted_access_token", expectedRevision);
  }

  public async getRefreshToken(orgId: string, provider: IntegrationProvider, expectedRevision?: string): Promise<string | undefined> {
    return this.readToken(orgId, provider, "encrypted_refresh_token", expectedRevision);
  }

  /** Refresh never creates a connection or changes its installation metadata. */
  public async saveRefreshedTokens(
    orgId: string,
    provider: IntegrationProvider,
    expectedRevision: string,
    accessToken: string,
    options: { refreshToken?: string; expiresAt?: Date } = {}
  ): Promise<boolean> {
    if (typeof orgId !== "string" || !UUID.test(orgId) || !PROVIDERS.includes(provider)) {
      throw new Error("Invalid integration connection target");
    }
    assertRevision(expectedRevision);
    const access = checkedToken(accessToken);
    if (!options || typeof options !== "object" || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
      || (options.expiresAt !== undefined && (!(options.expiresAt instanceof Date) || !Number.isFinite(options.expiresAt.getTime())))) {
      throw new Error("Invalid refreshed credential options");
    }
    const refresh = options.refreshToken === undefined ? undefined : checkedToken(options.refreshToken);
    if (!this.credentialsEncryptionKey) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
    const result = await this.sql.query(
      `UPDATE org_integration_connections SET
         encrypted_access_token = $4,
         encrypted_refresh_token = COALESCE($5, encrypted_refresh_token),
         token_expires_at = $6,
         updated_at = NOW()
       WHERE org_id = $1 AND provider = $2 AND revision = $3::uuid
       RETURNING revision`,
      [orgId, provider, expectedRevision,
        encryptCredential(access, this.credentialsEncryptionKey),
        refresh === undefined ? null : encryptCredential(refresh, this.credentialsEncryptionKey),
        options.expiresAt ?? null]
    );
    return result.rowCount === 1;
  }

  private async readToken(
    orgId: string,
    provider: IntegrationProvider,
    column: "encrypted_access_token" | "encrypted_refresh_token",
    expectedRevision?: string
  ): Promise<string | undefined> {
    if (expectedRevision !== undefined) assertRevision(expectedRevision);
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const result = await this.sql.query(
      `SELECT ${column} FROM org_integration_connections
       WHERE org_id = $1 AND provider = $2 AND ($3::uuid IS NULL OR revision = $3::uuid)`,
      [orgId, provider, expectedRevision ?? null]
    );
    const row = result.rows[0];
    if (!row?.[column]) {
      return undefined;
    }
    return decryptCredential(String(row[column]), this.credentialsEncryptionKey);
  }

  public async delete(orgId: string, provider: IntegrationProvider): Promise<void> {
    await this.sql.query(
      `DELETE FROM org_integration_connections WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
  }

  public async getBotAccessToken(
    orgId: string,
    provider: IntegrationProvider
  ): Promise<string | undefined> {
    if (!this.credentialsEncryptionKey) {
      return undefined;
    }
    const connection = await this.get(orgId, provider);
    const encrypted = connection?.metadata.encryptedBotToken;
    if (!encrypted) {
      return undefined;
    }
    return decryptCredential(encrypted, this.credentialsEncryptionKey);
  }
}

const PROVIDERS: IntegrationProvider[] = ["slack", "atlassian", "notion", "google-docs", "teams"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_TOKEN_BYTES = 64 * 1024;

function assertRevision(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid integration connection revision");
}

function checkedToken(value: unknown): string {
  // Bound normalization/encryption before allocating ciphertext or reaching SQL.
  if (typeof value !== "string" || value.length > MAX_TOKEN_BYTES || Buffer.byteLength(value, "utf8") > MAX_TOKEN_BYTES) {
    throw new Error("Invalid refreshed credential");
  }
  const token = value.trim();
  if (!token || /[\u0000-\u0020\u007f]/.test(token)) throw new Error("Invalid refreshed credential");
  return token;
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
    userId: typeof record.userId === "string" ? record.userId : undefined,
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : undefined,
    workspaceName: typeof record.workspaceName === "string" ? record.workspaceName : undefined,
    botId: typeof record.botId === "string" ? record.botId : undefined,
    displayName: typeof record.displayName === "string" ? record.displayName : undefined,
    tenantId: typeof record.tenantId === "string" ? record.tenantId : undefined,
    encryptedBotToken:
      typeof record.encryptedBotToken === "string" ? record.encryptedBotToken : undefined
  };
}
