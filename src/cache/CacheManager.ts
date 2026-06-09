import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

export type CacheCategory =
  | "fileContent"
  | "commitHistory"
  | "tree"
  | "search"
  | "blame"
  | "prIssue"
  | "repoMetadata";

export type CacheEntry<T> = {
  key: string;
  category: CacheCategory;
  data: T;
  storedAt: number;
  expiresAt: number;
};

export type CacheGetResult<T> = {
  data: T;
  stale: boolean;
  ageMs: number;
};

const TTL_MS: Record<CacheCategory, number> = {
  fileContent: 30 * 60 * 1000,
  commitHistory: 15 * 60 * 1000,
  tree: 15 * 60 * 1000,
  search: 5 * 60 * 1000,
  blame: 60 * 60 * 1000,
  prIssue: 5 * 60 * 1000,
  repoMetadata: 60 * 60 * 1000
};

const DISK_MAX_ENTRIES = 200;

export type CacheManagerOptions = {
  storageUri?: vscode.Uri;
  now?: () => number;
  enableDisk?: boolean;
};

export class CacheManager {
  private readonly memory = new Map<string, CacheEntry<unknown>>();
  private readonly diskIndex = new Map<string, string>();
  private readonly now: () => number;
  private readonly storageDir?: string;
  private readonly enableDisk: boolean;

  public constructor(options: CacheManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.enableDisk = options.enableDisk ?? Boolean(options.storageUri);
    if (options.storageUri && this.enableDisk) {
      this.storageDir = path.join(options.storageUri.fsPath, "code-host-cache");
    }
  }

  public async initialize(): Promise<void> {
    if (!this.storageDir) {
      return;
    }
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  public buildKey(parts: Array<string | number | undefined>): string {
    return parts.filter((part) => part !== undefined && part !== "").join(":");
  }

  public async get<T>(key: string, options?: { allowStale?: boolean }): Promise<CacheGetResult<T> | undefined> {
    const allowStale = options?.allowStale ?? true;
    const fromMemory = this.readEntry<T>(this.memory.get(key), allowStale);
    if (fromMemory) {
      return fromMemory;
    }
    if (!this.storageDir) {
      return undefined;
    }
    const filePath = this.diskIndex.get(key) ?? path.join(this.storageDir, `${hashKey(key)}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const entry = JSON.parse(raw) as CacheEntry<T>;
      this.memory.set(key, entry);
      this.diskIndex.set(key, filePath);
      return this.readEntry(entry, allowStale);
    } catch {
      return undefined;
    }
  }

  public async set<T>(key: string, category: CacheCategory, data: T): Promise<void> {
    const storedAt = this.now();
    const entry: CacheEntry<T> = {
      key,
      category,
      data,
      storedAt,
      expiresAt: storedAt + TTL_MS[category]
    };
    this.memory.set(key, entry as CacheEntry<unknown>);
    if (!this.storageDir || !this.enableDisk) {
      return;
    }
    await fs.mkdir(this.storageDir, { recursive: true });
    const filePath = path.join(this.storageDir, `${hashKey(key)}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry), "utf-8");
    this.diskIndex.set(key, filePath);
    await this.trimDiskIfNeeded();
  }

  public async delete(key: string): Promise<void> {
    this.memory.delete(key);
    const filePath = this.diskIndex.get(key);
    if (filePath) {
      await fs.rm(filePath, { force: true });
      this.diskIndex.delete(key);
    }
  }

  public async clear(): Promise<void> {
    this.memory.clear();
    if (!this.storageDir) {
      return;
    }
    const files = await fs.readdir(this.storageDir).catch(() => []);
    await Promise.all(files.map((file) => fs.rm(path.join(this.storageDir!, file), { force: true })));
    this.diskIndex.clear();
  }

  private readEntry<T>(entry: CacheEntry<unknown> | undefined, allowStale: boolean): CacheGetResult<T> | undefined {
    if (!entry) {
      return undefined;
    }
    const ageMs = this.now() - entry.storedAt;
    const expired = this.now() > entry.expiresAt;
    if (expired && !allowStale) {
      return undefined;
    }
    return {
      data: entry.data as T,
      stale: expired,
      ageMs
    };
  }

  private async trimDiskIfNeeded(): Promise<void> {
    if (!this.storageDir || this.diskIndex.size <= DISK_MAX_ENTRIES) {
      return;
    }
    const entries = [...this.memory.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
    const removeCount = entries.length - DISK_MAX_ENTRIES;
    for (let i = 0; i < removeCount; i += 1) {
      const [key] = entries[i];
      await this.delete(key);
    }
  }
}

function hashKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return `k${Math.abs(hash)}`;
}
