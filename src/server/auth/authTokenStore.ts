import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashApiKey } from "../credentialCrypto";

export type AuthTokenPurpose = "email_verify" | "password_reset" | "user_invite" | "refresh" | "auth_code";

export class AuthTokenStore {
  public constructor(private readonly pool: Pool) {}

  public async createToken(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMs: number,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const raw = generateRawToken(purpose);
    const tokenHash = hashApiKey(raw);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(
      `INSERT INTO auth_tokens (token_hash, user_id, purpose, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, userId, purpose, metadata ? JSON.stringify(metadata) : null, expiresAt]
    );
    return raw;
  }

  public async peekToken(
    rawToken: string,
    purpose: AuthTokenPurpose
  ): Promise<{ userId: string; metadata?: Record<string, unknown> } | undefined> {
    const tokenHash = hashApiKey(rawToken);
    const result = await this.pool.query(
      `SELECT user_id, metadata FROM auth_tokens
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash, purpose]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      userId: String(row.user_id),
      metadata: row.metadata ? (row.metadata as Record<string, unknown>) : undefined
    };
  }

  public async consumeToken(
    rawToken: string,
    purpose: AuthTokenPurpose
  ): Promise<{ userId: string; metadata?: Record<string, unknown> } | undefined> {
    const tokenHash = hashApiKey(rawToken);
    const result = await this.pool.query(
      `UPDATE auth_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id, metadata`,
      [tokenHash, purpose]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      userId: String(row.user_id),
      metadata: row.metadata ? (row.metadata as Record<string, unknown>) : undefined
    };
  }

  public async revokeRefreshTokens(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_tokens SET used_at = NOW()
       WHERE user_id = $1 AND purpose = 'refresh' AND used_at IS NULL`,
      [userId]
    );
  }

  /** Revoke refresh tokens for every user in the org (Require SSO / method disable). */
  public async revokeRefreshTokensForOrg(orgId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE auth_tokens t SET used_at = NOW()
       FROM users u
       WHERE t.user_id = u.id
         AND u.org_id = $1
         AND t.purpose = 'refresh'
         AND t.used_at IS NULL`,
      [orgId]
    );
    return result.rowCount ?? 0;
  }

  public async validateRefreshToken(rawToken: string): Promise<string | undefined> {
    const tokenHash = hashApiKey(rawToken);
    const result = await this.pool.query(
      `SELECT user_id FROM auth_tokens
       WHERE token_hash = $1 AND purpose = 'refresh' AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    return result.rows[0]?.user_id ? String(result.rows[0].user_id) : undefined;
  }

  public async markRefreshTokenUsed(rawToken: string): Promise<void> {
    const tokenHash = hashApiKey(rawToken);
    await this.pool.query(`UPDATE auth_tokens SET used_at = NOW() WHERE token_hash = $1`, [tokenHash]);
  }
}

function generateRawToken(purpose: AuthTokenPurpose): string {
  const prefix =
    purpose === "refresh"
      ? "coop_refresh_"
      : purpose === "auth_code"
        ? "coop_code_"
        : purpose === "password_reset"
          ? "coop_reset_"
          : purpose === "user_invite"
            ? "coop_invite_"
            : "coop_verify_";
  return `${prefix}${randomBytes(32).toString("hex")}`;
}
