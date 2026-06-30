import type { Pool } from "pg";

export type UsageEventEntry = {
  orgId: string;
  userId?: string;
  principal: string;
  eventType: string;
  metadata?: Record<string, unknown>;
};

export type UsageDateRange = {
  from: Date;
  to: Date;
};

export type TokenUsageEvent = {
  createdAt: Date;
  tokens: number;
};

export class UsageTracker {
  public constructor(private readonly pool?: Pool | null) {}

  public async record(entry: UsageEventEntry): Promise<void> {
    if (!this.pool) {
      return;
    }
    try {
      await this.pool.query(
        `INSERT INTO usage_events (org_id, user_id, principal, event_type, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          entry.orgId,
          entry.userId ?? null,
          entry.principal,
          entry.eventType,
          JSON.stringify(entry.metadata ?? {})
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[usage] failed to record "${entry.eventType}" for org ${entry.orgId}: ${message}`
      );
    }
  }

  public async listTokenEventsForOrg(
    orgId: string,
    range: UsageDateRange,
    eventTypes: string[]
  ): Promise<TokenUsageEvent[]> {
    if (!this.pool || eventTypes.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT created_at,
              CASE
                WHEN (metadata->>'totalTokens') ~ '^\\d+$' THEN (metadata->>'totalTokens')::bigint
                WHEN (metadata->>'inputTokens') ~ '^\\d+$' AND (metadata->>'outputTokens') ~ '^\\d+$'
                  THEN (metadata->>'inputTokens')::bigint + (metadata->>'outputTokens')::bigint
                ELSE 0
              END AS tokens
       FROM usage_events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at < $3
         AND event_type = ANY($4::text[])
       ORDER BY created_at ASC`,
      [orgId, range.from, range.to, eventTypes]
    );
    return result.rows.map((row) => ({
      createdAt: new Date(String(row.created_at)),
      tokens: Number(row.tokens ?? 0)
    }));
  }

  public async sumTokensForOrg(
    orgId: string,
    range: UsageDateRange,
    eventTypes: string[]
  ): Promise<number> {
    if (!this.pool || eventTypes.length === 0) {
      return 0;
    }
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(
         CASE
           WHEN (metadata->>'totalTokens') ~ '^\\d+$' THEN (metadata->>'totalTokens')::bigint
           WHEN (metadata->>'inputTokens') ~ '^\\d+$' AND (metadata->>'outputTokens') ~ '^\\d+$'
             THEN (metadata->>'inputTokens')::bigint + (metadata->>'outputTokens')::bigint
           ELSE 0
         END
       ), 0)::int AS total
       FROM usage_events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at < $3
         AND event_type = ANY($4::text[])`,
      [orgId, range.from, range.to, eventTypes]
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  public async countEvents(orgId: string, range: UsageDateRange): Promise<number> {
    if (!this.pool) {
      return 0;
    }
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3`,
      [orgId, range.from, range.to]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async countDistinctPrincipals(orgId: string, range: UsageDateRange): Promise<number> {
    if (!this.pool) {
      return 0;
    }
    const result = await this.pool.query(
      `SELECT COUNT(DISTINCT principal)::int AS count
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3`,
      [orgId, range.from, range.to]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async eventsByDay(orgId: string, range: UsageDateRange): Promise<Array<{ day: string; count: number }>> {
    return this.eventsByDayForEventTypes(orgId, range);
  }

  public async eventsByDayForEventTypes(
    orgId: string,
    range: UsageDateRange,
    eventTypePrefix?: string
  ): Promise<Array<{ day: string; count: number }>> {
    if (!this.pool) {
      return [];
    }
    const prefixFilter = eventTypePrefix
      ? ` AND event_type LIKE $4`
      : "";
    const params: Array<string | Date> = [orgId, range.from, range.to];
    if (eventTypePrefix) {
      params.push(`${eventTypePrefix}%`);
    }
    const result = await this.pool.query(
      `SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
              COUNT(*)::int AS count
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3${prefixFilter}
       GROUP BY 1
       ORDER BY 1`,
      params
    );
    return result.rows.map((row) => ({
      day: String(row.day),
      count: Number(row.count ?? 0)
    }));
  }

  public async eventsByType(orgId: string, range: UsageDateRange): Promise<Array<{ eventType: string; count: number }>> {
    if (!this.pool) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY event_type
       ORDER BY count DESC`,
      [orgId, range.from, range.to]
    );
    return result.rows.map((row) => ({
      eventType: String(row.event_type),
      count: Number(row.count ?? 0)
    }));
  }

  public async topPrincipals(
    orgId: string,
    range: UsageDateRange,
    limit = 10
  ): Promise<Array<{ principal: string; count: number }>> {
    if (!this.pool) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT principal, COUNT(*)::int AS count
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY principal
       ORDER BY count DESC
       LIMIT $4`,
      [orgId, range.from, range.to, limit]
    );
    return result.rows.map((row) => ({
      principal: String(row.principal),
      count: Number(row.count ?? 0)
    }));
  }

  public async latencyPercentilesForEventType(
    orgId: string,
    range: UsageDateRange,
    eventType: string,
    metadataKey: string
  ): Promise<{ p50: number | null; p95: number | null; sampleCount: number }> {
    if (!this.pool) {
      return { p50: null, p95: null, sampleCount: 0 };
    }
    const result = await this.pool.query(
      `SELECT (metadata->>$4)::double precision AS value
       FROM usage_events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at < $3
         AND event_type = $5
         AND (metadata->>$4) ~ '^\\d+(\\.\\d+)?$'
       ORDER BY value`,
      [orgId, range.from, range.to, metadataKey, eventType]
    );
    const values = result.rows
      .map((row) => Number(row.value))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return { p50: null, p95: null, sampleCount: 0 };
    }
    return {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      sampleCount: values.length
    };
  }

  public async exportCsv(orgId: string, range: UsageDateRange): Promise<string> {
    if (!this.pool) {
      return "created_at,event_type,principal,user_id,metadata\n";
    }
    const result = await this.pool.query(
      `SELECT created_at, event_type, principal, user_id, metadata
       FROM usage_events
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
       ORDER BY created_at DESC`,
      [orgId, range.from, range.to]
    );
    const lines = ["created_at,event_type,principal,user_id,metadata"];
    for (const row of result.rows) {
      const metadata = JSON.stringify(row.metadata ?? {}).replace(/"/g, '""');
      lines.push(
        [
          new Date(String(row.created_at)).toISOString(),
          csvEscape(String(row.event_type)),
          csvEscape(String(row.principal)),
          csvEscape(row.user_id ? String(row.user_id) : ""),
          `"${metadata}"`
        ].join(",")
      );
    }
    return `${lines.join("\n")}\n`;
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

export function parseAnalyticsRange(query: URLSearchParams): UsageDateRange {
  const toRaw = query.get("to");
  const fromRaw = query.get("from");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}
