import type { IdentityDirectory } from "../identity/types";

export const VIEW_ID = "coopAI.sidebar";
export const CHAT_PANEL_VIEW_TYPE = "coopAI.chatEditor";
export const SETTINGS_PANEL_VIEW_TYPE = "coopAI.settings";
export const SECRET_KEY_API_TOKEN = "coopAI.apiToken";
export const SECRET_KEY_REFRESH_TOKEN = "coopAI.refreshToken";
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_API_BASE = "https://api.coop-ai.dev";

export type ThemeMode = "light" | "dark" | "high-contrast";

export type CodeHostProviderPreference = "github" | "gitlab" | "bitbucket";

export type DecisionIntegrationProvider = "slack" | "jira" | "teams";
export type DocIntegrationProvider = "confluence" | "notion" | "google-docs";
export type IntegrationChatProvider = DecisionIntegrationProvider | DocIntegrationProvider;

export type RepoContextFileSource = "workspace" | "git" | "remote" | "external";

export type RepoContext = {
  provider?: CodeHostProviderPreference;
  owner?: string;
  repo?: string;
  branch?: string;
  scope?: "repo" | "file";
  file?: string;
  /** How `file` was chosen — GitHub features need workspace or git, not a loose Cmd+O path. */
  fileSource?: RepoContextFileSource;
  contextWarning?: string;
  selectedLines?: [number, number];
  /** Symbol at cursor/selection when available (for manifest scoring). */
  selectedSymbol?: string;
  /** Repo-relative paths for open editor tabs. */
  openEditors?: string[];
  languageId?: string;
};

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatFileMention = {
  repoId: string;
  path: string;
  lines?: [number, number];
  /** Search snippet when picked from @ menu (optional). */
  snippet?: string;
  /** Whether the mention came from local workspace search or indexed graph search. */
  source?: "local" | "indexed";
};

export type SearchScopeMode = "repo" | "indexed" | "org" | "collection";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
  relatedArtifactId?: string;
};

/** Serializable evidence card stored with chat thread history. */
export type ChatPersistedArtifact = {
  id: string;
  kind:
    | "decision"
    | "ownership"
    | "repo-summary"
    | "blast-radius"
    | "knowledge-gaps"
    | "integration";
  timestamp: number;
  payload: Record<string, unknown>;
};

export type ChatHistoryPayload = {
  messages: ChatMessage[];
  artifacts: ChatPersistedArtifact[];
};

export type ChatThreadListItem = {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
};

export type ChatThreadsListPayload = {
  activeId: string;
  activeTitle: string;
  threads: ChatThreadListItem[];
};

export type LlmProviderPreference = "openai" | "anthropic" | "deepseek" | "gemini";

export type UserPreferences = {
  model: string;
  llmProvider: LlmProviderPreference;
  temperature: number;
  maxTokens: number;
  llmEnabled: boolean;
  autocompleteEnabled: boolean;
  useCachedResponses: boolean;
  includeSelection: boolean;
  includeActiveFile: boolean;
  apiBaseUrl: string;
  owner: string;
  repo: string;
  branch: string;
  isSignedIn: boolean;
  /** @deprecated Use isSignedIn */
  hasApiKey: boolean;
  defaultCodeHost: CodeHostProviderPreference;
  gitlabBaseUrl: string;
  hasGitHubToken: boolean;
  hasGitHubAppInstalled: boolean;
  githubNeedsReconnect?: boolean;
  devMode: boolean;
  orgName?: string;
  plan?: "free" | "pro" | "enterprise";
  userRole?: string;
  authMethod?: "api_key" | "sso_session" | "password" | "google_oauth";
  canInstallIntegrations?: boolean;
  onboardingCompleted?: boolean;
  adminPortalUrl?: string;
  integrationHealthSummary?: {
    connected: number;
    scopeRequired: number;
  };
  hasGitLabToken: boolean;
  hasGitLabAppInstalled: boolean;
  hasBitbucketCredentials: boolean;
  hasBitbucketAppInstalled: boolean;
  hasSlackToken: boolean;
  hasSlackInstalled: boolean;
  slackTeamName?: string;
  hasAtlassianInstalled: boolean;
  atlassianSiteName?: string;
  hasJiraCredentials: boolean;
  hasTeamsInstalled: boolean;
  teamsDisplayName?: string;
  hasTeamsToken: boolean;
  hasConfluenceCredentials: boolean;
  hasNotionInstalled: boolean;
  notionWorkspaceName?: string;
  hasNotionToken: boolean;
  hasGoogleDocsInstalled: boolean;
  googleDocsDisplayName?: string;
  hasGoogleDocsToken: boolean;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  searchScopeMode: SearchScopeMode;
  searchCollectionId: string;
  workspaceRepoIds?: string[];
  workspaceRepoCount?: number;
  workspaceRepoLimit?: number | null;
  canAddMoreWorkspaceRepos?: boolean;
  primaryWorkspaceRepoId?: string;
  /** IANA timezone id; defaults to US Pacific (PST). */
  timezone?: string;
  quotaCredits?: {
    usedTokens?: number;
    limitTokens?: number;
    remainingTokens?: number;
    usedCredits: number;
    limitCredits: number;
    remainingCredits: number;
    windowHours: number;
    resetsAt: string;
    retryAfterMs: number;
  };
};

