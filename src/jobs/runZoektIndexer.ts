import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { zoektRepoName } from "../indexing/zoektShardIdentity";
import { zoektShardFilePrefix } from '../indexing/zoektShardIdentity';
import { withJobOwnedEffect } from './jobEffectAdmission';
import type { Job } from './types';
import type { Pool } from 'pg';

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
  localPath: string,
  attempt: {job: Job; pool: Pool; signal?: AbortSignal}
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

  attempt.signal?.throwIfAborted();
  fs.mkdirSync(indexRoot, {recursive: true});
  const staging = fs.mkdtempSync(path.join(indexRoot, `.attempt-${attempt.job.attemptId ?? 'unadmitted'}-`));
  const metaPath = path.join(staging, 'meta.json');
  let publicationAttempted = false;
  let published = false;
  try {
    fs.writeFileSync(metaPath, JSON.stringify({ Name: zoektRepoName(orgId, repoId) }));
    await execFileAsync(
      "zoekt-git-index",
      ["-index", staging, "-incremental=false", "-meta", metaPath, localPath],
      { timeout: 600_000, maxBuffer: 10 * 1024 * 1024, signal: attempt.signal }
    );
    publicationAttempted = true;
    await withJobOwnedEffect(attempt.pool, attempt.job, async () => {
      publishStagedZoektShards(indexRoot, staging, orgId, repoId);
    }, attempt.signal);
    published = true;
    return { zoektAvailable: true, indexPath: indexRoot };
  } catch (error) {
    attempt.signal?.throwIfAborted();
    if (publicationAttempted) {
      // Filesystem effects cannot roll back with the SQL transaction. The
      // caller must fail/quarantine, including ambiguous COMMIT responses.
      const message = error instanceof Error ? error.message : "unknown publication failure";
      throw new Error(`Zoekt shard publication failed; reconcile attempt artifacts at ${staging}: ${message}`);
    }
    return {
      zoektAvailable: false,
      error: error instanceof Error ? error.message : "Zoekt indexing failed"
    };
  } finally {
    if (!publicationAttempted || published) fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Names are verified before any rename. Multi-shard replacement is still not
 * atomic across a process kill; that attempt requires durable reconciliation. */
export function publishStagedZoektShards(indexRoot: string, staging: string, orgId: string, repoId: string): void {
  const prefix = zoektShardFilePrefix(orgId, repoId) + '_v';
  const names = fs.readdirSync(staging).filter(name => name.endsWith('.zoekt'));
  if (!names.length || names.some(name => !name.startsWith(prefix))) throw new Error('Zoekt produced no safely scoped attempt shards');
  for (const name of names) fs.renameSync(path.join(staging,name),path.join(indexRoot,name));
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
