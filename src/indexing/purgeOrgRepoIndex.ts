import type { Pool } from "pg";
import type { GraphCache } from "../cache/graphCache";
import { RepoManifestStore } from "../manifest/repoManifestStore";
import { RepoDependencyEdgesStore } from "./repoDependencyEdgesStore";
import { RepoEmbeddingsStore } from "./repoEmbeddingsStore";
import { RepoSymbolIndexStore } from "./repoSymbolIndexStore";
import { deleteZoektShardsForOrg, deleteZoektShardsForRepo } from "./zoektShardFiles";
import { RepoStatsStore } from "../workspace/repoStatsStore";

export type PurgeOrgRepoIndexResult = {
  purged: true;
  zoektShardsRemoved: number;
};

/**
 * Wipe Deep-Index artifacts for one (org, repo). Never deletes another org's rows
 * or shards, even when the slug matches.
 */
export async function purgeOrgRepoIndex(
  pool: Pool,
  orgId: string,
  repoId: string,
  options?: { graphCache?: GraphCache }
): Promise<PurgeOrgRepoIndexResult> {
  await new RepoSymbolIndexStore(pool).deleteForRepo(orgId, repoId);
  await new RepoEmbeddingsStore(pool).deleteForRepo(orgId, repoId);
  await new RepoStatsStore(pool).deleteForRepo(orgId, repoId);
  await new RepoDependencyEdgesStore(pool).deleteForRepo(orgId, repoId);
  await new RepoManifestStore(pool).deleteForRepo(orgId, repoId);
  await pool.query(`DELETE FROM graph_snapshots WHERE org_id = $1 AND repo_id = $2`, [orgId, repoId]);
  options?.graphCache?.deleteGraph(orgId, repoId);
  const zoektShardsRemoved = deleteZoektShardsForRepo(orgId, repoId);
  return { purged: true, zoektShardsRemoved };
}

/** Remove this org's Zoekt shards. Postgres rows cascade when the organization row is deleted. */
export function purgeOrgZoektShards(orgId: string): number {
  return deleteZoektShardsForOrg(orgId);
}