export type SettingsStatePayload = UserPreferences & {
  identityDirectory: IdentityDirectory;
};

export type ChatUsagePayload = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  provider: string;
  model: string;
  sessionCostUsd: number;
};

export type WorkspacePromptSummary = {
  id: string;
  title: string;
  template?: string;
  actionId?: string;
};

export type PromptLibraryListPayload = {
  prompts: WorkspacePromptSummary[];
  pinnedIds: string[];
  hasWorkspace: boolean;
};

export type IntentFeedbackState = {
  status: "idle" | "loading" | "warning" | "rate-limited" | "complete" | "error";
  intent?: string;
  actionId?: string;
  title: string;
  message?: string;
  /** Rotating status lines while context is loading. */
  activityMessages?: string[];
  progress?: number;
  stale?: boolean;
};

export type ConflictActionId = "accept-authoritative" | "dismiss" | "escalate";

export type ConflictSummary = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  recommendation: string;
  authoritative: {
    source: string;
    value: unknown;
    score: number;
    reason: string;
  };
  alternatives: Array<{
    source: string;
    value: unknown;
    score: number;
  }>;
  actionRequired: boolean;
  detectedAt: string;
  file?: string;
  repoId?: string;
};

export type ConflictResolutionState = {
  status: "idle" | "detected" | "resolved";
  conflicts: ConflictSummary[];
  updatedAt: string;
};

export type DegradationNotificationPayload = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  provider?: string;
  feature?: string;
  action?: "retry" | "refresh";
};

export type JobProgressPayload = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "partial";
  title: string;
  message?: string;
  progress: number;
  estimatedWaitTime?: string;
  estimatedTimeRemaining?: string;
  /** Chat answer is the deliverable — hide terminal scan-complete UI. */
  deliverable?: "chat" | "standalone";
  /** Dev-only: allow opening raw JSON job output. */
  showViewResults?: boolean;
  resultSummary?: {
    foundGaps?: number;
    highPriority?: number;
    mediumPriority?: number;
    lowPriority?: number;
  };
};

