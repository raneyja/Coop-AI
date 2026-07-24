import type { IndexBackend } from "../../indexing/indexBackend";
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
};
