import * as fs from "node:fs";
import * as path from "node:path";
import type { Pool } from "pg";
import { embedTexts } from "./embeddingsClient";
import { RepoEmbeddingsStore, type EmbeddingInsertRow } from "./repoEmbeddingsStore";
import { RepoSymbolIndexStore } from "./repoSymbolIndexStore";
import { chunkFileSource, listEmbeddableFiles, type TextChunk } from "./treeSitterChunker";

const MAX_FILE_BYTES = 512 * 1024;

export type ChunkAndEmbedResult = {
  embeddedFiles: number;
  chunkCount: number;
  skippedSymbolFiles: number;
  skippedLargeFiles: number;
};

export async function chunkAndEmbed(
  repoId: string,
  orgId: string,
  localPath: string,
  pool: Pool
): Promise<ChunkAndEmbedResult> {
  const symbolStore = new RepoSymbolIndexStore(pool);
  const embeddingStore = new RepoEmbeddingsStore(pool);
  const symbolRows = await symbolStore.loadRows(orgId, repoId);
  const symbolCoveredFiles = new Set(symbolRows.map((row) => row.filePath));

  const pendingChunks: TextChunk[] = [];
  let skippedSymbolFiles = 0;
  let skippedLargeFiles = 0;
  let embeddedFiles = 0;

  for (const filePath of listEmbeddableFiles(localPath)) {
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

  const vectors = await embedTexts(pendingChunks.map((chunk) => chunk.text));
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
