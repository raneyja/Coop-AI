import type { Pool } from "pg";

export type AuthProvider = "password" | "google" | "saml";

export type AuthIdentityRecord = {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject?: string;
  emailVerifiedAt?: Date;
  createdAt: Date;
};

export class AuthIdentityStore {
  public constructor(private readonly pool: Pool) {}

  public async findPasswordIdentity(userId: string): Promise<AuthIdentityRecord | undefined> {
    return this.findByUserAndProvider(userId, "password");
  }

  public async findGoogleIdentity(googleSub: string): Promise<AuthIdentityRecord | undefined> {
    const result = await this.pool.query(
      `SELECT id, user_id, provider, provider_subject, email_verified_at, created_at
       FROM auth_identities
       WHERE provider = 'google' AND provider_subject = $1
       LIMIT 1`,
      [googleSub]
    );
    const row = result.rows[0];
    return row ? rowToIdentity(row) : undefined;
  }

  public async findByUserAndProvider(
    userId: string,
    provider: AuthProvider
  ): Promise<AuthIdentityRecord | undefined> {
    const result = await this.pool.query(
      `SELECT id, user_id, provider, provider_subject, email_verified_at, created_at
       FROM auth_identities WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
    const row = result.rows[0];
    return row ? rowToIdentity(row) : undefined;
  }

  public async createPasswordIdentity(userId: string, passwordHash: string): Promise<AuthIdentityRecord> {
    const result = await this.pool.query(
      `INSERT INTO auth_identities (user_id, provider, credential_hash)
       VALUES ($1, 'password', $2)
       RETURNING id, user_id, provider, provider_subject, email_verified_at, created_at`,
      [userId, passwordHash]
    );
    return rowToIdentity(result.rows[0]);
  }

  public async createGoogleIdentity(
    userId: string,
    googleSub: string,
    emailVerifiedAt: Date
  ): Promise<AuthIdentityRecord> {
    const result = await this.pool.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, email_verified_at)
       VALUES ($1, 'google', $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         provider_subject = EXCLUDED.provider_subject,
         email_verified_at = EXCLUDED.email_verified_at,
         updated_at = NOW()
       RETURNING id, user_id, provider, provider_subject, email_verified_at, created_at`,
      [userId, googleSub, emailVerifiedAt]
    );
    return rowToIdentity(result.rows[0]);
  }

  public async verifyPassword(userId: string, password: string, verify: (p: string, h: string) => boolean): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT credential_hash FROM auth_identities WHERE user_id = $1 AND provider = 'password'`,
      [userId]
    );
    const hash = result.rows[0]?.credential_hash ? String(result.rows[0].credential_hash) : undefined;
    if (!hash) {
      return false;
    }
    return verify(password, hash);
  }

  public async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const existing = await this.findPasswordIdentity(userId);
    if (existing) {
      await this.pool.query(
        `UPDATE auth_identities SET credential_hash = $2, updated_at = NOW() WHERE user_id = $1 AND provider = 'password'`,
        [userId, passwordHash]
      );
      return;
    }
    await this.createPasswordIdentity(userId, passwordHash);
  }

  public async markEmailVerified(userId: string, provider: AuthProvider = "password"): Promise<void> {
    await this.pool.query(
      `UPDATE auth_identities SET email_verified_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  }

  public async isEmailVerified(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT email_verified_at FROM auth_identities
       WHERE user_id = $1 AND email_verified_at IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    return Boolean(result.rows[0]);
  }
}

function rowToIdentity(row: Record<string, unknown>): AuthIdentityRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider) as AuthProvider,
    providerSubject: row.provider_subject ? String(row.provider_subject) : undefined,
    emailVerifiedAt: row.email_verified_at ? new Date(String(row.email_verified_at)) : undefined,
    createdAt: new Date(String(row.created_at))
  };
}
