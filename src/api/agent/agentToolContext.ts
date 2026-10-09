import type { CandidateLedger } from "./candidateLedger";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { IntegrationChatProvider } from "../../chat/types";
import type { BlameData } from "../codeHosts/types";
import type { RepoTarget } from "../../workspace/indexedRepoWorkspaceTypes";

export type AgentDirectoryListing = {
  path: string;
  branch?: string;
  entries: Array<{ name: string; path: string; type: "file" | "dir" }>;
};

export type AgentToolContext = {
  indexBackend: IndexBackend;
  /** Canonical target frozen by createRunToolContext for this turn. */
  repoTarget?: Readonly<RepoTarget>;
  /** Owned by this frozen turn; never shared between chats or branches. */
  candidateLedger?: CandidateLedger;
  resolveRepoTarget?: (target: RepoTarget) => Promise<RepoTarget>;
  /** Full task wording for judging fallback eligibility; never replaces the search query. */
  researchQuery?: string;
  /** Enables implementation-only filename fallback for ordinary locate runs. */
  locateMode?: boolean;
  /** Content-minimized, correlated retrieval diagnostics for this turn. */
  onDiagnostic?: (event: Record<string, unknown>) => void;
  resolveAbsolutePath: (relativePath: string) => string | undefined;
  /** Live code-host / workspace directory listing for list_directory. */
  listDirectory?: (options: {
    path?: string;
    repoId?: string;
    target?: RepoTarget;
  }) => Promise<AgentDirectoryListing>;
  /** Live code-host blame for git_blame. */
  getBlame?: (options: { path: string; repoId?: string; target?: RepoTarget }) => Promise<BlameData & { path: string }>;
  /**
   * Fetch a file that is not on local disk, via IndexedRepoWorkspace. Required for
   * remote repos, where the agent has an index but no clone.
   */
  readRemoteFile?: (options: {
    path: string;
    repoId?: string;
    target?: RepoTarget;
  }) => Promise<{ path: string; content: string; repoId?: string; branch?: string; truncated?: boolean } | undefined>;
  /**
   * Resolve a filename the user typed (`authMiddleware.ts`) to repo paths.
   * Code-host / graph search — not a local workspace walk.
   */
  findFiles?: (options: { query: string; taskQuery?: string; repoId?: string; target?: RepoTarget; excludeClientUi?: boolean; onDiagnostic?: (event: Record<string, unknown>) => void }) => Promise<string[]>;
  /**
   * Full-text code search on the active code host (GitHub / GitLab / Bitbucket).
   * Used when Lightning returns zero hits for a reject / quoted-error query —
   * not the explorer path: picker (`findFiles` / `searchRepositoryFiles`).
   */
  searchCodeHost?: (options: {
    query: string;
    repoId?: string;
    limit?: number;
    target?: RepoTarget;
  }) => Promise<Array<{ path: string; snippet?: string }>>;
  /**
   * Mid-loop integration search. Only providers on {@link allowedIntegrations}
   * (connected tools for this run) may be called.
   */
  searchIntegration?: (options: {
    provider: IntegrationChatProvider;
    query: string;
    openIds?: string[];
    priorHits?: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<Record<string, unknown>>;
  /** Connected integrations for this session/run — empty means none connected. */
  allowedIntegrations?: IntegrationChatProvider[];
  /** Prior Search payload for this tool — Open merges bodies onto these hits. */
  priorIntegrationPayload?: Record<string, unknown>;
  /** Shared user-turn origin for silent gather handoff. */
  gatherStartedAt?: number;
  searchSignal?: AbortSignal;
};
