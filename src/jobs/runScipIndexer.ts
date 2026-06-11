import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { RepoSymbolIndexStore } from "../indexing/repoSymbolIndexStore";
import { decodeScipIndexFile } from "./scipIndexDecoder";
import { extractTreeSitterSymbols } from "./treeSitterSymbolExtractor";

const execFileAsync = promisify(execFile);

const SCIP_INDEXERS: Array<{
  languages: string[];
  command: string;
  args: (root: string, out: string) => string[];
  indexQuality: "precise" | "heuristic";
}> = [
  {
    languages: ["typescript", "javascript", "tsx", "jsx"],
    command: "scip-typescript",
    args: (root, out) => ["index", "--output", out, root],
    indexQuality: "precise"
  },
  {
    languages: ["python"],
    command: "scip-python",
    args: (root, out) => ["index", root, "--output", out],
    indexQuality: "precise"
  },
  {
    languages: ["go"],
    command: "scip-go",
    args: (root, out) => ["--output", out, root],
    indexQuality: "precise"
  },
  {
    languages: ["java", "kotlin"],
    command: "scip-java",
    args: (root, out) => ["index", "--output", out, "--targetroot", root],
    indexQuality: "precise"
  }
];

export type RunScipIndexerResult = {
  scipAvailable: boolean;
  symbolCount: number;
  source: "scip" | "tree-sitter" | "none";
  language?: string;
  indexQuality: "precise" | "heuristic" | "none";
  error?: string;
};

export async function runScipIndexer(
  repoId: string,
  orgId: string,
  language: string | undefined,
  localPath: string,
  pool: Pool
): Promise<RunScipIndexerResult> {
  const store = new RepoSymbolIndexStore(pool);
  const indexedAt = new Date();
  const resolvedLanguage = language ?? detectLanguage(localPath);

  const indexer = await resolveIndexer(resolvedLanguage);
  if (indexer) {
    const indexPath = path.join(localPath, "index.scip");
    try {
      await execFileAsync(indexer.command, indexer.args(localPath, indexPath), {
        timeout: 900_000,
        maxBuffer: 20 * 1024 * 1024,
        cwd: localPath
      });

      if (fs.existsSync(indexPath)) {
        const rows = decodeScipIndexFile(indexPath);
        await store.replaceIndex(orgId, repoId, rows, indexedAt);
        fs.rmSync(indexPath, { force: true });
        return {
          scipAvailable: true,
          symbolCount: rows.length,
          source: "scip",
          language: resolvedLanguage,
          indexQuality: indexer.indexQuality
        };
      }

      return {
        scipAvailable: false,
        symbolCount: 0,
        source: "none",
        language: resolvedLanguage,
        indexQuality: "none",
        error: "SCIP indexer completed but index.scip was not produced."
      };
    } catch (error) {
      const message = formatExecError("SCIP indexing failed", error);
      const fallbackRows = await safeTreeSitterFallback(localPath);
      if (fallbackRows.length > 0) {
        await store.replaceIndex(orgId, repoId, fallbackRows, indexedAt);
        return {
          scipAvailable: false,
          symbolCount: fallbackRows.length,
          source: "tree-sitter",
          language: resolvedLanguage,
          indexQuality: "heuristic",
          error: message
        };
      }
      return {
        scipAvailable: false,
        symbolCount: 0,
        source: "none",
        language: resolvedLanguage,
        indexQuality: "none",
        error: message
      };
    }
  }

  const fallbackRows = await safeTreeSitterFallback(localPath);
  await store.replaceIndex(orgId, repoId, fallbackRows, indexedAt);
  return {
    scipAvailable: false,
    symbolCount: fallbackRows.length,
    source: fallbackRows.length > 0 ? "tree-sitter" : "none",
    language: resolvedLanguage,
    indexQuality: fallbackRows.length > 0 ? "heuristic" : "none",
    error: resolvedLanguage
      ? `No SCIP indexer found on PATH for language "${resolvedLanguage}".`
      : "No SCIP indexer found on PATH and language could not be detected."
  };
}

async function resolveIndexer(language?: string) {
  for (const candidate of SCIP_INDEXERS) {
    if (language && !candidate.languages.includes(language.toLowerCase())) {
      continue;
    }
    if (await commandExists(candidate.command)) {
      return candidate;
    }
  }
  return undefined;
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [name], {
      timeout: 3_000
    });
    return true;
  } catch {
    return false;
  }
}

function detectLanguage(localPath: string): string | undefined {
  const markers: Array<[string, string]> = [
    ["go.mod", "go"],
    ["tsconfig.json", "typescript"],
    ["package.json", "typescript"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["setup.py", "python"],
    ["pom.xml", "java"],
    ["build.gradle.kts", "kotlin"],
    ["build.gradle", "java"],
    ["Cargo.toml", "rust"]
  ];
  for (const [file, lang] of markers) {
    if (fs.existsSync(path.join(localPath, file))) {
      return lang;
    }
  }
  return undefined;
}

async function safeTreeSitterFallback(localPath: string): Promise<Awaited<ReturnType<typeof extractTreeSitterSymbols>>> {
  try {
    return await extractTreeSitterSymbols(localPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tree-sitter fallback failed";
    console.warn(`[scip] tree-sitter fallback skipped: ${message}`);
    return [];
  }
}

function formatExecError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}.`;
}
