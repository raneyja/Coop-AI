import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashApiKey } from "../credentialCrypto";
import type { OperatorRole } from "./operatorAuthConfig";
import { isOperatorRole } from "./operatorAuthConfig";

export type OperatorRecord = {
  id: string;
  email: string;
  name?: string;
  role: OperatorRole;
  googleSub?: string;
  lastLoginAt?: Date;
  disabledAt?: Date;
  createdAt: Date;
};

export type OperatorContext = {
  operatorId: string;
  email: string;
  name?: string;
  role: OperatorRole;
};

export type OperatorAuditEntry = {
  id: string;
  operatorId: string;
  operatorEmail?: string;
  operatorName?: string;
  action: string;
  targetOrgId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type EnterpriseUpgradeRequest = {
  id: string;
  orgId?: string;
  companyName: string;
  contactEmail: string;
  message?: string;
  status: string;
  createdAt: Date;
};

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function generateOperatorSessionToken(): string {
  return `coop_ops_sess_${randomBytes(32).toString("hex")}`;
}

export class OperatorStore {
  public constructor(private readonly pool: Pool) {}

  public async findOperatorByEmail(email: string): Promise<OperatorRecord | undefined> {
    const result = await this.pool.query(
      `SELECT id, email, name, role, google_sub, last_login_at, disabled_at, created_at
       FROM operators WHERE lower(email) = lower($1)`,
      [email.trim()]
    );
    const row = result.rows[0];
    return row ? rowToOperator(row) : undefined;
  }

  public async findOperatorById(operatorId: string): Promise<OperatorRecord | undefined> {
    const result = await this.pool.query(
      `SELECT id, email, name, role, google_sub, last_login_at, disabled_at, created_at
       FROM operators WHERE id = $1`,
      [operatorId]
    );
    const row = result.rows[0];
    return row ? rowToOperator(row) : undefined;
  }

  public async upsertOperatorFromGoogle(input: {
    email: string;
    name?: string;
    googleSub: string;
    defaultRole?: OperatorRole;
  }): Promise<OperatorRecord> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.findOperatorByEmail(email);
    if (existing) {
      const result = await this.pool.query(
        `UPDATE operators SET
           name = COALESCE($2, name),
           google_sub = $3,
           last_login_at = NOW()
         WHERE id = $1
         RETURNING id, email, name, role, google_sub, last_login_at, disabled_at, created_at`,
        [existing.id, input.name ?? null, input.googleSub]
      );
      return rowToOperator(result.rows[0]);
    }

    const role = input.defaultRole ?? "viewer";
    const result = await this.pool.query(
      `INSERT INTO operators (email, name, role, google_sub, last_login_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, email, name, role, google_sub, last_login_at, disabled_at, created_at`,
      [email, input.name ?? null, role, input.googleSub]
    );
    return rowToOperator(result.rows[0]);
  }

  public async createSession(
    operatorId: string,
    ttlMs = DEFAULT_SESSION_TTL_MS
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateOperatorSessionToken();
    const tokenHash = hashApiKey(token);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(
      `INSERT INTO operator_sessions (operator_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [operatorId, tokenHash, expiresAt]
    );
    return { token, expiresAt };
  }

  public async resolveSession(rawToken: string): Promise<OperatorContext | undefined> {
    const tokenHash = hashApiKey(rawToken.trim());
    const result = await this.pool.query(
      `SELECT o.id, o.email, o.name, o.role, o.disabled_at, s.expires_at
       FROM operator_sessions s
       JOIN operators o ON o.id = s.operator_id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row || row.disabled_at) {
      return undefined;
    }
    if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
      return undefined;
    }
    const role = String(row.role);
    if (!isOperatorRole(role)) {
      return undefined;
    }
    return {
      operatorId: String(row.id),
      email: String(row.email),
      name: row.name ? String(row.name) : undefined,
      role
    };
  }

  public async revokeSessionByToken(rawToken: string): Promise<void> {
    const tokenHash = hashApiKey(rawToken.trim());
    await this.pool.query(`DELETE FROM operator_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  public async recordAudit(input: {
    operatorId: string;
    action: string;
    targetOrgId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<OperatorAuditEntry> {
    const result = await this.pool.query(
      `INSERT INTO operator_audit_log (operator_id, action, target_org_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, operator_id, action, target_org_id, metadata, created_at`,
      [
        input.operatorId,
        input.action,
        input.targetOrgId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return rowToAuditEntry(result.rows[0]);
  }

  public async listAuditForOrg(
    orgId: string,
    options: { limit: number; cursor?: string }
  ): Promise<{ entries: OperatorAuditEntry[]; nextCursor?: string }> {
    const params: unknown[] = [orgId, options.limit + 1];
    let cursorClause = "";
    if (options.cursor) {
      cursorClause = "AND a.id < $3";
      params.push(Number(options.cursor));
    }
    const result = await this.pool.query(
      `SELECT a.id, a.operator_id, o.email AS operator_email, o.name AS operator_name,
              a.action, a.target_org_id, a.metadata, a.created_at
       FROM operator_audit_log a
       JOIN operators o ON o.id = a.operator_id
       WHERE a.target_org_id = $1 ${cursorClause}
       ORDER BY a.id DESC
       LIMIT $2`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > options.limit;
    const slice = hasMore ? rows.slice(0, options.limit) : rows;
    const entries = slice.map(rowToAuditEntryWithOperator);
    const nextCursor = hasMore ? String(entries[entries.length - 1]?.id) : undefined;
    return { entries, nextCursor };
  }

  public async listPlatformAudit(
    options: { limit: number; cursor?: string }
  ): Promise<{ entries: OperatorAuditEntry[]; nextCursor?: string }> {
    const params: unknown[] = [options.limit + 1];
    let cursorClause = "";
    if (options.cursor) {
      cursorClause = "WHERE a.id < $2";
      params.push(Number(options.cursor));
    }
    const result = await this.pool.query(
      `SELECT a.id, a.operator_id, o.email AS operator_email, o.name AS operator_name,
              a.action, a.target_org_id, a.metadata, a.created_at
       FROM operator_audit_log a
       JOIN operators o ON o.id = a.operator_id
       ${cursorClause}
       ORDER BY a.id DESC
       LIMIT $1`,
      params
    );
    const rows = result.rows;
    const hasMore = rows.length > options.limit;
    const slice = hasMore ? rows.slice(0, options.limit) : rows;
    const entries = slice.map(rowToAuditEntryWithOperator);
    const nextCursor = hasMore ? String(entries[entries.length - 1]?.id) : undefined;
    return { entries, nextCursor };
  }

  public async createEnterpriseUpgradeRequest(input: {
    orgId?: string;
    companyName: string;
    contactEmail: string;
    message?: string;
  }): Promise<EnterpriseUpgradeRequest> {
    const result = await this.pool.query(
      `INSERT INTO enterprise_upgrade_requests (org_id, company_name, contact_email, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, company_name, contact_email, message, status, created_at`,
      [input.orgId ?? null, input.companyName, input.contactEmail, input.message ?? null]
    );
    return rowToUpgradeRequest(result.rows[0]);
  }

  public async listPendingEnterpriseUpgradeRequests(limit = 50): Promise<EnterpriseUpgradeRequest[]> {
    const result = await this.pool.query(
      `SELECT id, org_id, company_name, contact_email, message, status, created_at
       FROM enterprise_upgrade_requests
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToUpgradeRequest);
  }

  public async listSeatOverageOrgs(limit = 20) {
    const result = await this.pool.query(
      `SELECT o.id, o.name, o.plan, o.seat_count,
              (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.deactivated_at IS NULL) AS seats_used
       FROM organizations o
       WHERE (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.deactivated_at IS NULL) > o.seat_count
       ORDER BY o.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      orgId: String(row.id),
      name: String(row.name),
      plan: String(row.plan),
      seatCount: Number(row.seat_count ?? 1),
      seatsUsed: Number(row.seats_used ?? 0)
    }));
  }

  public async listIndexingErrors(limit = 30) {
    const result = await this.pool.query(
      `SELECT o.id AS org_id, o.name AS org_name, r.repo_id, r.index_status, r.error
       FROM org_repos r
       JOIN organizations o ON o.id = r.org_id
       WHERE r.index_status = 'error' OR r.error IS NOT NULL
       ORDER BY r.updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      orgId: String(row.org_id),
      orgName: String(row.org_name),
      repoId: String(row.repo_id),
      indexStatus: String(row.index_status),
      error: row.error ? String(row.error) : undefined
    }));
  }

  public async listStaleInvites(limit = 30) {
    const result = await this.pool.query(
      `SELECT u.id, u.email, u.org_id, o.name AS org_name, u.created_at
       FROM users u
       JOIN organizations o ON o.id = u.org_id
       WHERE u.last_login_at IS NULL
         AND u.deactivated_at IS NULL
         AND u.created_at < NOW() - INTERVAL '7 days'
       ORDER BY u.created_at ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      userId: String(row.id),
      email: String(row.email),
      orgId: String(row.org_id),
      orgName: String(row.org_name),
      createdAt: new Date(String(row.created_at))
    }));
  }
}

function rowToOperator(row: Record<string, unknown>): OperatorRecord {
  const role = String(row.role);
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : undefined,
    role: isOperatorRole(role) ? role : "viewer",
    googleSub: row.google_sub ? String(row.google_sub) : undefined,
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)) : undefined,
    disabledAt: row.disabled_at ? new Date(String(row.disabled_at)) : undefined,
    createdAt: new Date(String(row.created_at))
  };
}

function rowToAuditEntry(row: Record<string, unknown>): OperatorAuditEntry {
  return {
    id: String(row.id),
    operatorId: String(row.operator_id),
    action: String(row.action),
    targetOrgId: row.target_org_id ? String(row.target_org_id) : undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(String(row.created_at))
  };
}

function rowToAuditEntryWithOperator(row: Record<string, unknown>): OperatorAuditEntry {
  return {
    ...rowToAuditEntry(row),
    operatorEmail: row.operator_email ? String(row.operator_email) : undefined,
    operatorName: row.operator_name ? String(row.operator_name) : undefined
  };
}

function rowToUpgradeRequest(row: Record<string, unknown>): EnterpriseUpgradeRequest {
  return {
    id: String(row.id),
    orgId: row.org_id ? String(row.org_id) : undefined,
    companyName: String(row.company_name),
    contactEmail: String(row.contact_email),
    message: row.message ? String(row.message) : undefined,
    status: String(row.status),
    createdAt: new Date(String(row.created_at))
  };
}
