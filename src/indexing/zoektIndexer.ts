import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { IndexManifest, ZoektSearchHit } from "./types";

const execFileAsync = promisify(execFile);

const ZOEKT_BINARIES = ["zoekt-git-index", "zoekt-index", "zoekt"] as const;

export type ZoektIndexerOptions = {
  indexesRoot: string;
};

export class ZoektIndexer {
  private availableBinary?: string;

  public constructor(private readonly options: ZoektIndexerOptions) {}

  public async isAvailable(): Promise<boolean> {
    return Boolean(await this.resolveBinary());
  }

  public indexPathFor(repoId: string): string {
    return path.join(this.options.indexesRoot, sanitizeRepoId(repoId), "zoekt");
  }

  public async buildIndex(manifest: IndexManifest): Promise<IndexManifest> {
    const binary = await this.resolveBinary();
    if (!binary) {
      return {
        ...manifest,
        zoektAvailable: false,
        status: manifest.scipAvailable ? manifest.status : "error",
        error: manifest.error ?? "zoekt-git-index not found on PATH. Install Zoekt to enable text search."
      };
    }

    const indexDir = this.indexPathFor(manifest.repoId);
    fs.mkdirSync(indexDir, { recursive: true });

    try {
      if (binary.includes("git-index")) {
        await execFileAsync(binary, ["-index", indexDir, manifest.localPath], {
          timeout: 600_000,
          maxBuffer: 10 * 1024 * 1024
        });
      } else {
        await execFileAsync(binary, [manifest.localPath, "-index", indexDir], {
          timeout: 600_000,
          maxBuffer: 10 * 1024 * 1024
        });
      }

      return {
        ...manifest,
        zoektIndexPath: indexDir,
        zoektAvailable: true,
        status: manifest.scipAvailable ? "ready" : manifest.status,
        error: manifest.scipAvailable ? undefined : manifest.error
      };
    } catch (error) {
      return {
        ...manifest,
        zoektAvailable: false,
        status: "error",
        error: formatExecError("Zoekt indexing failed", error)
      };
    }
  }

  public async search(repoId: string, pattern: string, limit = 25): Promise<ZoektSearchHit[]> {
    const indexDir = this.indexPathFor(repoId);
    if (!fs.existsSync(indexDir)) {
      return [];
    }

    const zoektGrep = await this.resolveSearchBinary();
    if (zoektGrep) {
      try {
        const { stdout } = await execFileAsync(
          zoektGrep,
          ["-index", indexDir, "-l", pattern],
          { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }
        );
        return parseZoektGrepOutput(stdout, limit);
      } catch {
        // fall through to local scan
      }
    }

    return localFallbackSearch(manifestLocalPath(repoId), pattern, limit);
  }

  private async resolveBinary(): Promise<string | undefined> {
    if (this.availableBinary) {
      return this.availableBinary;
    }
    for (const name of ZOEKT_BINARIES) {
      if (await commandExists(name)) {
        this.availableBinary = name;
        return name;
      }
    }
    return undefined;
  }

  private async resolveSearchBinary(): Promise<string | undefined> {
    for (const name of ["zoekt", "zoekt-grep"]) {
      if (await commandExists(name)) {
        return name;
      }
    }
    return undefined;
  }
}

function sanitizeRepoId(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseZoektGrepOutput(stdout: string, limit: number): ZoektSearchHit[] {
  const hits: ZoektSearchHit[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    hits.push({
      fileName: trimmed.slice(0, colon),
      lineNumber: Number(trimmed.slice(colon + 1)) || 1,
      content: trimmed,
      score: 1
    });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

function localFallbackSearch(localPath: string | undefined, pattern: string, limit: number): ZoektSearchHit[] {
  if (!localPath || !fs.existsSync(localPath)) {
    return [];
  }
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const hits: ZoektSearchHit[] = [];
  walkFiles(localPath, (filePath) => {
    if (hits.length >= limit) {
      return false;
    }
    if (!isTextCandidate(filePath)) {
      return true;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]?.toLowerCase().includes(normalized)) {
          hits.push({
            fileName: path.relative(localPath, filePath),
            lineNumber: index + 1,
            content: lines[index] ?? "",
            score: 0.5
          });
          if (hits.length >= limit) {
            return false;
          }
        }
      }
    } catch {
      // skip unreadable files
    }
    return true;
  });
  return hits;
}

function walkFiles(root: string, visitor: (filePath: string) => boolean): void {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (!visitor(fullPath)) {
        return;
      }
    }
  }
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
    ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml"
  ].includes(ext);
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [name], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

function formatExecError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}.`;
}

function manifestLocalPath(repoId: string): string | undefined {
  const manifestPath = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    ".coopai",
    "indexes",
    sanitizeRepoId(repoId),
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as IndexManifest;
    return manifest.localPath;
  } catch {
    return undefined;
  }
}
