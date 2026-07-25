import * as fs from "node:fs";
import * as path from "node:path";

/** Skip pathological files so one vendored bundle cannot stall an index job. */
export const MAX_LINE_COUNT_FILE_BYTES = 2 * 1024 * 1024;

/** Languages reported alongside counts, most files first. */
const MAX_REPORTED_LANGUAGES = 8;

export type RepoStatsFileInput = { path: string; size: number };

export type CollectedRepoStats = {
  fileCount: number;
  lineCount: number;
  byteCount: number;
  languages: string[];
  /** Files counted for size but skipped for line counting (too large / unreadable). */
  skippedFiles: number;
};

export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      lines++;
    }
  }
  return content.endsWith("\n") ? lines : lines + 1;
}

/**
 * Measure the repository from the transient index clone. Runs before the clone
 * is deleted so chat can answer "how many files / lines" from a stored fact
 * instead of guessing.
 */
export function collectRepoStats(
  rootPath: string,
  files: RepoStatsFileInput[],
  readFile: (absolutePath: string) => string = (absolutePath) =>
    fs.readFileSync(absolutePath, "utf8")
): CollectedRepoStats {
  let lineCount = 0;
  let byteCount = 0;
  let skippedFiles = 0;
  const languageCounts = new Map<string, number>();

  for (const file of files) {
    byteCount += Number.isFinite(file.size) ? file.size : 0;

    const extension = path.extname(file.path).toLowerCase().replace(/^\./, "");
    if (extension) {
      languageCounts.set(extension, (languageCounts.get(extension) ?? 0) + 1);
    }

    if (file.size > MAX_LINE_COUNT_FILE_BYTES) {
      skippedFiles++;
      continue;
    }

    try {
      lineCount += countLines(readFile(path.join(rootPath, file.path)));
    } catch {
      skippedFiles++;
    }
  }

  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REPORTED_LANGUAGES)
    .map(([extension]) => extension);

  return {
    fileCount: files.length,
    lineCount,
    byteCount,
    languages,
    skippedFiles
  };
}
