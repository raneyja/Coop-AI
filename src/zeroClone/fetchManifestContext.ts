import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { RepoCoordinates } from "../api/codeHosts/types";
import { topManifestPaths } from "../manifest/scoreManifest";
import type { EditorContext, ManifestFileEntry } from "../manifest/types";

export const ZERO_CLONE_MAX_FILES = 3;

export type ManifestFileSnippet = {
  path: string;
  content: string;
  encoding?: string;
  stale?: boolean;
};

export type ZeroCloneManifestContext = {
  source: "zero-clone-manifest";
  repoId: string;
  query: string;
  rankedPaths: string[];
  files: ManifestFileSnippet[];
  manifestFileCount: number;
};

export type FetchZeroCloneManifestContextOptions = {
  query: string;
  editorContext: EditorContext;
  repoId: string;
  coords?: Partial<RepoCoordinates>;
  loadManifest: (repoId: string) => Promise<ManifestFileEntry[]>;
  codeHostRouter: CodeHostRouter;
  maxFiles?: number;
};

/**
 * Score the structure manifest, fetch up to `maxFiles` file bodies via the code host API,
 * and return ephemeral context for the current LLM request. File bodies are not persisted.
 */
export async function fetchZeroCloneManifestContext(
  options: FetchZeroCloneManifestContextOptions
): Promise<ZeroCloneManifestContext | undefined> {
  const maxFiles = options.maxFiles ?? ZERO_CLONE_MAX_FILES;
  const manifest = await options.loadManifest(options.repoId);
  if (manifest.length === 0) {
    return undefined;
  }

  const rankedPaths = topManifestPaths(options.query, options.editorContext, manifest, maxFiles);
  if (rankedPaths.length === 0) {
    return undefined;
  }

  const files: ManifestFileSnippet[] = [];
  for (const path of rankedPaths) {
    try {
      const remote = await options.codeHostRouter.getFileContent(path, options.coords);
      if (remote.content) {
        files.push({
          path: remote.path,
          content: remote.content,
          encoding: remote.encoding
        });
      }
    } catch {
      // Skip files that fail to fetch; remaining snippets still help the model.
    }
  }

  return {
    source: "zero-clone-manifest",
    repoId: options.repoId,
    query: options.query,
    rankedPaths,
    files,
    manifestFileCount: manifest.length
  };
}
