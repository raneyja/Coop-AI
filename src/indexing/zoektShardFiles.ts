import * as fs from "node:fs";
import * as path from "node:path";
import { zoektOrgShardPrefix, zoektShardFilePrefix } from "./zoektShardIdentity";

/**
 * Delete shard files for one org+repo. Names are direct children of ZOEKT_INDEX_PATH
 * (see zoektShardIdentity.ts). Other orgs' shards are left in place.
 */
export function deleteZoektShardsForRepo(orgId: string, repoId: string): number {
  return deleteShardsWithPrefix(zoektShardFilePrefix(orgId, repoId) + "_v");
}

/** Delete every shard whose name starts with this org's prefix. */
export function deleteZoektShardsForOrg(orgId: string): number {
  return deleteShardsWithPrefix(zoektOrgShardPrefix(orgId));
}

function deleteShardsWithPrefix(prefix: string): number {
  const indexRoot = process.env.ZOEKT_INDEX_PATH;
  if (!indexRoot || !prefix) {
    return 0;
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(indexRoot);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".zoekt")) {
      continue;
    }
    const fullPath = path.join(indexRoot, name);
    const resolvedRoot = path.resolve(indexRoot);
    const resolvedFile = path.resolve(fullPath);
    if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
      continue;
    }
    fs.rmSync(resolvedFile, { force: true });
    removed += 1;
  }
  return removed;
}