export type WebviewInbound =
  | { type: "webview-ready" }
  | {
      type: "chat:send";
      payload: {
        message: string;
        quickAction?: string;
        savedPromptId?: string;
        attachments?: ChatImageAttachment[];
        mentions?: ChatFileMention[];
        historyContent?: string;
        slashUserArgs?: string;
        /** Scope a quick action to a repository path (e.g. anchor file from a Sources card). */
        targetFile?: string;
      };
    }
  | { type: "mention:search"; payload: { pattern: string } }
  | { type: "collections:list-request" }
  | { type: "prompts:list-request" }
  | {
      type: "prompts:run";
      payload: {
        id: string;
        mentions?: ChatFileMention[];
        attachments?: ChatImageAttachment[];
        /** Optional composer text to prepend to the saved template. */
        composerText?: string;
      };
    }
  | { type: "prompts:save"; payload: { title: string; template: string; actionId?: string } }
  | { type: "prompts:update"; payload: { id: string; title: string; template: string; actionId?: string } }
  | { type: "prompts:delete"; payload: { id: string } }
  | { type: "prompts:update-pinned"; payload: { pinnedIds: string[] } }
  | {
      type: "prompts:commit";
      payload: {
        prompts: { id: string; title: string; template: string; actionId?: string }[];
        pinnedIds: string[];
      };
    }
  | { type: "job:cancel"; payload: { jobId: string } }
  | { type: "job:view-results"; payload: { jobId: string } }
  | { type: "chat:stream-cancel" }
  | { type: "chat:new" }
  | { type: "chat:clear" }
  | { type: "threads:switch"; payload: { threadId: string } }
  | { type: "threads:new" }
  | {
      type: "repo:list";
      payload: {
        path?: string;
        scope?: "repos" | "files";
        owner?: string;
        repo?: string;
        branch?: string;
        provider?: CodeHostProviderPreference;
        /** When true, load tree without changing chat workspace context. */
        ephemeral?: boolean;
      };
    }
  | {
      type: "repo:search";
      payload: {
        query: string;
        owner?: string;
        repo?: string;
        branch?: string;
        provider?: CodeHostProviderPreference;
        ephemeral?: boolean;
      };
    }
  | { type: "repo:select"; payload: { provider: CodeHostProviderPreference; owner: string; repo: string; branch?: string } }
  | { type: "repo:open-repo"; payload: { provider: CodeHostProviderPreference; owner: string; repo: string; branch?: string } }
  | { type: "repo:open-file"; payload: { path: string; line?: number; preserveContext?: boolean } }
  | { type: "link:open"; payload: { url: string } }
  | { type: "github:repos:list"; payload?: { query?: string; requestId?: string } }
  | { type: "workspace:repos:save"; payload: { repoIds: string[] } }
  | { type: "workspace:repos:load" }
  | { type: "settings:update"; payload: Partial<UserPreferences> }
  | { type: "settings:update-api-key"; payload: { apiKey: string } }
  | { type: "settings:clear-api-key" }
  | { type: "settings:copy-api-key" }
  | { type: "settings:reveal-api-key" }
  | { type: "settings:sign-in-password"; payload: { email: string; password: string } }
  | { type: "settings:sign-in-google" }
  | { type: "settings:forgot-password"; payload: { email: string } }
  | { type: "settings:sign-in-sso"; payload?: { org?: string } }
  | { type: "settings:sign-out" }
  | { type: "settings:test-connection" }
  | { type: "settings:update-github-token"; payload: { token: string } }
  | { type: "settings:clear-github-token" }
  | { type: "settings:install-github-app" }
  | { type: "settings:refresh-github-installation" }
  | { type: "settings:install-gitlab-app" }
  | { type: "settings:refresh-gitlab-installation" }
  | { type: "settings:update-gitlab-token"; payload: { token: string } }
  | { type: "settings:clear-gitlab-token" }
  | { type: "settings:install-bitbucket-app" }
  | { type: "settings:refresh-bitbucket-installation" }
  | { type: "settings:install-slack-app" }
  | { type: "settings:refresh-slack-installation" }
  | { type: "settings:install-atlassian-app" }
  | { type: "settings:refresh-atlassian-installation"; payload?: { key?: "jira" | "confluence" } }
  | { type: "settings:install-notion-app" }
  | { type: "settings:refresh-notion-installation" }
  | { type: "settings:install-google-docs-app" }
  | { type: "settings:refresh-google-docs-installation" }
  | { type: "settings:install-teams-app" }
  | { type: "settings:refresh-teams-installation" }
  | {
      type: "settings:update-bitbucket-credentials";
      payload: { username: string; appPassword: string };
    }
  | { type: "settings:clear-bitbucket-credentials" }
  | { type: "settings:test-code-host"; payload: { provider: CodeHostProviderPreference } }
  | { type: "settings:update-slack-token"; payload: { token: string } }
  | { type: "settings:clear-slack-token" }
  | {
      type: "settings:update-jira-credentials";
      payload: { email: string; token: string; baseUrl?: string };
    }
  | { type: "settings:clear-jira-credentials" }
  | { type: "settings:update-teams-token"; payload: { token: string } }
  | { type: "settings:clear-teams-token" }
  | {
      type: "settings:update-confluence-credentials";
      payload: { email: string; token: string; baseUrl?: string };
    }
  | { type: "settings:clear-confluence-credentials" }
  | { type: "settings:copy-jira-to-confluence" }
  | { type: "settings:update-notion-token"; payload: { token: string } }
  | { type: "settings:clear-notion-token" }
  | { type: "settings:update-google-docs-token"; payload: { token: string } }
  | { type: "settings:clear-google-docs-token" }
  | { type: "settings:save-identity-directory"; payload: { directory: IdentityDirectory } }
  | {
      type: "settings:test-integration";
      payload: {
        provider: IntegrationChatProvider;
        draft?: { email?: string; token?: string; baseUrl?: string };
      };
    }
  | { type: "context:dismiss-warning" }
  | { type: "degradation:refresh"; payload?: { feature?: string; retrace?: boolean } }
  | { type: "conflict:action"; payload: { conflictId: string; action: ConflictActionId } }
  | { type: "ownership:copy-draft"; payload: { text: string } }
  | { type: "evidence:copy-text"; payload: { text: string; toast?: string } }
  | { type: "ui:close-settings" }
  | { type: "ui:open-settings"; payload?: { screen?: string } }
  | { type: "ui:ensure-min-width"; payload: { width: number; minWidth: number } }
  | { type: "autocomplete:toggle" }
  | { type: "autocomplete:set"; payload: { enabled: boolean } }
  | { type: "lightning:ready" }
  | { type: "lightning:enable-global" }
  | { type: "lightning:disable-global" }
  | { type: "lightning:enable-repo"; payload: { repoId: string } }
  | { type: "lightning:disable-repo"; payload: { repoId: string } }
  | { type: "lightning:refresh-repo"; payload: { repoId: string } }
  | { type: "lightning:upgrade" };

