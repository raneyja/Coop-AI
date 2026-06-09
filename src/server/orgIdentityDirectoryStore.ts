import type { Pool } from "pg";
import { normalizeIdentityDirectory } from "../identity/identityDirectory";
import type { IdentityDirectory } from "../identity/types";
import { EMPTY_IDENTITY_DIRECTORY } from "../identity/types";

export class OrgIdentityDirectoryStore {
  public constructor(private readonly pool: Pool) {}

  public async get(orgId: string): Promise<IdentityDirectory> {
    const result = await this.pool.query<{ directory: unknown }>(
      `SELECT directory FROM org_identity_directories WHERE org_id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    if (!row) {
      return { ...EMPTY_IDENTITY_DIRECTORY };
    }
    return normalizeIdentityDirectory(row.directory);
  }

  public async save(orgId: string, directory: IdentityDirectory): Promise<IdentityDirectory> {
    const normalized = normalizeIdentityDirectory(directory);
    await this.pool.query(
      `INSERT INTO org_identity_directories (org_id, directory, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE
       SET directory = EXCLUDED.directory, updated_at = NOW()`,
      [orgId, JSON.stringify(normalized)]
    );
    return normalized;
  }
}
