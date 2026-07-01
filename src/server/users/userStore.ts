import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashApiKey } from "../credentialCrypto";
import type { OrgPlan } from "../orgStore";

export type UserRole = "owner" | "admin" | "member";

export type UserRecord = {
  id: string;
  orgId: string;
  email: string;
  idpSubject?: string;
  idpProvider?: string;
  role: string;
  lastLoginAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
};

/**
 * Resolved Enterprise SSO session. Carries the human user identity plus the
 * org context needed to build an AuthContext. `apiKeyId` is intentionally
 * absent — sessions are user-scoped, not key-scoped.
 */
export type ResolvedUserSession = {
  userId: string;
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  role: string;
};

export type IdpLogin = {
  orgId: string;
  email: string;
  idpSubject: string;
  idpProvider: string;
  role?: string;
};

export type CreatedSession = {
  token: string;
  userId: string;
  orgId: string;
  expiresAt: Date;
};

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function generateSessionToken(): string {
  return `coop_sess_${randomBytes(32).toString("hex")}`;
}

export class UserStore {
  public constructor(private readonly pool: Pool) {}

  /**
   * Idempotently materialize the user behind a verified SAML assertion.
   * Keyed on (idp_provider, idp_subject); falls back to (org_id, email) so an
   * existing non-SSO user is linked rather than duplicated. A successful login
   * always refreshes last_login_at and clears deactivated_at (the IdP just
   * confirmed the user is active).
   */
  public async upsertUserFromIdp(login: IdpLogin): Promise<UserRecord> {
    const role = login.role ?? "member";
    const existing = await this.pool.query(
      `SELECT id FROM users
       WHERE (idp_provider = $1 AND idp_subject = $2)
          OR (org_id = $3 AND lower(email) = lower($4))
       ORDER BY (idp_subject IS NOT NULL) DESC
       LIMIT 1`,
      [login.idpProvider, login.idpSubject, login.orgId, login.email]
    );

    const existingId = existing.rows[0]?.id ? String(existing.rows[0].id) : undefined;

    let row: Record<string, unknown>;
    if (existingId) {
      const updated = await this.pool.query(
        `UPDATE users SET
           email = $2,
           idp_subject = $3,
           idp_provider = $4,
           last_login_at = NOW(),
           deactivated_at = NULL
         WHERE id = $1
         RETURNING id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at`,
        [existingId, login.email, login.idpSubject, login.idpProvider]
      );
      row = updated.rows[0];
    } else {
      const inserted = await this.pool.query(
        `INSERT INTO users (org_id, email, idp_subject, idp_provider, role, last_login_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at`,
        [login.orgId, login.email, login.idpSubject, login.idpProvider, role]
      );
      row = inserted.rows[0];
    }

    const user = rowToUser(row);
    await this.ensureMembership(user.id, user.orgId, user.role);
    return user;
  }

