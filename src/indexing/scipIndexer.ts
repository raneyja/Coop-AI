import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { IndexManifest, ScipReference, ScipSymbol } from "./types";

const execFileAsync = promisify(execFile);

const SCIP_INDEXERS: Array<{ languages: string[]; command: string; args: (root: string, out: string) => string[] }> = [
  {
    languages: ["typescript", "javascript", "tsx", "jsx"],
    command: "scip-typescript",
    args: (root, out) => ["index", "--output", out, root]
  },
  {
    languages: ["python"],
    command: "scip-python",
    args: (root, out) => ["index", root, "--output", out]
  },
  {
    languages: ["go"],
    command: "scip-go",
    args: (root, out) => ["--output", out, root]
  },
  {
    languages: ["java", "kotlin"],
    command: "scip-java",
    args: (root, out) => ["index", "--output", out, root]
  }
];

export type ScipIndexerOptions = {
  indexesRoot: string;
};

export class ScipIndexer {
  public constructor(private readonly options: ScipIndexerOptions) {}

  public indexPathFor(repoId: string): string {
    return path.join(this.options.indexesRoot, sanitizeRepoId(repoId), "scip", "index.scip");
  }

  public async isAvailable(language?: string): Promise<boolean> {
    return Boolean(await this.resolveIndexer(language));
  }

  public async buildIndex(manifest: IndexManifest, language?: string): Promise<IndexManifest> {
    const indexer = await this.resolveIndexer(language);
    if (!indexer) {
      return {
        ...manifest,
        scipAvailable: false,
        status: manifest.zoektAvailable ? manifest.status : "error",
        error: manifest.error ?? "No SCIP indexer found on PATH for this repository language."
      };
    }

    const outPath = this.indexPathFor(manifest.repoId);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    try {
      await execFileAsync(indexer.command, indexer.args(manifest.localPath, outPath), {
        timeout: 900_000,
        maxBuffer: 20 * 1024 * 1024,
        cwd: manifest.localPath
      });
      return {
        ...manifest,
        scipIndexPath: outPath,
        scipAvailable: true,
        status: manifest.zoektAvailable ? "ready" : "ready",
        error: undefined
      };
    } catch (error) {
      return {
        ...manifest,
        scipAvailable: false,
        status: manifest.zoektAvailable ? manifest.status : "error",
        error: formatExecError("SCIP indexing failed", error)
      };
    }
  }

  public async findSymbols(repoId: string, query: string, limit = 30): Promise<ScipSymbol[]> {
    const indexPath = this.indexPathFor(repoId);
    if (!fs.existsSync(indexPath)) {
      return [];
    }

    const scipBinary = await resolveScipBinary();
    if (!scipBinary) {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(scipBinary, ["print", indexPath], {
        timeout: 30_000,
        maxBuffer: 20 * 1024 * 1024
      });
      return parseScipPrintOutput(stdout, query, limit);
    } catch {
      return [];
    }
  }

  public async findDependents(repoId: string, file: string): Promise<string[]> {
    const indexPath = this.indexPathFor(repoId);
    if (!fs.existsSync(indexPath)) {
      return [];
    }

    const scipBinary = await resolveScipBinary();
    if (!scipBinary) {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(scipBinary, ["print", indexPath], {
        timeout: 30_000,
        maxBuffer: 20 * 1024 * 1024
      });
      return parseDependentsFromScip(stdout, file);
    } catch {
      return [];
    }
  }

  public async getReferences(repoId: string, symbol: string, limit = 50): Promise<ScipReference[]> {
    const indexPath = this.indexPathFor(repoId);
    if (!fs.existsSync(indexPath)) {
      return [];
    }
    const scipBinary = await resolveScipBinary();
    if (!scipBinary) {
      return [];
    }
    try {
      const { stdout } = await execFileAsync(scipBinary, ["print", indexPath], {
        timeout: 30_000,
        maxBuffer: 20 * 1024 * 1024
      });
      return parseReferencesFromScip(stdout, symbol, limit);
    } catch {
      return [];
    }
  }

  private async resolveIndexer(language?: string) {
    for (const candidate of SCIP_INDEXERS) {
      if (language && !candidate.languages.includes(language.toLowerCase())) {
        continue;
      }
      if (await commandExists(candidate.command)) {
        return candidate;
      }
    }
    if (language) {
      return undefined;
    }
    for (const candidate of SCIP_INDEXERS) {
      if (await commandExists(candidate.command)) {
        return candidate;
      }
    }
    return undefined;
  }
}

function sanitizeRepoId(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseScipPrintOutput(stdout: string, query: string, limit: number): ScipSymbol[] {
  const normalized = query.trim().toLowerCase();
  const symbols: ScipSymbol[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(" ")) {
      continue;
    }
    const symbol = parseScipLine(trimmed);
    if (!symbol) {
      continue;
    }
    if (
      !normalized ||
      symbol.displayName.toLowerCase().includes(normalized) ||
      symbol.file.toLowerCase().includes(normalized)
    ) {
      symbols.push(symbol);
    }
    if (symbols.length >= limit) {
      break;
    }
  }
  return symbols;
}

function parseScipLine(line: string): ScipSymbol | undefined {
  const match = line.match(/^symbol\s+(\S+)\s+(\S+)\s+(\d+):(\d+)\s+(.+)$/i);
  if (!match) {
    const fallback = line.match(/(\S+\.(?:ts|tsx|js|jsx|py|go|java|kt)):(\d+):(\d+)\s+(.+)/);
    if (!fallback) {
      return undefined;
    }
    return {
      symbol: fallback[4] ?? line,
      kind: "unknown",
      file: fallback[1] ?? "",
      line: Number(fallback[2]) || 1,
      character: Number(fallback[3]) || 0,
      displayName: fallback[4] ?? line
    };
  }
  return {
    symbol: match[1] ?? line,
    kind: match[2] ?? "unknown",
    file: "",
    line: Number(match[3]) || 1,
    character: Number(match[4]) || 0,
    displayName: match[5] ?? line
  };
}

function parseDependentsFromScip(stdout: string, file: string): string[] {
  const normalizedFile = file.replace(/\\/g, "/");
  const dependents = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.toLowerCase();
    if (!trimmed.includes("reference") || !trimmed.includes(normalizedFile.toLowerCase())) {
      continue;
    }
    const fileMatch = line.match(/(\S+\.(?:ts|tsx|js|jsx|py|go|java|kt))/i);
    if (fileMatch?.[1]) {
      dependents.add(fileMatch[1]);
    }
  }
  return [...dependents];
}

function parseReferencesFromScip(stdout: string, symbol: string, limit: number): ScipReference[] {
  const normalized = symbol.toLowerCase();
  const refs: ScipReference[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.toLowerCase().includes(normalized)) {
      continue;
    }
    refs.push({
      fromSymbol: line,
      toSymbol: symbol,
      kind: "reference"
    });
    if (refs.length >= limit) {
      break;
    }
  }
  return refs;
}

async function resolveScipBinary(): Promise<string | undefined> {
  for (const name of ["scip", "scip-cli"]) {
    if (await commandExists(name)) {
      return name;
    }
  }
  return undefined;
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
