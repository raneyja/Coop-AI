import type { Pool } from "pg";
import type { AuthContext } from "../orgStore";

/**
 * A single auditable action. Every authenticated request that performs work
 * should produce one of these.
 *   - userId:    human user UUID. Present for Enterprise SSO sessions; omitted
 *                for org-API-key / legacy / dev requests (no human behind them).
 *   - principal: who/what acted, e.g. 'user:<uuid>' or 'apikey:<keyId>'. Always
 *                set so an API-key action is still attributable.
 *   - orgId:     tenant id (may be a synthetic 'legacy'/'dev' string).
 *   - action:    stable verb, e.g. 'chat.completion', 'job.create'.
 */
export type AuditEntry = {
  orgId: string;
  action: string;
  userId?: string;
  principal?: string;
  metadata?: Record<string, unknown>;
};

export function principalForUser(userId: string): string {
  return `user:${userId}`;
}

export function principalForApiKey(apiKeyId: string): string {
  return `apikey:${apiKeyId}`;
}

/**
 * Derive the audit actor from an AuthContext:
 *  - SSO session -> { userId, principal: 'user:<id>' }
 *  - org API key -> { principal: 'apikey:<id>' } (no human userId)
 */
export function auditActor(auth: AuthContext): { userId?: string; principal: string } {
  if (auth.userId) {
    return { userId: auth.userId, principal: principalForUser(auth.userId) };
  }
  return { principal: principalForApiKey(auth.apiKeyId) };
}

/**
 * Append-only audit logger backed by the audit_log table.
 *
 * Design rules:
 *  - Never throw into the request path. A failed audit write is logged to
 *    stderr but must not break the user's action. (For stricter SOC2 needs you
 *    could flip this to fail-closed; default here is fail-open + warn.)
 *  - No-op when no DB pool is configured (dev/test without DATABASE_URL).
 */
export type AuditLogItem = {
  id: string;
  action: string;
  principal?: string;
  userId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export class AuditLogger {
  public constructor(private readonly pool?: Pool | null) {}

  public async listForOrg(
    orgId: string,
    options: { limit: number; cursor?: string }
  ): Promise<{ entries: AuditLogItem[]; nextCursor?: string }> {
    if (!this.pool) {
      return { entries: [] };
    }
    const params: unknown[] = [orgId, options.limit + 1];
    let cursorClause = "";
    if (options.cursor) {
      cursorClause = "AND id < $3";
      params.push(Number(options.cursor));
    }
    const result = await this.pool.query(
      `SELECT id, user_id, principal, action, metadata, created_at
       FROM audit_log
       WHERE org_id = $1 ${cursorClause}
       ORDER BY id DESC
       LIMIT $2`,
      params
    );
    const rows = result.rows.slice(0, options.limit);
    const entries: AuditLogItem[] = rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      principal: row.principal ? String(row.principal) : undefined,
      userId: row.user_id ? String(row.user_id) : undefined,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(String(row.created_at)).toISOString()
    }));
    const nextCursor =
      result.rows.length > options.limit ? String(rows[rows.length - 1]?.id) : undefined;
    return { entries, nextCursor };
  }

  public async listForPrincipal(
    orgId: string,
    principal: string,
    options: { limit: number; cursor?: string }
  ): Promise<{ entries: AuditLogItem[]; nextCursor?: string }> {
    if (!this.pool) {
      return { entries: [] };
    }
    const params: unknown[] = [orgId, principal, options.limit + 1];
    let cursorClause = "";
    if (options.cursor) {
      cursorClause = "AND id < $4";
      params.push(Number(options.cursor));
    }
    const result = await this.pool.query(
      `SELECT id, user_id, principal, action, metadata, created_at
       FROM audit_log
       WHERE org_id = $1 AND principal = $2 ${cursorClause}
       ORDER BY id DESC
       LIMIT $3`,
      params
    );
    const rows = result.rows.slice(0, options.limit);
    const entries: AuditLogItem[] = rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      principal: row.principal ? String(row.principal) : undefined,
      userId: row.user_id ? String(row.user_id) : undefined,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(String(row.created_at)).toISOString()
    }));
    const nextCursor =
      result.rows.length > options.limit ? String(rows[rows.length - 1]?.id) : undefined;
    return { entries, nextCursor };
  }

  public async record(entry: AuditEntry): Promise<void> {
    if (!this.pool) {
      return;
    }
    try {
      await this.pool.query(
        `INSERT INTO audit_log (user_id, org_id, principal, action, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          entry.userId ?? null,
          entry.orgId,
          entry.principal ?? null,
          entry.action,
          JSON.stringify(entry.metadata ?? {})
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[audit] failed to record action "${entry.action}" for org ${entry.orgId}: ${message}`);
    }
  }
}
