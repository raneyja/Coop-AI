import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
 */
export async function runZoektIndexer(
  repoId: string,
  _orgId: string,
  localPath: string
): Promise<RunZoektIndexerResult> {
  const indexRoot = process.env.ZOEKT_INDEX_PATH;
  if (!indexRoot) {
    return { zoektAvailable: false };
  }

  if (!(await commandExists("zoekt-git-index"))) {
    return { zoektAvailable: false, error: "zoekt-git-index not found on PATH" };
  }

  // zoekt-webserver only loads *.zoekt shards that are direct children of -index.
  try {
    await execFileAsync(
      "zoekt-git-index",
      ["-index", indexRoot, localPath],
      { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 }
    );
    return { zoektAvailable: true, indexPath: indexRoot };
  } catch (error) {
    return {
      zoektAvailable: false,
      error: error instanceof Error ? error.message : "Zoekt indexing failed"
    };
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
