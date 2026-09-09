import type { Pool } from "pg";
import { parseUsageTier, type UsageTier } from "../usageTiers";

export type SeatUpgradeRequestStatus = "pending" | "confirmed" | "denied";

export type SeatUpgradeRequest = {
  id: string;
  orgId: string;
  userId: string;
  fromTier: UsageTier;
  toTier: UsageTier;
  status: SeatUpgradeRequestStatus;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
};

export class SeatUpgradeRequestStore {
  public constructor(private readonly pool: Pool) {}

  public async createPending(input: {
    orgId: string;
    userId: string;
    fromTier: UsageTier;
    toTier: UsageTier;
  }): Promise<SeatUpgradeRequest> {
    const existing = await this.getPendingForUser(input.userId);
    if (existing) {
      return existing;
    }
    const result = await this.pool.query(
      `INSERT INTO seat_upgrade_requests (org_id, user_id, from_tier, to_tier, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by`,
      [input.orgId, input.userId, input.fromTier, input.toTier]
    );
    return rowToRequest(result.rows[0]);
  }

  public async getById(id: string): Promise<SeatUpgradeRequest | undefined> {
    const result = await this.pool.query(
      `SELECT id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by
       FROM seat_upgrade_requests WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? rowToRequest(row) : undefined;
  }

  public async getPendingForUser(userId: string): Promise<SeatUpgradeRequest | undefined> {
    const result = await this.pool.query(
      `SELECT id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by
       FROM seat_upgrade_requests
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? rowToRequest(row) : undefined;
  }

  public async listPendingForOrg(orgId: string): Promise<SeatUpgradeRequest[]> {
    const result = await this.pool.query(
      `SELECT id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by
       FROM seat_upgrade_requests
       WHERE org_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows.map(rowToRequest);
  }

  public async listForOrg(orgId: string): Promise<SeatUpgradeRequest[]> {
    const result = await this.pool.query(
      `SELECT id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by
       FROM seat_upgrade_requests
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows.map(rowToRequest);
  }

  public async resolve(
    id: string,
    status: Exclude<SeatUpgradeRequestStatus, "pending">,
    resolvedBy?: string
  ): Promise<SeatUpgradeRequest | undefined> {
    const result = await this.pool.query(
      `UPDATE seat_upgrade_requests
       SET status = $2, resolved_at = NOW(), resolved_by = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING id, org_id, user_id, from_tier, to_tier, status, created_at, resolved_at, resolved_by`,
      [id, status, resolvedBy ?? null]
    );
    const row = result.rows[0];
    return row ? rowToRequest(row) : undefined;
  }
}

function rowToRequest(row: Record<string, unknown>): SeatUpgradeRequest {
  const fromTier = parseUsageTier(String(row.from_tier)) ?? "pro";
  const toTier = parseUsageTier(String(row.to_tier)) ?? "pro";
  const statusRaw = String(row.status ?? "pending");
  const status: SeatUpgradeRequestStatus =
    statusRaw === "confirmed" || statusRaw === "denied" ? statusRaw : "pending";
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    fromTier,
    toTier,
    status,
    createdAt: new Date(String(row.created_at)),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)) : undefined,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined
  };
}
