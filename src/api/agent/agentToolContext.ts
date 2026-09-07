import type { IndexBackend } from "../../indexing/indexBackend";
import type { IntegrationChatProvider } from "../../chat/types";
import type { BlameData } from "../codeHosts/types";

export type AgentDirectoryListing = {
  path: string;
  branch?: string;
  entries: Array<{ name: string; path: string; type: "file" | "dir" }>;
};

export type AgentToolContext = {
  indexBackend: IndexBackend;
  resolveAbsolutePath: (relativePath: string) => string | undefined;
  /** Live code-host / workspace directory listing for list_directory. */
  listDirectory?: (options: {
    path?: string;
    repoId?: string;
  }) => Promise<AgentDirectoryListing>;
  /** Live code-host blame for git_blame. */
  getBlame?: (options: { path: string; repoId?: string }) => Promise<BlameData & { path: string }>;
  /**
   * Fetch a file that is not on local disk, via IndexedRepoWorkspace. Required for
   * remote repos, where the agent has an index but no clone.
   */
  readRemoteFile?: (options: {
    path: string;
    repoId?: string;
  }) => Promise<{ path: string; content: string } | undefined>;
  /**
   * Resolve a filename the user typed (`authMiddleware.ts`) to repo paths.
   * Code-host / graph search — not a local workspace walk.
   */
  findFiles?: (options: { query: string; repoId?: string }) => Promise<string[]>;
  /**
   * Mid-loop integration search. Only providers on {@link allowedIntegrations}
   * (or the per-run allowlist) may be called.
   */
  searchIntegration?: (options: {
    provider: IntegrationChatProvider;
    query: string;
  }) => Promise<Record<string, unknown>>;
  /** Planner allowlist for this session/run — empty means no integration tools. */
  allowedIntegrations?: IntegrationChatProvider[];
};
