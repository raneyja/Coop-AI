import type { Pool } from "pg";

export type OrgCollection = {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  createdAt: Date;
};

export type CollectionRepo = {
  collectionId: string;
  repoId: string;
  addedAt: Date;
};

export class CollectionStore {
  public constructor(private readonly pool: Pool) {}

  public async createCollection(
    orgId: string,
    name: string,
    description?: string
  ): Promise<OrgCollection> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Collection name is required");
    }
    const result = await this.pool.query(
      `INSERT INTO org_collections (org_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, name, description, created_at`,
      [orgId, trimmedName, description?.trim() || null]
    );
    return rowToCollection(result.rows[0]);
  }

  public async listCollections(orgId: string): Promise<OrgCollection[]> {
    const result = await this.pool.query(
      `SELECT id, org_id, name, description, created_at
       FROM org_collections
       WHERE org_id = $1
       ORDER BY name ASC`,
      [orgId]
    );
    return result.rows.map(rowToCollection);
  }

  public async getCollection(orgId: string, collectionId: string): Promise<OrgCollection | undefined> {
    const result = await this.pool.query(
      `SELECT id, org_id, name, description, created_at
       FROM org_collections
       WHERE org_id = $1 AND id = $2`,
      [orgId, collectionId]
    );
    const row = result.rows[0];
    return row ? rowToCollection(row) : undefined;
  }

  public async listCollectionRepoIds(orgId: string, collectionId: string): Promise<string[]> {
    const collection = await this.getCollection(orgId, collectionId);
    if (!collection) {
      return [];
    }
    const result = await this.pool.query<{ repo_id: string }>(
      `SELECT cr.repo_id
       FROM collection_repos cr
       JOIN org_collections oc ON oc.id = cr.collection_id
       WHERE oc.org_id = $1 AND cr.collection_id = $2
       ORDER BY cr.added_at ASC`,
      [orgId, collectionId]
    );
    return result.rows.map((row) => String(row.repo_id));
  }

  public async listCollectionRepos(orgId: string, collectionId: string): Promise<CollectionRepo[]> {
    const collection = await this.getCollection(orgId, collectionId);
    if (!collection) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT cr.collection_id, cr.repo_id, cr.added_at
       FROM collection_repos cr
       JOIN org_collections oc ON oc.id = cr.collection_id
       WHERE oc.org_id = $1 AND cr.collection_id = $2
       ORDER BY cr.added_at ASC`,
      [orgId, collectionId]
    );
    return result.rows.map(rowToCollectionRepo);
  }

  public async addRepoToCollection(
    orgId: string,
    collectionId: string,
    repoId: string
  ): Promise<CollectionRepo> {
    const collection = await this.getCollection(orgId, collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    const orgRepo = await this.pool.query(
      `SELECT 1 FROM org_repos WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    if (orgRepo.rowCount === 0) {
      throw new Error("Repo is not registered for this organization");
    }

    const result = await this.pool.query(
      `INSERT INTO collection_repos (collection_id, repo_id)
       VALUES ($1, $2)
       ON CONFLICT (collection_id, repo_id) DO UPDATE SET added_at = collection_repos.added_at
       RETURNING collection_id, repo_id, added_at`,
      [collectionId, repoId]
    );
    return rowToCollectionRepo(result.rows[0]);
  }

  public async removeRepoFromCollection(
    orgId: string,
    collectionId: string,
    repoId: string
  ): Promise<boolean> {
    const collection = await this.getCollection(orgId, collectionId);
    if (!collection) {
      return false;
    }
    const result = await this.pool.query(
      `DELETE FROM collection_repos cr
       USING org_collections oc
       WHERE cr.collection_id = oc.id
         AND oc.org_id = $1
         AND cr.collection_id = $2
         AND cr.repo_id = $3`,
      [orgId, collectionId, repoId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function rowToCollection(row: Record<string, unknown>): OrgCollection {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    createdAt: new Date(String(row.created_at))
  };
}

function rowToCollectionRepo(row: Record<string, unknown>): CollectionRepo {
  return {
    collectionId: String(row.collection_id),
    repoId: String(row.repo_id),
    addedAt: new Date(String(row.added_at))
  };
}
