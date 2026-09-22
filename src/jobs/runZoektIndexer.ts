import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { zoektRepoName } from "../indexing/zoektShardIdentity";

const execFileAsync = promisify(execFile);

export type RunZoektIndexerResult = {
  zoektAvailable: boolean;
  indexPath?: string;
  error?: string;
};

/**
 * On-disk layout (name prefix, flat directory):
 *
 * `zoekt-webserver -index` only loads `*.zoekt` shards that are direct children
 * of that directory. Nested `{ZOEKT_INDEX_PATH}/{orgId}/` folders are not served.
 * `zoekt-git-index` names each shard from Repository.Name via url.QueryEscape,
 * so the org lives in the name and the file stays next to every other shard:
 *
 *   {ZOEKT_INDEX_PATH}/{url.QueryEscape(orgId + "__" + host/owner/repo)}_v16.00000.zoekt
 *
 * Example name: `{orgId}__github.com/acme/app`
 * Two orgs indexing the same slug write two shards. Disable deletes only that
 * org's prefix. Existing unprefixed shards are not readable by the new `repo:`
 * filter and must be rebuilt (reindex) after deploy.
 *
 * The repository name is passed with `-meta` so it is not the clone directory
 * basename (which would collide across tenants).
 */
export async function runZoektIndexer(
  repoId: string,
  orgId: string,
  localPath: string
): Promise<RunZoektIndexerResult> {
  const indexRoot = process.env.ZOEKT_INDEX_PATH;
  if (!indexRoot) {
    return { zoektAvailable: false };
  }
  if (!orgId) {
    return { zoektAvailable: false, error: "orgId is required to write a Zoekt shard" };
  }

  if (!(await commandExists("zoekt-git-index"))) {
    return { zoektAvailable: false, error: "zoekt-git-index not found on PATH" };
  }

  const metaPath = path.join(
    os.tmpdir(),
    `zoekt-meta-${orgId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.json`
  );
  try {
    fs.writeFileSync(metaPath, JSON.stringify({ Name: zoektRepoName(orgId, repoId) }));
    await execFileAsync(
      "zoekt-git-index",
      ["-index", indexRoot, "-incremental=false", "-meta", metaPath, localPath],
      { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 }
    );
    return { zoektAvailable: true, indexPath: indexRoot };
  } catch (error) {
    return {
      zoektAvailable: false,
      error: error instanceof Error ? error.message : "Zoekt indexing failed"
    };
  } finally {
    fs.rmSync(metaPath, { force: true });
  }
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(
      process.platform === "win32" ? "where" : "which",
      [name],
      { timeout: 3_000 }
    );
    return true;
  } catch {
    return false;
  }
}
