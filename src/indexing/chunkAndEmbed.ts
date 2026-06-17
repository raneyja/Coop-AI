import * as fs from "node:fs";
import * as path from "node:path";
import type { Pool } from "pg";
import { JobCancelledError } from "../jobs/errorHandling";
import { embedTexts, splitEmbeddingBatches } from "./embeddingsClient";
import { yieldToEventLoop } from "./eventLoopYield";
import { RepoEmbeddingsStore, type EmbeddingInsertRow } from "./repoEmbeddingsStore";
import { RepoSymbolIndexStore } from "./repoSymbolIndexStore";
import { chunkFileSource, listEmbeddableFiles, type TextChunk } from "./treeSitterChunker";

const MAX_FILE_BYTES = 512 * 1024;
const FILE_YIELD_INTERVAL = 20;

export type ChunkAndEmbedResult = {
  embeddedFiles: number;
  chunkCount: number;
  skippedSymbolFiles: number;
  skippedLargeFiles: number;
};

export type ChunkAndEmbedOptions = {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void | Promise<void>;
};

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new JobCancelledError();
  }
}

export async function chunkAndEmbed(
  repoId: string,
  orgId: string,
  localPath: string,
  pool: Pool,
  options: ChunkAndEmbedOptions = {}
): Promise<ChunkAndEmbedResult> {
  const symbolStore = new RepoSymbolIndexStore(pool);
  const embeddingStore = new RepoEmbeddingsStore(pool);
  const symbolCoveredFiles = await symbolStore.loadCoveredFilePaths(orgId, repoId);

  const pendingChunks: TextChunk[] = [];
  let skippedSymbolFiles = 0;
  let skippedLargeFiles = 0;
  let embeddedFiles = 0;

  const files = listEmbeddableFiles(localPath);
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    assertNotAborted(options.signal);
    if (fileIndex > 0 && fileIndex % FILE_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
      await options.onProgress?.(0.05 + (0.45 * fileIndex) / Math.max(files.length, 1));
    }

    const filePath = files[fileIndex];
    if (symbolCoveredFiles.has(filePath)) {
      skippedSymbolFiles += 1;
      continue;
    }

    const absolutePath = path.join(localPath, filePath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    if (source.includes("\0")) {
      skippedLargeFiles += 1;
      continue;
    }

    const fileChunks = await chunkFileSource(filePath, source);
    if (fileChunks.length === 0) {
      continue;
    }
    pendingChunks.push(...fileChunks);
    embeddedFiles += 1;
  }

  if (pendingChunks.length === 0) {
    await embeddingStore.replaceForRepo(orgId, repoId, [], new Date());
    return {
      embeddedFiles: 0,
      chunkCount: 0,
      skippedSymbolFiles,
      skippedLargeFiles
    };
  }

  const texts = pendingChunks.map((chunk) => chunk.text);
  const batches = splitEmbeddingBatches(texts);
  const vectors: number[][] = new Array(texts.length);
  let offset = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    assertNotAborted(options.signal);
    const batch = batches[batchIndex];
    const batchEmbeddings = await embedTexts(batch, { pool });
    for (let i = 0; i < batchEmbeddings.length; i += 1) {
      vectors[offset + i] = batchEmbeddings[i];
    }
    offset += batch.length;
    await yieldToEventLoop();
    await options.onProgress?.(0.5 + (0.45 * (batchIndex + 1)) / Math.max(batches.length, 1));
  }

  const createdAt = new Date();
  const rows: EmbeddingInsertRow[] = pendingChunks.map((chunk, index) => ({
    filePath: chunk.filePath,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.text,
    embedding: vectors[index]
  }));

  await embeddingStore.replaceForRepo(orgId, repoId, rows, createdAt);

  return {
    embeddedFiles,
    chunkCount: rows.length,
    skippedSymbolFiles,
    skippedLargeFiles
  };
}