export type MentionSearchResult = {
  repoId: string;
  path: string;
  lineNumber?: number;
  content?: string;
  score?: number;
  /** Local workspace vs indexed remote graph (Pro+ hybrid search). */
  source?: "local" | "indexed";
};

export type OrgCollectionSummary = {
  id: string;
  name: string;
  description?: string;
  repoCount: number;
  repoIds?: string[];
};

export type WebviewOutbound =
  | { type: "theme:update"; payload: ThemePayload }
  | { type: "context:update"; payload: RepoContext }
  | { type: "chat:history"; payload: ChatHistoryPayload | ChatMessage[] }
  | { type: "threads:list"; payload: ChatThreadsListPayload }
  | { type: "chat:thread-changed"; payload: { threadId: string; title: string } }
  | { type: "chat:delta"; payload: { chunk: string } }
  | { type: "chat:complete"; payload: { message: ChatMessage } }
  | { type: "chat:error"; payload: { message: string } }
  | {
      type: "chat:quota-exceeded";
      payload: {
        resetsAt: string;
        upgradeUrl: string;
        timezone?: string;
        retryAfterMs?: number;
      };
    }
  | { type: "chat:quota-cleared" }
  | { type: "chat:usage"; payload: ChatUsagePayload }
  | { type: "prompts:list"; payload: PromptLibraryListPayload }
  | { type: "prompts:insert"; payload: { text: string; actionId?: string } }
  | {
      type: "repo:tree";
      payload: {
        path: string;
        items: RemoteTreeNode[];
        scope?: "repos" | "files";
        error?: string;
        stale?: boolean;
        provider?: CodeHostProviderPreference;
        loading?: boolean;
        emptyHint?: "workspace";
        listLabel?: "workspace";
      };
    }
  | {
      type: "repo:search-results";
      payload: {
        query: string;
        items: RemoteTreeNode[];
        error?: string;
        loading?: boolean;
      };
    }
  | { type: "intent:feedback"; payload: IntentFeedbackState }
  | { type: "conflict:update"; payload: ConflictResolutionState }
  | { type: "settings:state"; payload: SettingsStatePayload }
  | { type: "settings:navigate"; payload: { screen: string } }
  | { type: "settings:test-result"; payload: { ok: boolean; message: string } }
  | { type: "settings:refresh-result"; payload: { ok: boolean; message: string } }
  | { type: "settings:api-key-revealed"; payload: { apiKey: string } }
  | { type: "degradation:notification"; payload: DegradationNotificationPayload }
  | { type: "trace:autoload"; payload: { message: string } }
  | {
      type: "command:confirm";
      payload: {
        title: string;
        message: string;
        run: {
          message: string;
          quickAction: string;
          attachments?: ChatImageAttachment[];
        historyContent?: string;
        mentions?: ChatFileMention[];
        slashUserArgs?: string;
        /** Scope a quick action to a repository path (e.g. anchor file from a Sources card). */
        targetFile?: string;
      };
    };
    }
  | { type: "decision:timeline"; payload: { artifactId?: string; timeline: unknown; dismissed?: boolean } }
  | { type: "ownership:card"; payload: { artifactId?: string; report: unknown; slackSearch?: unknown; dismissed?: boolean } }
  | {
      type: "repo-summary:card";
      payload: { artifactId?: string; evidence: unknown; owner: string; repo: string; branch?: string; dismissed?: boolean };
    }
  | { type: "blast-radius:card"; payload: { artifactId?: string; evidence: unknown; file: string; dismissed?: boolean } }
  | {
      type: "knowledge-gaps:card";
      payload: { artifactId?: string; evidence: unknown; confluence?: unknown; jira?: unknown; slack?: unknown; notion?: unknown; googleDocs?: unknown; teams?: unknown; file?: string; dismissed?: boolean };
    }
  | {
      type: "integration:card";
      payload: { artifactId?: string; provider: IntegrationChatProvider; evidence: unknown; dismissed?: boolean };
    }
  | { type: "job:progress"; payload: JobProgressPayload }
  | { type: "job:complete"; payload: JobProgressPayload & { result?: unknown } }
  | {
      type: "autocomplete:status";
      payload: {
        status: "disabled" | "ready" | "processing" | "error";
        message?: string;
        suggestionIndex?: number;
        suggestionCount?: number;
        latencyMs?: number;
        previewText?: string;
      };
    }
  | {
      type: "mention:results";
      payload: {
        pattern: string;
        items: MentionSearchResult[];
        error?: string;
        loading?: boolean;
        hint?: string;
      };
    }
  | { type: "collections:list"; payload: { collections: OrgCollectionSummary[]; error?: string } }
  | { type: "lightning:open" }
  | {
      type: "lightning:state";
      payload: {
        plan: "free" | "pro" | "enterprise";
        canUseLightning: boolean;
        globalEnabled: boolean;
        maxDiskGb: number;
        totalDiskBytes: number;
        enabledRepos: number;
        readyRepos: number;
        indexingRepos: number;
        repos: Array<{
          repoId: string;
          owner: string;
          repo: string;
          enabled: boolean;
          status: "idle" | "cloning" | "indexing" | "ready" | "error" | "disabled";
          localPath?: string;
          lastIndexedAt?: string;
          diskUsageBytes?: number;
          zoektAvailable?: boolean;
          scipAvailable?: boolean;
          error?: string;
        }>;
        currentRepoId?: string;
        backend?: "local" | "cloud";
      };
    }
  | {
      type: "github:repos:list-result";
      payload: {
        requestId?: string;
        repos: GithubRepoOption[];
        error?: string;
        loading?: boolean;
      };
    }
  | {
      type: "workspace:repos:state";
      payload: {
        repos: GithubRepoOption[];
        selectedRepoIds: string[];
        selectedCount: number;
        limit: number | null;
        canAddMore: boolean;
        primaryRepoId?: string;
        error?: string;
        loading?: boolean;
        saving?: boolean;
      };
    };

export type GithubRepoOption = {
  repoId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  provider?: string;
  isPrivate?: boolean;
  htmlUrl?: string;
  lightningEnabled?: boolean;
  indexStatus?: string;
  workspaceSelected?: boolean;
};

export type RemoteTreeNode = {
  path: string;
  name: string;
  type: "file" | "dir" | "repo";
  size?: number;
  updatedAt?: string;
};

export type ThemePayload = {
  mode: ThemeMode;
};

export type CachedValue = {
  expiresAt: number;
  value: unknown;
};
