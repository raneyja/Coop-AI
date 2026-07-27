import type { CodeHostProvider } from "../api/codeHosts/types";

/**
 * Evidence kinds produced by {@link IndexedRepoWorkspace}. Prompts key off these
 * so "authoritative total" and "retrieval sample" can never be confused.
 */

/**
 * Where an inventory number came from, best first.
 * - `index-stats`: durable stats recorded by INDEX_REPOSITORY (files + lines)
 * - `manifest`: legacy structure manifest rows (files only)
 * - `tree`: live recursive code-host tree count (files only)
 */
export type RepoInventorySource = "index-stats" | "manifest" | "tree" | "unavailable";

export type RepoInventoryEvidence = {
  source: RepoInventorySource;
  /** Branch recorded when Deep-Index last completed — authoritative for indexed repos. */
  branch?: string;
  fileCount?: number;
  /** Total lines across indexed text files. Only `index-stats` can supply this. */
  lineCount?: number;
  byteCount?: number;
  languages?: string[];
  /** Host reported a truncated tree — treat counts as a lower bound. */
  truncated?: boolean;
  indexedAt?: string;
  lastCrawledAt?: string;
  note?: string;
};

export type RepoTreeEvidence = {
  topLevelDirs: string[];
  topLevelFiles: string[];
  branch?: string;
};

export type RepoFileEvidence = {
  path: string;
  repoId: string;
  content: string;
  origin: "local" | "remote";
  truncated?: boolean;
};

export type RepoIdentity = {
  repoId: string;
  provider: CodeHostProvider;
  owner?: string;
  repo?: string;
  branch?: string;
};

export type RepoTarget = {
  repoId?: string;
  provider?: CodeHostProvider | string;
  owner?: string;
  repo?: string;
  branch?: string;
};
