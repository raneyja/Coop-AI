import { rowToConfig, ssoConfigFingerprint } from "./ssoConfigStore";
import type { Pool, PoolClient } from "pg";

export const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;
export type SamlLoginRequest = {
  requestId: string; orgId: string; relayHash: string; browserHash?: string; authorizeUrl: string;
  configHash: string; redirect?: string; mode: "login" | "test"; requestInstant: string;
};
export interface SamlRequestStore {
  save(request: SamlLoginRequest): Promise<void>;
  find(relayHash: string): Promise<SamlLoginRequest | undefined>;
  bind(relayHash: string, browserHash: string): Promise<boolean>;
  accept<T>(request: SamlLoginRequest, work: (client?: PoolClient) => Promise<T>): Promise<T>;
}

/** PostgreSQL is the acceptance authority across replicas; validation caches are temporary. */
export class PostgresSamlRequestStore implements SamlRequestStore {
  public constructor(private readonly pool: Pool) {}

  public async save(request: SamlLoginRequest): Promise<void> {
    await this.pool.query("DELETE FROM saml_login_requests WHERE expires_at <= NOW()");
    await this.pool.query(
      `INSERT INTO saml_login_requests
       (request_id, org_id, relay_hash, browser_hash, config_hash, redirect, mode, request_instant, authorize_url, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() + INTERVAL '10 minutes')`,
      [request.requestId, request.orgId, request.relayHash, request.browserHash ?? null,
        request.configHash, request.redirect ?? null, request.mode, request.requestInstant, request.authorizeUrl]
    );
  }

  public async find(relayHash: string): Promise<SamlLoginRequest | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM saml_login_requests WHERE relay_hash = $1 AND expires_at > NOW()", [relayHash]
    );
    const row = result.rows[0];
    return row ? {
      requestId: row.request_id, orgId: row.org_id, relayHash: row.relay_hash,
      browserHash: row.browser_hash ?? undefined, authorizeUrl: row.authorize_url, configHash: row.config_hash, redirect: row.redirect ?? undefined,
      mode: row.mode, requestInstant: row.request_instant
    } : undefined;
  }

  public async bind(relayHash: string, browserHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE saml_login_requests SET browser_hash=$2
       WHERE relay_hash=$1 AND browser_hash IS NULL AND expires_at > NOW() RETURNING request_id`,
      [relayHash, browserHash]
    );
    return result.rowCount === 1;
  }

  public async accept<T>(request: SamlLoginRequest, work: (client?: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      // Lock current eligibility through consume AND user/session effects.
      // A disable/rotation/suspension either precedes admission or waits for it;
      // it cannot slip into a gap between separately committed operations.
      const eligibility = await client.query(
        `SELECT c.*, o.plan AS org_plan, o.operator_status FROM org_sso_config c
         JOIN organizations o ON o.id=c.org_id WHERE c.org_id=$1 FOR UPDATE OF c,o`, [request.orgId]
      );
      const current = eligibility.rows[0];
      if (!current || !current.enabled || current.org_plan !== "enterprise"
        || ["suspended", "cancelled"].includes(current.operator_status)
        || ssoConfigFingerprint(rowToConfig(current)) !== request.configHash) {
        throw new SamlRequestStateError("SAML authorization changed");
      }
      // Acquire the pending-row lock before evaluating wall-clock expiry;
      // evaluating a DELETE predicate before its own lock wait is insufficient.
      await client.query("SELECT request_id FROM saml_login_requests WHERE request_id=$1 FOR UPDATE", [request.requestId]);
      const consumed = await client.query(
        `DELETE FROM saml_login_requests
         WHERE request_id=$1 AND org_id=$2 AND relay_hash=$3 AND browser_hash=$4
           AND config_hash=$5 AND mode=$6 AND redirect IS NOT DISTINCT FROM $7
           AND request_instant=$8 AND expires_at > clock_timestamp() RETURNING request_id, expires_at`,
        [request.requestId, request.orgId, request.relayHash, request.browserHash, request.configHash,
          request.mode, request.redirect ?? null, request.requestInstant]
      );
      if (consumed.rowCount !== 1) throw new SamlRequestStateError("SAML state expired or was already consumed");
      const result = await work(client);
      const fresh = await client.query("SELECT clock_timestamp() < $1::timestamptz AS valid", [consumed.rows[0].expires_at]);
      if (!fresh.rows[0]?.valid) throw new SamlRequestStateError("SAML request expired during admission");
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

export class SamlRequestStateError extends Error {}
