export const VIEW_ID = "coopAI.sidebar";
export const CHAT_PANEL_VIEW_TYPE = "coopAI.chatEditor";
export const SETTINGS_PANEL_VIEW_TYPE = "coopAI.settings";
export const SECRET_KEY_API_TOKEN = "coopAI.apiToken";
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_API_BASE = "https://api.coopai.dev";

export type ThemeMode = "light" | "dark" | "high-contrast";

export type CodeHostProviderPreference = "github" | "gitlab" | "bitbucket";

export type DecisionIntegrationProvider = "slack" | "jira" | "teams";

export type RepoContextFileSource = "workspace" | "git" | "remote" | "external";

export type RepoContext = {
  provider?: CodeHostProviderPreference;
  owner?: string;
  repo?: string;
  branch?: string;
  file?: string;
  /** How `file` was chosen — GitHub features need workspace or git, not a loose Cmd+O path. */
  fileSource?: RepoContextFileSource;
  contextWarning?: string;
  selectedLines?: [number, number];
  languageId?: string;
};

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  links?: Array<{ label: string; url: string }>;
  attachments?: ChatImageAttachment[];
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
  hasApiKey: boolean;
  defaultCodeHost: CodeHostProviderPreference;
  gitlabBaseUrl: string;
  hasGitHubToken: boolean;
  hasGitLabToken: boolean;
  hasBitbucketCredentials: boolean;
  hasSlackToken: boolean;
  hasJiraCredentials: boolean;
  hasTeamsToken: boolean;
  jiraBaseUrl: string;
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

export type IntegrationHealthPayload = {
  provider: string;
  status: "healthy" | "degraded" | "offline";
  lastCheck: string;
  error?: string;
  recoveryStrategy: "retry" | "cache" | "skip";
  latency?: number;
  errorRate?: number;
};

export type DegradationFeatureStatusPayload = {
  feature: string;
  canonicalFeature: string;
  level: "full" | "partial" | "cached" | "unavailable";
  label: string;
  message: string;
  required: string[];
  optional: string[];
  unavailableProviders: string[];
  degradedProviders: string[];
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
      };
    }
  | { type: "prompts:list-request" }
  | { type: "prompts:run"; payload: { id: string } }
  | { type: "prompts:save"; payload: { title: string; template: string; actionId?: string } }
  | { type: "prompts:update"; payload: { id: string; title: string; template: string; actionId?: string } }
  | { type: "prompts:delete"; payload: { id: string } }
  | { type: "prompts:update-pinned"; payload: { pinnedIds: string[] } }
  | { type: "job:cancel"; payload: { jobId: string } }
  | { type: "job:view-results"; payload: { jobId: string } }
  | { type: "chat:stream-cancel" }
  | { type: "chat:new" }
  | { type: "chat:clear" }
  | { type: "repo:list"; payload: { path?: string; scope?: "repos" | "files" } }
  | { type: "repo:select"; payload: { provider: CodeHostProviderPreference; owner: string; repo: string; branch?: string } }
  | { type: "repo:open-repo"; payload: { provider: CodeHostProviderPreference; owner: string; repo: string; branch?: string } }
  | { type: "repo:open-file"; payload: { path: string } }
  | { type: "settings:update"; payload: Partial<UserPreferences> }
  | { type: "settings:update-api-key"; payload: { apiKey: string } }
  | { type: "settings:clear-api-key" }
  | { type: "settings:test-connection" }
  | { type: "settings:update-github-token"; payload: { token: string } }
  | { type: "settings:clear-github-token" }
  | { type: "settings:update-gitlab-token"; payload: { token: string } }
  | { type: "settings:clear-gitlab-token" }
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
  | { type: "settings:test-integration"; payload: { provider: DecisionIntegrationProvider } }
  | { type: "degradation:retry"; payload?: { provider?: string; feature?: string } }
  | { type: "degradation:refresh"; payload?: { feature?: string; retrace?: boolean } }
  | { type: "conflict:action"; payload: { conflictId: string; action: ConflictActionId } }
  | { type: "ui:close-settings" }
  | { type: "ui:open-settings" }
  | { type: "autocomplete:toggle" };

export type WebviewOutbound =
  | { type: "theme:update"; payload: ThemePayload }
  | { type: "context:update"; payload: RepoContext }
  | { type: "chat:history"; payload: ChatMessage[] }
  | { type: "chat:delta"; payload: { chunk: string } }
  | { type: "chat:complete"; payload: { message: ChatMessage } }
  | { type: "chat:error"; payload: { message: string } }
  | { type: "chat:usage"; payload: ChatUsagePayload }
  | { type: "prompts:list"; payload: PromptLibraryListPayload }
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
      };
    }
  | { type: "intent:feedback"; payload: IntentFeedbackState }
  | { type: "conflict:update"; payload: ConflictResolutionState }
  | { type: "settings:state"; payload: UserPreferences }
  | { type: "settings:test-result"; payload: { ok: boolean; message: string } }
  | { type: "degradation:health"; payload: IntegrationHealthPayload[] }
  | { type: "degradation:feature-status"; payload: Record<string, DegradationFeatureStatusPayload> }
  | { type: "degradation:notification"; payload: DegradationNotificationPayload }
  | { type: "trace:autoload"; payload: { message: string } }
  | { type: "decision:timeline"; payload: { timeline: unknown; dismissed?: boolean } }
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
