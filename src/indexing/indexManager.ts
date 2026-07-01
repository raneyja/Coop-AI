import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { LightningConfiguration } from "../config/lightningConfig";
import { isLightningEnabledForRepo, readLightningConfiguration } from "../config/lightningConfig";
import type { LicenseStatus } from "../license/licenseChecker";
import { resolveLicenseStatus, canUseLightningMode } from "../license/licenseChecker";
import { findLocalClone } from "../workspace/repoEditorOpener";
import { ScipIndexer } from "./scipIndexer";
import type { IndexManifest, LocalDependentsResult, LocalSearchResult } from "./types";
import { ZoektIndexer } from "./zoektIndexer";

const execFileAsync = promisify(execFile);

export type IndexManagerOptions = {
  reposRoot?: string;
  indexesRoot?: string;
  secrets?: import("vscode").SecretStorage;
};

export type RepoIndexRef = {
  repoId: string;
  owner: string;
  repo: string;
  branch?: string;
  provider?: "github" | "gitlab" | "bitbucket";
};

const DEFAULT_REPOS_ROOT = path.join(os.homedir(), ".coopai", "repos");
const DEFAULT_INDEXES_ROOT = path.join(os.homedir(), ".coopai", "indexes");

export class IndexManager {
  private readonly reposRoot: string;
  private readonly indexesRoot: string;
  private readonly zoekt: ZoektIndexer;
  private readonly scip: ScipIndexer;
  private licenseCache?: { at: number; status: LicenseStatus };
  private readonly indexingLocks = new Map<string, Promise<IndexManifest>>();

  public constructor(private readonly options: IndexManagerOptions = {}) {
    this.reposRoot = options.reposRoot ?? DEFAULT_REPOS_ROOT;
    this.indexesRoot = options.indexesRoot ?? DEFAULT_INDEXES_ROOT;
    this.zoekt = new ZoektIndexer({ indexesRoot: this.indexesRoot });
    this.scip = new ScipIndexer({ indexesRoot: this.indexesRoot });
    fs.mkdirSync(this.reposRoot, { recursive: true });
    fs.mkdirSync(this.indexesRoot, { recursive: true });
  }

  public async getLicenseStatus(): Promise<LicenseStatus> {
    const now = Date.now();
    if (this.licenseCache && now - this.licenseCache.at < 30_000) {
      return this.licenseCache.status;
    }
    const status = await resolveLicenseStatus(this.options.secrets);
    this.licenseCache = { at: now, status };
    return status;
  }

  public async isEnabledForRepo(repoId?: string): Promise<boolean> {
    if (!repoId) {
      return false;
    }
    const license = await this.getLicenseStatus();
    return isLightningEnabledForRepo(repoId, license);
  }

  public manifestPath(repoId: string): string {
    return path.join(this.indexesRoot, sanitizeRepoId(repoId), "manifest.json");
  }

