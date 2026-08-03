import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { zoektRepoName } from "../indexing/zoektRepoName";
import { readIndexPhaseTimeouts } from "../config/indexPhaseTimeouts";

const execFileAsync = promisify(execFile);

export type RunZoektIndexerResult = {
  zoektAvailable: boolean;
  indexPath?: string;
  error?: string;
};

/**
 * Build a Zoekt full-text index for a cloned repository and write it to
 * the shared ZOEKT_INDEX_PATH volume so the Zoekt web server can serve it.
 *
 * Requires:
 *  - ZOEKT_INDEX_PATH env var pointing to the shared volume (e.g. /zoekt-indexes)
 *  - zoekt-git-index binary on PATH (installed in Dockerfile via Go multi-stage build)
 *
 * Repo name is org-prefixed so tenants sharing a volume do not collide.
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

  if (!(await commandExists("zoekt-git-index"))) {
    return { zoektAvailable: false, error: "zoekt-git-index not found on PATH" };
  }

  const name = zoektRepoName(orgId, repoId);
  const timeouts = readIndexPhaseTimeouts();

  // zoekt-webserver only loads *.zoekt shards that are direct children of -index.
  try {
    await execFileAsync(
      "zoekt-git-index",
      ["-index", indexRoot, "-name", name, localPath],
      { timeout: timeouts.zoektMs, maxBuffer: 10 * 1024 * 1024 }
    );
    return { zoektAvailable: true, indexPath: indexRoot };
  } catch (error) {
    // Older zoekt-git-index builds may lack -name; retry without and accept host-only naming.
    try {
      await execFileAsync(
        "zoekt-git-index",
        ["-index", indexRoot, localPath],
        { timeout: timeouts.zoektMs, maxBuffer: 10 * 1024 * 1024 }
      );
      return {
        zoektAvailable: true,
        indexPath: indexRoot,
        error: `zoekt -name unsupported; indexed as host path (wanted ${name})`
      };
    } catch (fallbackError) {
      return {
        zoektAvailable: false,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "Zoekt indexing failed"
      };
    }
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
