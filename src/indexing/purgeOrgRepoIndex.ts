import type { Pool } from "pg";
import { withJobEffectExclusion } from "../jobs/jobEffectAdmission";
import type { GraphCache } from "../cache/graphCache";
import { RepoManifestStore } from "../manifest/repoManifestStore";
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
  const result = await withJobEffectExclusion(pool, async client => {
    await new RepoSymbolIndexStore(client).deleteForRepo(orgId, repoId);
    await new RepoEmbeddingsStore(client).deleteForRepo(orgId, repoId);
    await new RepoStatsStore(client).deleteForRepo(orgId, repoId);
    await client.query('DELETE FROM repo_dependency_edges WHERE org_id = $1 AND repo_id = $2', [orgId, repoId]);
    await new RepoManifestStore(client).deleteForRepo(orgId, repoId);
    await client.query('INSERT INTO graph_publication_heads(org_id,repo_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[orgId,repoId]);
    await client.query(`UPDATE graph_publication_heads SET requested_generation=requested_generation+1,
      published_generation=requested_generation+1,revision=revision+1,tombstone=TRUE,
      requested_job_id=NULL,published_job_id=NULL,origin='purge' WHERE org_id=$1 AND repo_id=$2`,[orgId,repoId]);
    await client.query(`DELETE FROM graph_snapshots WHERE org_id = $1 AND repo_id = $2`, [orgId, repoId]);
    // Filesystem deletion is not transactional. This admission prevents a job
    // from writing new shards, but a failed unlink still needs reconciliation.
    const zoektShardsRemoved = deleteZoektShardsForRepo(orgId, repoId);
    return {purged: true as const, zoektShardsRemoved};
  });
  options?.graphCache?.deleteGraph(orgId, repoId, {persist: false});
  return result;
}

/** Remove this org's Zoekt shards. Postgres rows cascade when the organization row is deleted. */
export function purgeOrgZoektShards(orgId: string): number {
  return deleteZoektShardsForOrg(orgId);
}
