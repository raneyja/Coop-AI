import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { RepoEmbeddingsStore } from "./repoEmbeddingsStore";
import { RepoSymbolIndexStore } from "./repoSymbolIndexStore";
import { RepoStatsStore } from "../workspace/repoStatsStore";
import { zoektHostRepoName, zoektRepoName } from "./zoektRepoName";

export type PurgeRepoIndexResult = {
  symbolsDeleted: boolean;
  embeddingsDeleted: boolean;
  statsDeleted: boolean;
  zoektShardsRemoved: number;
};

/**
 * Remove durable Deep-Index artifacts for one org repo (DB + Zoekt shards).
 * Used when an admin turns Deep-Index off so stale data cannot leak to search.
 */
export async function purgeRepoIndexArtifacts(
  pool: Pool,
  orgId: string,
  repoId: string
): Promise<PurgeRepoIndexResult> {
  const symbols = new RepoSymbolIndexStore(pool);
  const embeddings = new RepoEmbeddingsStore(pool);
  const stats = new RepoStatsStore(pool);

  await symbols.deleteForRepo(orgId, repoId);
  await embeddings.deleteForRepo(orgId, repoId);
  await stats.deleteStats(orgId, repoId);
  const zoektShardsRemoved = await removeZoektShards(orgId, repoId);

  return {
    symbolsDeleted: true,
    embeddingsDeleted: true,
    statsDeleted: true,
    zoektShardsRemoved
  };
}

function shardToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

async function removeZoektShards(orgId: string, repoId: string): Promise<number> {
  const indexRoot = process.env.ZOEKT_INDEX_PATH?.trim();
  if (!indexRoot) {
    return 0;
  }

  const tokens = [shardToken(zoektRepoName(orgId, repoId)), shardToken(zoektHostRepoName(repoId))];
  const orgToken = shardToken(orgId);

  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(indexRoot);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".zoekt")) {
      continue;
    }
    const stem = shardToken(entry.replace(/\.zoekt$/i, ""));
    const matchesPrefixed = stem.includes(tokens[0]!);
    const matchesLegacyHost = stem.includes(tokens[1]!) && stem.includes(orgToken);
    if (!matchesPrefixed && !matchesLegacyHost) {
      continue;
    }
    try {
      await fs.unlink(path.join(indexRoot, entry));
      removed += 1;
    } catch {
      // ignore missing/locked shards
    }
  }
  return removed;
}