  public readManifest(repoId: string): IndexManifest | undefined {
    const manifestPath = this.manifestPath(repoId);
    if (!fs.existsSync(manifestPath)) {
      return undefined;
    }
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as IndexManifest;
    } catch {
      return undefined;
    }
  }

  public writeManifest(manifest: IndexManifest): void {
    const dir = path.dirname(this.manifestPath(manifest.repoId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.manifestPath(manifest.repoId), JSON.stringify(manifest, null, 2), "utf8");
  }

  public async enableRepo(ref: RepoIndexRef, localPath?: string): Promise<IndexManifest> {
    const license = await this.getLicenseStatus();
    if (!canUseLightningMode(license)) {
      throw new Error("Lightning Mode requires an active Coop account.");
    }

    const config = readLightningConfiguration();
    const resolvedPath =
      localPath ??
      (await findLocalClone(ref.owner, ref.repo, ref.provider)) ??
      path.join(this.reposRoot, sanitizeRepoId(ref.repoId));

    const manifest: IndexManifest = {
      repoId: ref.repoId,
      owner: ref.owner,
      repo: ref.repo,
      branch: ref.branch ?? "main",
      localPath: resolvedPath,
      indexVersion: (this.readManifest(ref.repoId)?.indexVersion ?? 0) + 1,
      diskUsageBytes: 0,
      zoektAvailable: false,
      scipAvailable: false,
      status: "idle"
    };
    this.writeManifest(manifest);

    const { setRepoLightningEnabled } = await import("../config/lightningConfig");
    await setRepoLightningEnabled(ref.repoId, true, resolvedPath);

    if (config.autoIndexOnEnable) {
      return this.indexRepo(ref, resolvedPath);
    }
    return manifest;
  }

  public async disableRepo(repoId: string): Promise<void> {
    const { setRepoLightningEnabled } = await import("../config/lightningConfig");
    await setRepoLightningEnabled(repoId, false);
    const manifest = this.readManifest(repoId);
    if (manifest) {
      this.writeManifest({ ...manifest, status: "disabled" });
    }
  }

  public async indexRepo(ref: RepoIndexRef, localPath?: string): Promise<IndexManifest> {
    const existing = this.indexingLocks.get(ref.repoId);
    if (existing) {
      return existing;
    }

    const task = this.runIndex(ref, localPath).finally(() => {
      this.indexingLocks.delete(ref.repoId);
    });
    this.indexingLocks.set(ref.repoId, task);
    return task;
  }

  private async runIndex(ref: RepoIndexRef, localPath?: string): Promise<IndexManifest> {
    const enabled = await this.isEnabledForRepo(ref.repoId);
    if (!enabled) {
      const manifest = this.readManifest(ref.repoId);
      if (manifest) {
        return manifest;
      }
      throw new Error("Lightning Mode is not enabled for this repository.");
    }

    let manifest: IndexManifest = {
      repoId: ref.repoId,
      owner: ref.owner,
      repo: ref.repo,
      branch: ref.branch ?? "main",
      localPath:
        localPath ??
        this.readManifest(ref.repoId)?.localPath ??
        (await findLocalClone(ref.owner, ref.repo, ref.provider)) ??
        path.join(this.reposRoot, sanitizeRepoId(ref.repoId)),
      indexVersion: (this.readManifest(ref.repoId)?.indexVersion ?? 0) + 1,
      diskUsageBytes: 0,
      zoektAvailable: false,
      scipAvailable: false,
      status: "indexing"
    };
    this.writeManifest(manifest);

    if (!fs.existsSync(manifest.localPath)) {
      manifest = { ...manifest, status: "cloning" };
      this.writeManifest(manifest);
      await this.ensureClone(ref, manifest.localPath);
    }

    await this.pullLatest(manifest.localPath);

    manifest = await this.zoekt.buildIndex(manifest);
    manifest = await this.scip.buildIndex(manifest, detectLanguage(manifest.localPath));

    manifest = {
      ...manifest,
      lastIndexedAt: new Date().toISOString(),
      lastCommit: await readHeadCommit(manifest.localPath),
      diskUsageBytes: measureDiskUsage(manifest),
      status: manifest.zoektAvailable || manifest.scipAvailable ? "ready" : "error"
    };
    this.writeManifest(manifest);
    return manifest;
  }

  public async incrementalUpdate(repoId: string): Promise<IndexManifest | undefined> {
    const manifest = this.readManifest(repoId);
    if (!manifest || !(await this.isEnabledForRepo(repoId))) {
      return manifest;
    }
    const head = await readHeadCommit(manifest.localPath);
    if (head && head === manifest.lastCommit) {
      return manifest;
    }
    const [owner, repo] = parseRepoId(repoId);
    return this.indexRepo({ repoId, owner, repo, branch: manifest.branch });
  }

  public async search(repoId: string, pattern: string): Promise<LocalSearchResult> {
    if (!(await this.isEnabledForRepo(repoId))) {
      return { source: "fallback", hits: [], symbols: [], stale: false };
    }

    const manifest = this.readManifest(repoId);
    const [hits, symbols] = await Promise.all([
      this.zoekt.search(repoId, pattern),
      this.scip.findSymbols(repoId, pattern)
    ]);

    return {
      source: hits.length > 0 ? "zoekt" : symbols.length > 0 ? "scip" : "fallback",
      hits,
      symbols,
      stale: Boolean(manifest?.lastIndexedAt && Date.now() - Date.parse(manifest.lastIndexedAt) > 86_400_000)
    };
  }

  public async dependents(repoId: string, file: string): Promise<LocalDependentsResult> {
    if (!(await this.isEnabledForRepo(repoId))) {
      return { file, dependents: [], source: "remote" };
    }
    const local = await this.scip.findDependents(repoId, file);
    return {
      file,
      dependents: local,
      source: local.length > 0 ? "scip" : "remote"
    };
  }

  public listIndexedRepos(): IndexManifest[] {
    if (!fs.existsSync(this.indexesRoot)) {
      return [];
    }
    const manifests: IndexManifest[] = [];
    for (const entry of fs.readdirSync(this.indexesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(this.indexesRoot, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      try {
        manifests.push(JSON.parse(fs.readFileSync(manifestPath, "utf8")) as IndexManifest);
      } catch {
        // skip corrupt manifests
      }
    }
    return manifests;
  }

  public summarize(config: LightningConfiguration = readLightningConfiguration()): {
    enabledRepos: number;
    totalDiskBytes: number;
    readyRepos: number;
    indexingRepos: number;
  } {
    const manifests = this.listIndexedRepos();
    const enabled = manifests.filter((manifest) =>
      config.repos.some((repo) => repo.repoId === manifest.repoId && repo.enabled)
    );
    return {
      enabledRepos: enabled.length,
      totalDiskBytes: enabled.reduce((sum, manifest) => sum + (manifest.diskUsageBytes ?? 0), 0),
      readyRepos: enabled.filter((manifest) => manifest.status === "ready").length,
      indexingRepos: enabled.filter((manifest) => manifest.status === "indexing" || manifest.status === "cloning").length
    };
  }

  private async ensureClone(ref: RepoIndexRef, targetPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const remote = defaultCloneUrl(ref);
    await execFileAsync("git", ["clone", "--depth", "1", remote, targetPath], {
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024
    });
  }

  private async pullLatest(localPath: string): Promise<void> {
    if (!fs.existsSync(path.join(localPath, ".git"))) {
      return;
    }
    try {
      await execFileAsync("git", ["-C", localPath, "pull", "--ff-only"], {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch {
      // non-fatal — index whatever is on disk
    }
  }
}

function sanitizeRepoId(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseRepoId(repoId: string): [string, string] {
  const slash = repoId.includes(":") ? repoId.split(":")[1] : repoId;
  const parts = (slash ?? repoId).split("/");
  return [parts[0] ?? "unknown", parts[1] ?? "repo"];
}

function defaultCloneUrl(ref: RepoIndexRef): string {
  const host =
    ref.provider === "gitlab"
      ? "gitlab.com"
      : ref.provider === "bitbucket"
        ? "bitbucket.org"
        : "github.com";
  return `https://${host}/${ref.owner}/${ref.repo}.git`;
}

async function readHeadCommit(localPath: string): Promise<string | undefined> {
  if (!fs.existsSync(path.join(localPath, ".git"))) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("git", ["-C", localPath, "rev-parse", "HEAD"], {
      timeout: 10_000
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function detectLanguage(localPath: string): string | undefined {
  const markers: Array<[string, string]> = [
    ["tsconfig.json", "typescript"],
    ["package.json", "typescript"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["go.mod", "go"],
    ["pom.xml", "java"],
    ["build.gradle", "java"]
  ];
  for (const [file, language] of markers) {
    if (fs.existsSync(path.join(localPath, file))) {
      return language;
    }
  }
  return undefined;
}

function measureDiskUsage(manifest: IndexManifest): number {
  let total = 0;
  for (const target of [manifest.localPath, manifest.zoektIndexPath, manifest.scipIndexPath]) {
    if (target && fs.existsSync(target)) {
      total += directorySize(target);
    }
  }
  return total;
}

function directorySize(root: string): number {
  let total = 0;
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
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        try {
          total += fs.statSync(fullPath).size;
        } catch {
          // skip
        }
      }
    }
  }
  return total;
}

let sharedManager: IndexManager | undefined;

export function getIndexManager(options?: IndexManagerOptions): IndexManager {
  if (!sharedManager) {
    sharedManager = new IndexManager(options);
  }
  return sharedManager;
}

export function resetIndexManagerForTests(): void {
  sharedManager = undefined;
}
