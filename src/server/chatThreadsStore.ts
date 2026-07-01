import type { Pool } from "pg";

export type ChatThreadRow = {
  id: string;
  orgId: string;
  userId?: string;
  principal: string;
  title: string;
  repoOwner?: string;
  repoName?: string;
  repoProvider?: string;
  messageCount: number;
  previewText?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessageRow = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  sortOrder: number;
};

export type UpsertThreadInput = {
  id: string;
  orgId: string;
  userId?: string;
  principal: string;
  title: string;
  repoOwner?: string;
  repoName?: string;
  repoProvider?: string;
  previewText?: string;
  createdAt?: Date;
  updatedAt?: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    metadata?: Record<string, unknown>;
    sortOrder: number;
  }>;
};

export type ListThreadsFilters = {
  orgId: string;
  from?: Date;
  to?: Date;
  userId?: string;
  repoOwner?: string;
  repoName?: string;
  query?: string;
  limit: number;
  cursor?: { updatedAt: Date; id: string };
  /** When set, restrict to threads owned by this principal/user. */
  memberScope?: { userId?: string; principal: string };
};

export type ListThreadsResult = {
  threads: ChatThreadRow[];
  nextCursor?: string;
};

function rowToThread(row: Record<string, unknown>): ChatThreadRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: row.user_id ? String(row.user_id) : undefined,
    principal: String(row.principal),
    title: String(row.title),
    repoOwner: row.repo_owner ? String(row.repo_owner) : undefined,
    repoName: row.repo_name ? String(row.repo_name) : undefined,
    repoProvider: row.repo_provider ? String(row.repo_provider) : undefined,
    messageCount: Number(row.message_count ?? 0),
    previewText: row.preview_text ? String(row.preview_text) : undefined,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at))
  };
}

function rowToMessage(row: Record<string, unknown>): ChatMessageRow {
  const metadata = row.metadata;
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    role: String(row.role),
    content: String(row.content),
    metadata:
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    createdAt: new Date(String(row.created_at)),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

export function encodeThreadCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeThreadCursor(cursor: string): { updatedAt: Date; id: string } | undefined {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    if (separator <= 0) {
      return undefined;
    }
    const updatedAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(updatedAt.getTime())) {
      return undefined;
    }
    return { updatedAt, id };
  } catch {
    return undefined;
  }
}

/** Build SQL WHERE fragments for thread list filters (parameterized). */
export function buildThreadListWhere(filters: ListThreadsFilters): {
  clauses: string[];
  params: unknown[];
} {
  const clauses = ["org_id = $1"];
  const params: unknown[] = [filters.orgId];
  let index = 2;

  if (filters.memberScope) {
    if (filters.memberScope.userId) {
      clauses.push(`(user_id = $${index} OR principal = $${index + 1})`);
      params.push(filters.memberScope.userId, filters.memberScope.principal);
      index += 2;
    } else {
      clauses.push(`principal = $${index}`);
      params.push(filters.memberScope.principal);
      index += 1;
    }
  }

  if (filters.userId) {
    clauses.push(`user_id = $${index}`);
    params.push(filters.userId);
    index += 1;
  }

  if (filters.repoOwner) {
    clauses.push(`repo_owner = $${index}`);
    params.push(filters.repoOwner);
    index += 1;
  }

  if (filters.repoName) {
    clauses.push(`repo_name = $${index}`);
    params.push(filters.repoName);
    index += 1;
  }

  if (filters.from) {
    clauses.push(`updated_at >= $${index}`);
    params.push(filters.from);
    index += 1;
  }

  if (filters.to) {
    clauses.push(`updated_at <= $${index}`);
    params.push(filters.to);
    index += 1;
  }

  if (filters.query?.trim()) {
    clauses.push(`(title ILIKE $${index} OR preview_text ILIKE $${index})`);
    params.push(`%${filters.query.trim()}%`);
    index += 1;
  }

  if (filters.cursor) {
    clauses.push(`(updated_at, id) < ($${index}, $${index + 1})`);
    params.push(filters.cursor.updatedAt, filters.cursor.id);
    index += 2;
  }

  return { clauses, params };
}

export class ChatThreadsStore {
  public constructor(private readonly pool: Pool) {}

  public async upsertThread(input: UpsertThreadInput): Promise<ChatThreadRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const messageCount = input.messages.length;
      const createdAt = input.createdAt ?? new Date();
      const updatedAt = input.updatedAt ?? new Date();
      const threadResult = await client.query(
        `INSERT INTO chat_threads (
           id, org_id, user_id, principal, title,
           repo_owner, repo_name, repo_provider,
           message_count, preview_text, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           principal = EXCLUDED.principal,
           title = EXCLUDED.title,
           repo_owner = EXCLUDED.repo_owner,
           repo_name = EXCLUDED.repo_name,
           repo_provider = EXCLUDED.repo_provider,
           message_count = EXCLUDED.message_count,
           preview_text = EXCLUDED.preview_text,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.id,
          input.orgId,
          input.userId ?? null,
          input.principal,
          input.title,
          input.repoOwner ?? null,
          input.repoName ?? null,
          input.repoProvider ?? null,
          messageCount,
          input.previewText ?? null,
          createdAt,
          updatedAt
        ]
      );

      await client.query(`DELETE FROM chat_messages WHERE thread_id = $1`, [input.id]);

      for (const message of input.messages) {
        await client.query(
          `INSERT INTO chat_messages (id, thread_id, role, content, metadata, sort_order)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            message.id,
            input.id,
            message.role,
            message.content,
            JSON.stringify(message.metadata ?? {}),
            message.sortOrder
          ]
        );
      }

      await client.query("COMMIT");
      return rowToThread(threadResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listThreads(filters: ListThreadsFilters): Promise<ListThreadsResult> {
    const { clauses, params } = buildThreadListWhere(filters);
    const limit = Math.min(Math.max(filters.limit, 1), 100);
    const query = `
      SELECT *
      FROM chat_threads
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length + 1}
    `;
    const result = await this.pool.query(query, [...params, limit + 1]);
    const rows = result.rows.map(rowToThread);
    const hasMore = rows.length > limit;
    const threads = hasMore ? rows.slice(0, limit) : rows;
    const last = threads[threads.length - 1];
    return {
      threads,
      nextCursor: hasMore && last ? encodeThreadCursor(last.updatedAt, last.id) : undefined
    };
  }

  public async getThread(orgId: string, threadId: string): Promise<ChatThreadRow | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM chat_threads WHERE org_id = $1 AND id = $2`,
      [orgId, threadId]
    );
    const row = result.rows[0];
    return row ? rowToThread(row) : undefined;
  }

  public async getThreadMessages(threadId: string): Promise<ChatMessageRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [threadId]
    );
    return result.rows.map(rowToMessage);
  }

  public async listDistinctRepos(
    orgId: string,
    memberScope?: { userId?: string; principal: string }
  ): Promise<Array<{ owner: string; name: string; provider?: string }>> {
    const filters: ListThreadsFilters = {
      orgId,
      limit: 1,
      memberScope
    };
    const { clauses, params } = buildThreadListWhere(filters);
    const query = `
      SELECT DISTINCT repo_owner, repo_name, repo_provider
      FROM chat_threads
      WHERE ${clauses.join(" AND ")}
        AND repo_owner IS NOT NULL
        AND repo_name IS NOT NULL
      ORDER BY repo_owner ASC, repo_name ASC
    `;
    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      owner: String(row.repo_owner),
      name: String(row.repo_name),
      provider: row.repo_provider ? String(row.repo_provider) : undefined
    }));
  }
}