  public async ensureMembership(userId: string, orgId: string, role = "member"): Promise<void> {
    await this.pool.query(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, orgId, role]
    );
  }

  public async getUser(userId: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query(
      `SELECT id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? rowToUser(row) : undefined;
  }

  public async listOrgUsers(orgId: string): Promise<UserRecord[]> {
    const result = await this.pool.query(
      `SELECT id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows.map(rowToUser);
  }

  public async findActiveUserByEmail(email: string): Promise<UserRecord | undefined> {
    const trimmed = email.trim();
    if (!trimmed) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at
       FROM users
       WHERE lower(email) = lower($1)
         AND deactivated_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [trimmed]
    );
    const row = result.rows[0];
    return row ? rowToUser(row) : undefined;
  }

  public async createUser(orgId: string, email: string, role: UserRole = "member"): Promise<UserRecord> {
    const inserted = await this.pool.query(
      `INSERT INTO users (org_id, email, role)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at`,
      [orgId, email.trim(), role]
    );
    const user = rowToUser(inserted.rows[0]);
    await this.ensureMembership(user.id, user.orgId, user.role);
    return user;
  }

  public async setUserRole(userId: string, role: UserRole): Promise<UserRecord | undefined> {
    const updated = await this.pool.query(
      `UPDATE users SET role = $2 WHERE id = $1
       RETURNING id, org_id, email, idp_subject, idp_provider, role, last_login_at, deactivated_at, created_at`,
      [userId, role]
    );
    const row = updated.rows[0];
    if (!row) {
      return undefined;
    }
    const user = rowToUser(row);
    await this.ensureMembership(user.id, user.orgId, user.role);
    return user;
  }

  // -- Sessions ---------------------------------------------------------------

  public async createSession(
    userId: string,
    orgId: string,
    ttlMs: number = DEFAULT_SESSION_TTL_MS
  ): Promise<CreatedSession> {
    const token = generateSessionToken();
    const tokenHash = hashApiKey(token);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(
      `INSERT INTO user_sessions (token_hash, user_id, org_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, userId, orgId, expiresAt]
    );
    return { token, userId, orgId, expiresAt };
  }

  /**
   * Resolve a raw session token to its user + org context. Returns undefined
   * (caller emits 401) when the token is unknown, expired, or the user has
   * been deactivated — the offboarding enforcement point.
   */
  public async resolveUserSession(rawToken: string): Promise<ResolvedUserSession | undefined> {
    const tokenHash = hashApiKey(rawToken);
    const result = await this.pool.query(
      `SELECT u.id AS user_id, u.role AS role, u.deactivated_at AS deactivated_at,
              o.id AS org_id, o.name AS org_name, o.plan AS plan,
              s.expires_at AS expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.org_id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    if (row.deactivated_at) {
      return undefined;
    }
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      return undefined;
    }
    return {
      userId: String(row.user_id),
      orgId: String(row.org_id),
      orgName: String(row.org_name),
      plan: String(row.plan) as OrgPlan,
      role: String(row.role)
    };
  }

  public async revokeUserSessions(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
  }

  public async deleteExpiredSessions(): Promise<number> {
    const result = await this.pool.query(`DELETE FROM user_sessions WHERE expires_at <= NOW()`);
    return result.rowCount ?? 0;
  }

  // -- Offboarding ------------------------------------------------------------

  /** Deactivate a user and immediately revoke their sessions. */
  public async deactivateUser(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users SET deactivated_at = NOW()
       WHERE id = $1 AND deactivated_at IS NULL`,
      [userId]
    );
    await this.revokeUserSessions(userId);
    return (result.rowCount ?? 0) > 0;
  }

  /** Deactivate by IdP subject (how Okta/Azure deprovisioning identifies a user). */
  public async deactivateByIdpSubject(idpProvider: string, idpSubject: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users SET deactivated_at = NOW()
       WHERE idp_provider = $1 AND idp_subject = $2 AND deactivated_at IS NULL
       RETURNING id`,
      [idpProvider, idpSubject]
    );
    const id = result.rows[0]?.id ? String(result.rows[0].id) : undefined;
    if (id) {
      await this.revokeUserSessions(id);
    }
    return Boolean(id);
  }

  /**
   * Full-sync reconciliation (SCIM-style): deactivate every SSO user in the org
   * whose idp_subject is NOT in the set of subjects the IdP currently reports as
   * active. Returns the ids that were deactivated.
   */
  public async reconcileOffboarding(
    orgId: string,
    idpProvider: string,
    activeSubjects: string[]
  ): Promise<string[]> {
    const result = await this.pool.query(
      `UPDATE users SET deactivated_at = NOW()
       WHERE org_id = $1
         AND idp_provider = $2
         AND idp_subject IS NOT NULL
         AND deactivated_at IS NULL
         AND NOT (idp_subject = ANY($3::text[]))
       RETURNING id`,
      [orgId, idpProvider, activeSubjects]
    );
    const ids = result.rows.map((r) => String(r.id));
    for (const id of ids) {
      await this.revokeUserSessions(id);
    }
    return ids;
  }
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    email: String(row.email),
    idpSubject: row.idp_subject ? String(row.idp_subject) : undefined,
    idpProvider: row.idp_provider ? String(row.idp_provider) : undefined,
    role: String(row.role),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)) : undefined,
    deactivatedAt: row.deactivated_at ? new Date(String(row.deactivated_at)) : undefined,
    createdAt: new Date(String(row.created_at))
  };
}
