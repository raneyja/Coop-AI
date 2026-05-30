import * as vscode from "vscode";
import { activeThemeMode } from "./themeMode";
import { coopSessionRegistry } from "./CoopSessionRegistry";
import {
  readDegradationConfiguration,
  readConflictConfiguration,
  readPreferences,
  readIntentConfiguration,
  SecureApiClient,
  updateConfiguration
} from "./SecureApiClient";
import type { ConflictConfig } from "../config/conflictConfig";
import { DegradationConfig } from "../config/degradationConfig";
import type { DegradationCache } from "../cache/degradationCache";
import {
  ConflictAuditStore,
  ConflictDetector,
  ConflictResolutionStrategy,
  SourceAuthorityScorer,
  hasSeverityAtLeast
} from "../conflicts";
import type {
  ConflictDetectionInput,
  ConflictSeverity,
  DetectedConflict,
  MetadataConflictInput
} from "../conflicts";
import { runFeatureFallback } from "../degradation/features";
import { featureStatuses } from "../degradation/fallbackMatrix";
import type { HealthMonitor, IntegrationHealth, IntegrationProvider } from "../integrations/healthMonitor";
import type { IntentConfig } from "../config/intentConfig";
import {
  IntentDetector,
  IntentEvent,
  UserIntent,
  intentContextToRepoContext,
  repoContextToIntentContext,
  requestTypesForIntent,
  repoContextFromEditor
} from "../context/intentDetector";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import { openRemoteFileInEditor, openRepoInEditor } from "../workspace/repoEditorOpener";
import { IntentDebouncer } from "../context/intentDebouncer";
import {
  ContextFetchRequest,
  ContextFetchResult,
  RequestBatcher,
  buildContextRequests
} from "../context/requestBatcher";
import { RequestPrioritizer } from "../context/requestPrioritizer";
import { CacheEntry, RateLimitAwareExecutor } from "../context/rateLimitAwareExecution";
import { renderWebviewHtml } from "./renderWebviewHtml";
import type {
  CachedValue,
  ChatImageAttachment,
  ChatMessage,
  ConflictResolutionState,
  ConflictSummary,
  DegradationNotificationPayload,
  IntentFeedbackState,
  IntegrationHealthPayload,
  RepoContext,
  ThemeMode,
  ThemePayload,
  UserPreferences,
  WebviewInbound,
  WebviewOutbound
} from "./types";
import { CACHE_TTL_MS } from "./types";
import { JobApiClient, jobTypeForQuickAction, shouldUseAsyncJob } from "../jobs/JobApiClient";
import { formatWaitTime } from "../jobs/types";
import type { JobProgressPayload } from "./types";
import { resolveCoopBaseUrl } from "../api/resolveBaseUrl";
import type { DecisionTimeline } from "../types/decisionTimeline";
import { buildDecisionSynthesisUserPrompt } from "../prompts/decisionSynthesis";
import { useCaseFromQuickAction } from "../prompts/systemPrompts";
import { quickActionPrompt } from "../prompts/quickActionPrompts";
import type { QuickActionId } from "../webview/types";
import {
  applyPromptTemplate,
  deleteWorkspacePrompt,
  hasWorkspaceFolder,
  loadWorkspacePrompts,
  promptVariablesFromContext,
  saveWorkspacePrompt,
  updateWorkspacePrompt,
  watchWorkspacePrompts
} from "../prompts/workspacePromptLibrary";
import {
  loadPinnedPromptIds,
  prunePinnedPromptIds,
  savePinnedPromptIds,
  updatePinnedPromptIds
} from "../prompts/pinnedPrompts";

function titleFromMessage(content: string): string {
  const normalized = content.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (!normalized) {
    return "New Chat";
  }
  const singleLine = normalized.split("\n")[0]?.trim() ?? normalized;
  return singleLine.length <= 48 ? singleLine : `${singleLine.slice(0, 45)}…`;
}

export type CoopChatSessionOptions = {
  extensionUri: vscode.Uri;
  extensionContext: vscode.ExtensionContext;
  api: SecureApiClient;
  healthMonitor: HealthMonitor;
  degradationCache: DegradationCache;
  codeHostRouter: import("../api/codeHosts/codeHostRouter").CodeHostRouter;
  codeHostSecrets: import("../api/codeHosts/codeHostSecrets").CodeHostSecrets;
  integrationSecrets: import("../api/integrations/integrationSecrets").IntegrationSecrets;
  onDescriptionChange?: (description: string) => void;
  onTitleChange?: (title: string) => void;
};

export class CoopChatSession {
  private webview?: vscode.Webview;
  private settingsWebview?: vscode.Webview;
  private settingsMessageDisposable?: vscode.Disposable;
  private closeSettingsHandler?: () => void;
  private readonly chatHistory: ChatMessage[] = [];
  private readonly cache = new Map<string, CachedValue>();
  private readonly contextFetchCache = new Map<string, CacheEntry>();
  private readonly intentDetector = new IntentDetector();
  private readonly intentDebouncer: IntentDebouncer;
  private requestBatcher: RequestBatcher;
  private requestPrioritizer: RequestPrioritizer;
  private intentConfig: IntentConfig;
  private conflictConfig: ConflictConfig;
  private degradationConfig: DegradationConfig;
  private preferences: UserPreferences;
  private currentContext: RepoContext = {};
  private currentConflictState: ConflictResolutionState = {
    status: "idle",
    conflicts: [],
    updatedAt: new Date(0).toISOString()
  };
  private readonly conflictAudit = new ConflictAuditStore();
  private streamToken = 0;
  private healthUnsubscribe?: () => void;
  private latestHealth: IntegrationHealth[] = [];
  private readonly jobClient: JobApiClient;
  private activeJobId?: string;
  private jobRunToken = 0;
  private lastJobResult?: unknown;
  private lastContextBundle: ContextFetchResult[] = [];
  private sessionCostUsd = 0;
  private streamAbortController?: AbortController;
  private workspacePromptWatcher?: vscode.Disposable;

  public constructor(
    private readonly options: CoopChatSessionOptions
  ) {
    this.intentConfig = readIntentConfiguration();
    this.conflictConfig = readConflictConfiguration();
    this.degradationConfig = readDegradationConfiguration();
    this.intentDebouncer = new IntentDebouncer({ rules: this.intentConfig.debounceRules });
    this.requestBatcher = this.createRequestBatcher();
    this.requestPrioritizer = this.createRequestPrioritizer();
    this.preferences = {
      model: "claude-3-5-sonnet-20241022",
      llmProvider: "anthropic",
      temperature: 0.5,
      maxTokens: 2000,
      llmEnabled: true,
      autocompleteEnabled: false,
      useCachedResponses: true,
      includeSelection: true,
      includeActiveFile: true,
      apiBaseUrl: resolveCoopBaseUrl().baseUrl,
      owner: "",
      repo: "",
      branch: "",
      hasApiKey: false,
      defaultCodeHost: "github",
      gitlabBaseUrl: "https://gitlab.com/api/v4",
      hasGitHubToken: false,
      hasGitLabToken: false,
      hasBitbucketCredentials: false,
      hasSlackToken: false,
      hasJiraCredentials: false,
      hasTeamsToken: false,
      jiraBaseUrl: "https://your-domain.atlassian.net"
    };
    this.jobClient = new JobApiClient({
      baseUrl: resolveCoopBaseUrl().baseUrl,
      getToken: () => this.options.api.getToken()
    });
    coopSessionRegistry.register(this);
    this.healthUnsubscribe = this.options.healthMonitor.subscribe((health) => {
      this.latestHealth = health;
      this.postHealth(health);
      this.postFeatureStatuses(health);
    });
  }

  public dispose(): void {
    this.intentDebouncer.dispose();
    this.requestBatcher.cancelAll("Session disposed.");
    this.requestPrioritizer.clear("Session disposed.");
    this.healthUnsubscribe?.();
    coopSessionRegistry.unregister(this);
  }

  public attachWebview(webview: vscode.Webview): void {
    this.webview = webview;
    webview.html = renderWebviewHtml(webview, this.options.extensionUri, { view: "chat" });
    this.wireWebview(webview, "chat");
    coopSessionRegistry.setActive(this);
  }

  public attachSettingsWebview(webview: vscode.Webview, onClose?: () => void): void {
    this.settingsMessageDisposable?.dispose();
    this.settingsWebview = webview;
    this.closeSettingsHandler = onClose;
    webview.html = renderWebviewHtml(webview, this.options.extensionUri, { view: "settings" });
    this.settingsMessageDisposable = this.wireWebview(webview, "settings");
  }

  public detachSettingsWebview(): void {
    this.settingsMessageDisposable?.dispose();
    this.settingsMessageDisposable = undefined;
    this.settingsWebview = undefined;
    this.closeSettingsHandler = undefined;
  }

  public touch(): void {
    coopSessionRegistry.setActive(this);
  }

  public async initialize(): Promise<void> {
    this.refreshIntentConfiguration();
    this.conflictConfig = readConflictConfiguration();
    this.degradationConfig = readDegradationConfiguration();
    this.preferences = await readPreferences(
      this.options.api,
      this.options.codeHostSecrets,
      this.options.integrationSecrets
    );
    this.applyDefaultRepoToContext();
    this.postTheme();
    await this.pushDegradationState();
    await this.pushSettingsState();
    this.post({ type: "chat:history", payload: this.chatHistory });
  }

  public async refreshPreferences(): Promise<void> {
    this.refreshIntentConfiguration();
    this.conflictConfig = readConflictConfiguration();
    this.degradationConfig = readDegradationConfiguration();
    this.preferences = await readPreferences(
      this.options.api,
      this.options.codeHostSecrets,
      this.options.integrationSecrets
    );
    this.applyDefaultRepoToContext();
    await this.pushSettingsState();
  }

  public refreshEditorContext(editor: vscode.TextEditor | undefined): void {
    const intent = this.intentDetector.detectEditorIntent(editor);
    const nextContext = repoContextFromEditor(editor, this.preferences, this.currentContext);
    const event = this.intentDetector.create(intent, {
      file: nextContext.file,
      lines: nextContext.selectedLines
        ? { start: nextContext.selectedLines[0], end: nextContext.selectedLines[1] }
        : undefined,
      owner: nextContext.owner,
      repo: nextContext.repo,
      branch: nextContext.branch,
      languageId: nextContext.languageId,
      source: "editor"
    });

    void this.intentDebouncer.debounce(event, (debounced) => this.handleEditorIntent(debounced));
  }

  public handleThemeChange(): void {
    this.postTheme();
  }

  public postAutocompleteStatus(payload: {
    status: "disabled" | "ready" | "processing" | "error";
    message?: string;
    suggestionIndex?: number;
    suggestionCount?: number;
    latencyMs?: number;
    previewText?: string;
  }): void {
    this.postToChat({ type: "autocomplete:status", payload });
  }

  public newChat(): void {
    this.streamToken++;
    this.streamAbortController?.abort();
    this.abortActiveJob();
    this.chatHistory.length = 0;
    this.sessionCostUsd = 0;
    this.options.onTitleChange?.("New Chat");
    this.post({ type: "chat:history", payload: [] });
  }

  private abortActiveJob(): void {
    this.jobRunToken++;
    const jobId = this.activeJobId;
    this.activeJobId = undefined;
    if (jobId) {
      void this.jobClient.cancelJob(jobId).catch(() => undefined);
    }
  }

  public setRepoContext(context: Pick<RepoContext, "provider" | "owner" | "repo" | "branch">): void {
    this.currentContext = {
      ...this.currentContext,
      provider: context.provider ?? this.currentContext.provider ?? this.preferences.defaultCodeHost,
      owner: context.owner,
      repo: context.repo,
      branch: context.branch ?? this.currentContext.branch,
      file: undefined,
      fileSource: undefined,
      contextWarning: undefined,
      selectedLines: undefined
    };
    this.postContext();
  }

  public clearChat(): void {
    this.newChat();
  }

  public openSettings(): void {
    // Lazy import avoids circular dependency with CoopSettingsPanel.
    void import("../CoopSettingsPanel").then(({ CoopSettingsPanel }) => {
      CoopSettingsPanel.createOrReveal(this.options.extensionUri, this);
    });
  }

  public getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  public async sendUserMessage(message: string, quickAction?: string): Promise<void> {
    await this.handleChatSend(message, quickAction);
  }

  public async submitQuickAction(actionId: QuickActionId, context?: RepoContext): Promise<void> {
    if (context) {
      this.currentContext = { ...this.currentContext, ...context };
      this.postContext();
    }
    const prompt = quickActionPrompt(actionId, this.currentContext);
    await this.handleChatSend(prompt, actionId);
  }

  public async traceDecisionFromSelection(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor.selection.isEmpty) {
      return;
    }
    const context = repoContextFromEditor(editor, this.preferences, this.currentContext);
    this.currentContext = { ...this.currentContext, ...context };
    const event = this.intentDetector.fromHotkey(this.currentContext, "coopAI.traceDecisionFromContext");
    await this.runIntentFetch(event);
    const selected = editor.document.getText(editor.selection).slice(0, 8000);
    const message = `Trace Decision for this code:\n\n\`\`\`${editor.document.languageId}\n${selected}\n\`\`\``;
    this.post({ type: "trace:autoload", payload: { message } });
  }

  private wireWebview(webview: vscode.Webview, source: "chat" | "settings"): vscode.Disposable {
    return webview.onDidReceiveMessage(async (raw: WebviewInbound) => {
      try {
        await this.handleMessage(raw, source);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected extension error.";
        if (source === "chat") {
          this.postToChat({ type: "chat:error", payload: { message } });
        }
      }
    });
  }

  private async handleMessage(message: WebviewInbound, source: "chat" | "settings"): Promise<void> {
    switch (message.type) {
      case "webview-ready":
        this.postTheme();
        if (source === "chat") {
          this.postContext();
          await this.pushDegradationState();
          await this.pushSettingsState();
          this.postToChat({ type: "chat:history", payload: this.chatHistory });
          void this.pushWorkspacePrompts();
          this.workspacePromptWatcher?.dispose();
          this.workspacePromptWatcher = watchWorkspacePrompts(() => void this.pushWorkspacePrompts());
        } else {
          await this.pushSettingsState();
          void this.pushWorkspacePrompts();
        }
        return;
      case "ui:close-settings":
        this.closeSettingsHandler?.();
        return;
      case "ui:open-settings":
        this.openSettings();
        return;
      case "autocomplete:toggle":
        await vscode.commands.executeCommand("coopAI.toggleAutocomplete");
        return;
      case "chat:send":
        await this.handleChatSend(message.payload.message, message.payload.quickAction, message.payload.attachments);
        return;
      case "chat:stream-cancel":
        this.streamToken++;
        this.streamAbortController?.abort();
        return;
      case "prompts:list-request":
        await this.pushWorkspacePrompts();
        return;
      case "prompts:run": {
        const prompts = await loadWorkspacePrompts();
        const entry = prompts.find((item) => item.id === message.payload.id);
        if (!entry) {
          return;
        }
        const text = applyPromptTemplate(entry.template, promptVariablesFromContext(this.currentContext));
        await this.handleChatSend(text, entry.actionId as QuickActionId | undefined);
        return;
      }
      case "prompts:save":
        await saveWorkspacePrompt({
          id: `prompt-${Date.now()}`,
          title: message.payload.title,
          template: message.payload.template,
          actionId: message.payload.actionId
        });
        await this.broadcastPromptLibrary();
        void vscode.window.showInformationMessage("Saved prompt to your prompt library.");
        return;
      case "prompts:update":
        await updateWorkspacePrompt({
          id: message.payload.id,
          title: message.payload.title,
          template: message.payload.template,
          actionId: message.payload.actionId
        });
        await this.broadcastPromptLibrary();
        return;
      case "prompts:delete": {
        await deleteWorkspacePrompt(message.payload.id);
        const prompts = await loadWorkspacePrompts();
        const validIds = new Set(prompts.map((entry) => entry.id));
        const pinned = await loadPinnedPromptIds(this.options.extensionContext);
        await updatePinnedPromptIds(this.options.extensionContext, pinned, validIds);
        await this.broadcastPromptLibrary();
        return;
      }
      case "prompts:update-pinned": {
        const prompts = await loadWorkspacePrompts();
        const validIds = new Set(prompts.map((entry) => entry.id));
        await updatePinnedPromptIds(
          this.options.extensionContext,
          message.payload.pinnedIds,
          validIds
        );
        await this.broadcastPromptLibrary();
        return;
      }
      case "chat:new":
        this.newChat();
        return;
      case "chat:clear":
        this.clearChat();
        return;
      case "repo:list":
        if (message.payload.scope === "repos") {
          await this.handleRepoListRepos();
        } else {
          await this.handleRepoList(message.payload.path || "");
        }
        return;
      case "repo:select":
        await this.handleRepoSelect(message.payload);
        return;
      case "repo:open-repo":
        await openRepoInEditor({
          owner: message.payload.owner,
          repo: message.payload.repo,
          provider:
            message.payload.provider ?? this.currentContext.provider ?? this.preferences.defaultCodeHost,
          branch: message.payload.branch ?? this.currentContext.branch
        });
        await vscode.commands.executeCommand("coopAI.openChatForRepo", message.payload);
        return;
      case "repo:open-file":
        void this.handleRemoteFileIntent(message.payload.path);
        return;
      case "settings:update":
        await updateConfiguration(message.payload);
        if (message.payload.jiraBaseUrl !== undefined) {
          await this.options.integrationSecrets.updateJiraBaseUrl(message.payload.jiraBaseUrl);
        }
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-api-key":
        await this.options.api.setToken(message.payload.apiKey);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-api-key":
        await this.options.api.clearToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:test-connection":
        await this.handleTestConnection(source);
        return;
      case "settings:update-github-token":
        await this.options.codeHostSecrets.setGitHubToken(message.payload.token);
        this.options.codeHostRouter.clearClientCache("github");
        await this.options.degradationCache.clear();
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("github");
        return;
      case "settings:clear-github-token":
        await this.options.codeHostSecrets.clearGitHubToken();
        this.options.codeHostRouter.clearClientCache("github");
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("github");
        return;
      case "settings:update-gitlab-token":
        await this.options.codeHostSecrets.setGitLabToken(message.payload.token);
        this.options.codeHostRouter.clearClientCache("gitlab");
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("gitlab");
        return;
      case "settings:clear-gitlab-token":
        await this.options.codeHostSecrets.clearGitLabToken();
        this.options.codeHostRouter.clearClientCache("gitlab");
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("gitlab");
        return;
      case "settings:update-bitbucket-credentials":
        await this.options.codeHostSecrets.setBitbucketCredentials(
          message.payload.username,
          message.payload.appPassword
        );
        this.options.codeHostRouter.clearClientCache("bitbucket");
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("bitbucket");
        return;
      case "settings:clear-bitbucket-credentials":
        await this.options.codeHostSecrets.clearBitbucketCredentials();
        this.options.codeHostRouter.clearClientCache("bitbucket");
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("bitbucket");
        return;
      case "settings:test-code-host":
        await this.handleTestCodeHost(message.payload.provider, source);
        return;
      case "settings:update-slack-token":
        await this.options.integrationSecrets.setSlackToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("slack");
        return;
      case "settings:clear-slack-token":
        await this.options.integrationSecrets.clearSlackToken();
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("slack");
        return;
      case "settings:update-jira-credentials":
        await this.options.integrationSecrets.setJiraCredentials(
          message.payload.email,
          message.payload.token,
          message.payload.baseUrl
        );
        if (message.payload.baseUrl?.trim()) {
          await updateConfiguration({ jiraBaseUrl: message.payload.baseUrl.trim().replace(/\/+$/, "") });
        }
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("jira");
        return;
      case "settings:clear-jira-credentials":
        await this.options.integrationSecrets.clearJiraCredentials();
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("jira");
        return;
      case "settings:update-teams-token":
        await this.options.integrationSecrets.setTeamsToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("teams");
        return;
      case "settings:clear-teams-token":
        await this.options.integrationSecrets.clearTeamsToken();
        await this.refreshAllSessionsPreferences();
        await this.options.healthMonitor.force("teams");
        return;
      case "settings:test-integration":
        await this.handleTestIntegration(message.payload.provider, source);
        return;
      case "degradation:retry":
        await this.options.healthMonitor.force(message.payload?.provider as IntegrationProvider | undefined);
        return;
      case "degradation:refresh":
        await this.handleDegradationRefresh(message.payload);
        return;
      case "conflict:action":
        this.handleConflictAction(message.payload.conflictId, message.payload.action);
        return;
      case "job:cancel":
        await this.handleJobCancel(message.payload.jobId);
        return;
      case "job:view-results":
        await this.handleJobViewResults(message.payload.jobId);
        return;
      default:
        return;
    }
  }

  private async refreshAllSessionsPreferences(): Promise<void> {
    for (const session of coopSessionRegistry.getAll()) {
      await session.refreshPreferences();
    }
  }

  private refreshIntentConfiguration(): void {
    this.intentConfig = readIntentConfiguration();
    this.intentDebouncer.updateRules(this.intentConfig.debounceRules);
    this.requestBatcher.cancelAll("Intent configuration changed.");
    this.requestPrioritizer.clear("Intent configuration changed.");
    this.requestBatcher = this.createRequestBatcher();
    this.requestPrioritizer = this.createRequestPrioritizer();
  }

  private createRequestBatcher(): RequestBatcher {
    return new RequestBatcher(
      async (requests) => {
        const executor = this.createRateLimitExecutor();
        return executor.executeMany(requests, (request) => this.fetchContextRequest(request));
      },
      { config: this.intentConfig.batching }
    );
  }

  private createRequestPrioritizer(): RequestPrioritizer {
    return new RequestPrioritizer({
      config: this.intentConfig.prioritization
    });
  }

  private createRateLimitExecutor(): RateLimitAwareExecutor {
    return new RateLimitAwareExecutor({
      config: this.intentConfig.rateLimitAware,
      cache: {
        get: (key) => this.contextFetchCache.get(key),
        set: (key, value) => {
          this.contextFetchCache.set(key, value);
        }
      }
    });
  }

  private async handleEditorIntent(event: IntentEvent): Promise<ContextFetchResult[]> {
    this.currentContext = {
      ...this.currentContext,
      ...intentContextToRepoContext(event.context)
    };
    this.postContext();
    return this.runIntentFetch(event, { quiet: true });
  }

  private async handleRemoteFileIntent(path: string): Promise<void> {
    this.currentContext = {
      ...this.currentContext,
      file: path,
      fileSource: "remote",
      contextWarning: undefined
    };
    this.postContext();
    if (this.currentContext.owner && this.currentContext.repo) {
      await openRemoteFileInEditor({
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        filePath: path,
        provider: this.currentContext.provider ?? this.preferences.defaultCodeHost,
        branch: this.currentContext.branch
      });
    }
    const event = this.intentDetector.create(UserIntent.FILE_SWITCHED, {
      ...intentContextToRepoContext(repoContextToIntentContext(this.currentContext)),
      source: "webview"
    });
    const result = await this.intentDebouncer.debounce(event, (debounced) => this.handleEditorIntent(debounced));
    if (result.status === "blocked" || result.status === "cancelled") {
      return;
    }
  }

  private async runIntentFetch(
    event: IntentEvent,
    options: { quiet?: boolean } = {}
  ): Promise<ContextFetchResult[]> {
    const requestTypes = requestTypesForIntent(event);
    if (requestTypes.length === 0) {
      return [];
    }

    if (!options.quiet) {
      this.postIntentFeedback(this.loadingFeedbackFor(event));
    }

    const requests = buildContextRequests(event, requestTypes);
    const results = await Promise.all(
      requests.map((request) =>
        this.requestPrioritizer.enqueue(request, (prioritized) => this.requestBatcher.enqueue(prioritized))
      )
    );
    this.processConflicts(event, results);

    if (!options.quiet) {
      const stale = results.find((result) => result.stale);
      const error = results.find((result) => result.error);
      if (stale) {
        this.postIntentFeedback({
          status: "rate-limited",
          intent: event.intent,
          actionId: event.context.buttonClicked,
          title: "Using cached context",
          message: stale.message,
          stale: true
        });
      } else if (error) {
        this.postIntentFeedback({
          status: "error",
          intent: event.intent,
          actionId: event.context.buttonClicked,
          title: "Context fetch failed",
          message: error.error
        });
      } else {
        const partialTrace = results.find(
          (result) =>
            result.type === "decision_history" &&
            (result.data as { timeline?: { completeness?: string; warnings?: string[] } } | undefined)?.timeline
              ?.completeness !== "full"
        );
        const timeline = (
          partialTrace?.data as { timeline?: { completeness?: string; warnings?: string[] } } | undefined
        )?.timeline;
        if (timeline) {
          this.postIntentFeedback({
            status: "warning",
            intent: event.intent,
            actionId: event.context.buttonClicked,
            title: timeline.completeness === "minimal" ? "Minimal trace" : "Partial trace",
            message: partialTrace?.message ?? "GitHub returned limited history for this file."
          });
        } else {
          this.postIntentFeedback({
            status: "complete",
            intent: event.intent,
            actionId: event.context.buttonClicked,
            title: "Context ready",
            message: completionMessageFor(event)
          });
        }
      }
    }

    this.lastContextBundle = results;
    return results;
  }

  private async fetchContextRequest(request: ContextFetchRequest): Promise<ContextFetchResult> {
    if (this.degradationConfig.enableGracefulFallback) {
      const degraded = await runFeatureFallback({
        request,
        health: this.latestHealth,
        cache: this.options.degradationCache
      });
      if (degraded) {
        this.maybeNotifyDegradation(request, degraded);
        return degraded;
      }
    }
    return {
      requestId: request.id,
      type: request.type,
      data: this.localContextDataFor(request),
      fetchedAt: new Date()
    };
  }

  private localContextDataFor(request: ContextFetchRequest): Record<string, unknown> {
    const params = request.params;
    switch (request.type) {
      case "file_metadata":
        return {
          file: params.file,
          repoId: params.repoId,
          branch: params.branch,
          languageId: params.languageId,
          cached: true
        };
      case "ownership":
        return {
          file: params.file,
          likelyOwner: params.owner || "unknown",
          confidence: params.owner ? 0.7 : 0.2
        };
      case "blame":
        return {
          file: params.file,
          lines: params.lines,
          status: "lightweight-blame-placeholder"
        };
      case "dependencies":
        return {
          file: params.file,
          status: "dependency-graph-requested"
        };
      case "decision_history":
        return {
          file: params.file,
          status: "decision-history-requested"
        };
      case "knowledge_gaps":
        return {
          file: params.file,
          status: "knowledge-gap-scan-requested"
        };
      case "chat_context":
        return {
          context: this.currentContext
        };
      default:
        return {};
    }
  }

  private processConflicts(event: IntentEvent, results: ContextFetchResult[]): void {
    if (!this.conflictConfig.detectAndSurface) {
      return;
    }

    const detector = new ConflictDetector();
    const conflicts = detector
      .detect(this.conflictInputFromResults(event, results))
      .filter((conflict) => hasSeverityAtLeast(conflict.severity, this.conflictConfig.severityThreshold));
    if (conflicts.length === 0) {
      return;
    }

    const resolver = new ConflictResolutionStrategy({
      autoResolve: this.conflictConfig.autoResolve,
      scorer: new SourceAuthorityScorer({ trustOrder: this.conflictConfig.trustOrder })
    });
    const resolutions = resolver.resolveMany(conflicts);
    if (this.conflictConfig.auditTrail) {
      this.conflictAudit.recordMany(conflicts, resolutions);
    }

    const summaries = conflicts.map((conflict, index) => toConflictSummary(conflict, resolutions[index]));
    this.currentConflictState = {
      status: "detected",
      conflicts: summaries,
      updatedAt: new Date().toISOString()
    };
    this.post({ type: "conflict:update", payload: this.currentConflictState });
  }

  private conflictInputFromResults(event: IntentEvent, results: ContextFetchResult[]): ConflictDetectionInput {
    const byType = new Map(results.map((result) => [result.type, asRecord(result.data)]));
    const repoId = event.context.repoId;
    const file = event.context.file;
    const ownership = byType.get("ownership");
    const decision = byType.get("decision_history");
    const gaps = byType.get("knowledge_gaps");
    const metadataConflicts = collectMetadataConflicts(repoId, file, byType);

    return {
      ownership: ownership
        ? [
            {
              repoId,
              file,
              github: {
                owner: stringValue(ownership.githubOwner) ?? stringValue(ownership.owner) ?? stringValue(ownership.likelyOwner),
                ownershipScore: numberValue(ownership.confidence),
                recentCommits: numberValue(ownership.recentCommits)
              },
              jira: {
                assignee: stringValue(ownership.jiraAssignee),
                lastUpdated: dateValue(ownership.jiraLastUpdated),
                ticket: stringValue(ownership.jiraTicket)
              },
              slack: {
                mentionedOwner: stringValue(ownership.slackOwner),
                lastUpdated: dateValue(ownership.slackLastUpdated),
                mentions: numberValue(ownership.slackMentions)
              }
            }
          ]
        : [],
      decisions: decision
        ? [
            {
              repoId,
              file,
              slack: {
                decision: stringValue(decision.slackDecision),
                lastUpdated: dateValue(decision.slackLastUpdated)
              },
              teams: {
                decision: stringValue(decision.teamsDecision),
                lastUpdated: dateValue(decision.teamsLastUpdated)
              },
              pr: {
                decision: stringValue(decision.prDecision),
                lastUpdated: dateValue(decision.prLastUpdated)
              },
              code: {
                pattern: stringValue(decision.codePattern),
                lastModified: dateValue(decision.codeLastModified)
              }
            }
          ]
        : [],
      documentation: gaps
        ? [
            {
              repoId,
              file,
              docs: {
                status: stringValue(gaps.docsStatus),
                lastReviewed: dateValue(gaps.docsLastReviewed),
                source: stringValue(gaps.docsSource) ?? "documentation",
                title: stringValue(gaps.docsTitle),
                url: stringValue(gaps.docsUrl)
              },
              code: {
                status: stringValue(gaps.codeStatus),
                pattern: stringValue(gaps.codePattern),
                lastModified: dateValue(gaps.codeLastModified),
                path: file
              }
            }
          ]
        : [],
      statuses: gaps
        ? [
            {
              repoId,
              file,
              issue: {
                status: stringValue(gaps.issueStatus),
                id: stringValue(gaps.issueId),
                lastUpdated: dateValue(gaps.issueLastUpdated)
              },
              code: {
                status: stringValue(gaps.codeStatus),
                completion: codeCompletion(gaps.codeCompletion),
                lastModified: dateValue(gaps.codeLastModified)
              }
            }
          ]
        : [],
      metadata: metadataConflicts
    };
  }

  private handleConflictAction(conflictId: string, action: "accept-authoritative" | "dismiss" | "escalate"): void {
    const auditAction = action === "accept-authoritative" ? "accepted" : action === "dismiss" ? "dismissed" : "escalated";
    this.conflictAudit.recordUserAction(conflictId, auditAction);
    this.currentConflictState = {
      status: this.currentConflictState.conflicts.length <= 1 ? "resolved" : "detected",
      conflicts: this.currentConflictState.conflicts.filter((conflict) => conflict.id !== conflictId),
      updatedAt: new Date().toISOString()
    };
    this.post({ type: "conflict:update", payload: this.currentConflictState });
  }

  private loadingFeedbackFor(event: IntentEvent): IntentFeedbackState {
    const action = event.context.buttonClicked;
    if (action === "blast-radius") {
      return {
        status: "loading",
        intent: event.intent,
        actionId: action,
        title: "Analyzing dependencies...",
        message: "Building change impact context before sending your prompt.",
        progress: 35
      };
    }
    if (action === "knowledge-gaps") {
      return {
        status: "warning",
        intent: event.intent,
        actionId: action,
        title: "Scanning for knowledge gaps",
        message: "This may scan broad repo context and can take longer on large repositories.",
        progress: 15
      };
    }
    return {
      status: "loading",
      intent: event.intent,
      actionId: action,
      title: "Fetching context...",
      message: event.costEstimate === "expensive" ? "Gathering deeper repo context." : "Updating lightweight context."
    };
  }

  private testFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Connection test failed.";
  }

  private async handleTestConnection(source: "chat" | "settings"): Promise<void> {
    try {
      const result = await this.options.api.testConnection(this.preferences.apiBaseUrl);
      this.publishTestResult(result, source);
    } catch (error) {
      this.publishTestResult({ ok: false, message: this.testFailureMessage(error) }, source);
    }
  }

  private async handleTestCodeHost(
    provider: import("./types").CodeHostProviderPreference,
    source: "chat" | "settings"
  ): Promise<void> {
    try {
      this.options.codeHostRouter.clearClientCache(provider);
      const result = await this.options.codeHostRouter.testProvider(provider);
      this.publishTestResult(result, source);
      if (result.ok) {
        await this.options.healthMonitor.force(provider);
      }
    } catch (error) {
      this.publishTestResult({ ok: false, message: this.testFailureMessage(error) }, source);
    }
  }

  private async handleTestIntegration(
    provider: import("./types").DecisionIntegrationProvider,
    source: "chat" | "settings"
  ): Promise<void> {
    try {
      const { testDecisionIntegration } = await import("../api/integrations/integrationTest");
      const result = await testDecisionIntegration(provider, this.options.integrationSecrets);
      this.publishTestResult(result, source);
      if (result.ok) {
        await this.options.healthMonitor.force(provider);
      }
    } catch (error) {
      this.publishTestResult({ ok: false, message: this.testFailureMessage(error) }, source);
    }
  }

  private publishTestResult(
    result: { ok: boolean; message: string },
    source: "chat" | "settings"
  ): void {
    if (source === "settings") {
      this.postToSettings({ type: "settings:test-result", payload: result });
    } else {
      this.postToChat({ type: "settings:test-result", payload: result });
    }
    if (result.ok) {
      void vscode.window.showInformationMessage(result.message);
    } else {
      void vscode.window.showWarningMessage(result.message);
    }
  }

  private async handleChatSend(
    message: string,
    quickAction?: string,
    attachments?: ChatImageAttachment[]
  ): Promise<void> {
    const content = quickAction ? `[${quickAction}] ${message}` : message;
    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined
    };
    this.chatHistory.push(userMessage);
    if (this.chatHistory.length === 1) {
      this.options.onTitleChange?.(titleFromMessage(content || attachments?.[0]?.name || "Image attachment"));
    }
    this.post({ type: "chat:history", payload: this.chatHistory });

    if (quickAction && shouldUseAsyncJob(quickAction)) {
      const ranAsync = await this.runAsyncQuickAction(quickAction, message);
      if (ranAsync) {
        const intentEvent = this.intentDetector.fromQuickAction(quickAction, this.currentContext);
        await this.runIntentFetch(intentEvent, { quiet: true });
        await this.continueChatAfterContext(content, undefined, attachments);
        return;
      }
    }

    const intentEvent = quickAction
      ? this.intentDetector.fromQuickAction(quickAction, this.currentContext)
      : this.intentDetector.fromManualChatSubmit(this.currentContext);
    await this.runIntentFetch(intentEvent);
    if (quickAction === "trace-decision") {
      this.postDecisionTimelineFromBundle();
    }
    await this.continueChatAfterContext(content, quickAction, attachments);
  }

  private postDecisionTimelineFromBundle(): void {
    const entry = this.lastContextBundle.find((result) => result.type === "decision_history");
    const data = entry?.data as { timeline?: DecisionTimeline } | undefined;
    const timeline = data?.timeline;
    if (!timeline) {
      return;
    }

    const enriched: DecisionTimeline = {
      ...timeline,
      lineRange: timeline.lineRange ?? lineRangeFromContext(this.currentContext),
      codeSnippet: timeline.codeSnippet ?? this.selectedCodeSnippet()
    };

    this.post({
      type: "decision:timeline",
      payload: { timeline: enriched }
    });
  }

  private lineRangeFromContext(context: RepoContext): { start: number; end: number } | undefined {
    if (!context.selectedLines || context.selectedLines.length !== 2) {
      return undefined;
    }
    return { start: context.selectedLines[0], end: context.selectedLines[1] };
  }

  private selectedCodeSnippet(maxLength = 4000): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return undefined;
    }
    return editor.document.getText(editor.selection).slice(0, maxLength);
  }

  private decisionTimelineFromBundle(): DecisionTimeline | undefined {
    const entry = this.lastContextBundle.find((result) => result.type === "decision_history");
    return (entry?.data as { timeline?: DecisionTimeline } | undefined)?.timeline;
  }

  private async continueChatAfterContext(
    content: string,
    quickAction?: string,
    attachments?: ChatImageAttachment[]
  ): Promise<void> {
    const cacheKey = JSON.stringify({
      content,
      attachments,
      context: this.currentContext,
      model: this.preferences.model,
      provider: this.preferences.llmProvider
    });
    if (this.preferences.useCachedResponses) {
      const cached = this.readCache(cacheKey);
      if (cached) {
        this.post({ type: "chat:complete", payload: { message: cached as ChatMessage } });
        this.chatHistory.push(cached as ChatMessage);
        this.post({ type: "chat:history", payload: this.chatHistory });
        return;
      }
    }

    const token = ++this.streamToken;
    this.streamAbortController?.abort();
    this.streamAbortController = new AbortController();
    const signal = this.streamAbortController.signal;
    let full = "";

    try {
      const decisionTimeline = this.decisionTimelineFromBundle();
      const llmMessage =
        quickAction === "trace-decision" && decisionTimeline
          ? buildDecisionSynthesisUserPrompt({
              timeline: decisionTimeline,
              file: this.currentContext.file ?? decisionTimeline.file,
              lineRange: decisionTimeline.lineRange,
              codeSnippet: decisionTimeline.codeSnippet,
              userQuestion: content
            })
          : content;

      const result = await this.options.api.streamChat(
        {
          message: llmMessage,
          context: {
            ...this.currentContext,
            contextBundle: this.lastContextBundle.map((entry) => ({
              type: entry.type,
              data: entry.data,
              stale: entry.stale,
              error: entry.error
            }))
          },
          history: this.chatHistory,
          attachments: attachments?.length ? attachments : undefined,
          model: this.preferences.model,
          provider: this.preferences.llmProvider,
          useCase: useCaseFromQuickAction(quickAction),
          temperature: this.preferences.temperature,
          maxTokens: this.preferences.maxTokens
        },
        (chunk) => {
          if (token !== this.streamToken) {
            return;
          }
          full += chunk;
          this.post({ type: "chat:delta", payload: { chunk } });
        },
        this.preferences.apiBaseUrl,
        signal
      );

      if (token !== this.streamToken) {
        return;
      }

      const finalMessage = { ...result.message, content: full };
      this.chatHistory.push(finalMessage);
      this.post({ type: "chat:complete", payload: { message: finalMessage } });
      this.post({ type: "chat:history", payload: this.chatHistory });
      this.writeCache(cacheKey, finalMessage);

      if (result.usage) {
        this.sessionCostUsd += result.usage.estimatedCostUsd;
        this.post({
          type: "chat:usage",
          payload: {
            ...result.usage,
            sessionCostUsd: this.sessionCostUsd
          }
        });
      }
    } catch (error) {
      if (token !== this.streamToken) {
        return;
      }
      const message = error instanceof Error ? error.message : "Chat request failed.";
      this.post({ type: "chat:error", payload: { message } });
    }
  }

  private async runAsyncQuickAction(quickAction: string, _message: string): Promise<boolean> {
    const jobType = jobTypeForQuickAction(quickAction);
    if (!jobType) {
      return false;
    }

    const repoId = buildRepoId(this.preferences, this.currentContext);
    const jobToken = ++this.jobRunToken;
    this.jobClient.setBaseUrl(resolveCoopBaseUrl().baseUrl);
    this.postJobProgress({
      jobId: "pending",
      status: "queued",
      title: jobTitleForAction(quickAction),
      message: "Starting scan... (this may take a minute)",
      progress: 5
    });

    try {
      const submit = await this.jobClient.submitJob({
        type: jobType,
        priority: "normal",
        params: {
          repoId,
          file: this.currentContext.file,
          branch: this.currentContext.branch ?? this.preferences.branch,
          owner: this.currentContext.owner ?? this.preferences.owner,
          repo: this.currentContext.repo ?? this.preferences.repo
        },
        userId: vscode.env.machineId
      });

      this.activeJobId = submit.jobId;
      this.postJobProgress({
        jobId: submit.jobId,
        status: "queued",
        title: jobTitleForAction(quickAction),
        message: `Job #${submit.jobId.slice(0, 8)} queued.`,
        progress: 10,
        estimatedWaitTime: submit.estimatedWaitTime
      });

      const resultPayload = await this.jobClient.pollUntilComplete(submit.jobId, (event) => {
        if (jobToken !== this.jobRunToken) {
          throw new Error("Job aborted");
        }
        this.postJobProgress({
          jobId: event.jobId,
          status: event.status === "partial" ? "partial" : event.status,
          title: jobTitleForAction(quickAction),
          message: event.message,
          progress: event.progress,
          estimatedTimeRemaining: event.etaMs ? formatWaitTime(event.etaMs) : undefined
        });
      });

      const result = (resultPayload.result ?? resultPayload) as Record<string, unknown>;
      this.lastJobResult = result;
      const summary = extractGapSummary(result);
      this.post({
        type: "job:complete",
        payload: {
          jobId: submit.jobId,
          status: String(result.status ?? resultPayload.status ?? "completed") === "partial" ? "partial" : "completed",
          title: jobTitleForAction(quickAction),
          message: "Scan complete",
          progress: 100,
          resultSummary: summary,
          result
        }
      });
      return true;
    } catch (error) {
      if (jobToken !== this.jobRunToken) {
        return false;
      }
      const message = error instanceof Error ? error.message : "Background job failed";
      this.postJobProgress({
        jobId: this.activeJobId ?? "unknown",
        status: "failed",
        title: jobTitleForAction(quickAction),
        message,
        progress: 0
      });
      return false;
    }
  }

  private async handleJobCancel(jobId: string): Promise<void> {
    try {
      await this.jobClient.cancelJob(jobId);
      this.postJobProgress({
        jobId,
        status: "cancelled",
        title: "Job cancelled",
        message: "The job was cancelled before it started.",
        progress: 0
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to cancel job";
      void vscode.window.showWarningMessage(message);
    }
  }

  private async handleJobViewResults(jobId: string): Promise<void> {
    try {
      const payload = await this.jobClient.getJobResult(jobId);
      const formatted = JSON.stringify(payload.result ?? payload, null, 2);
      const doc = await vscode.workspace.openTextDocument({
        content: formatted,
        language: "json"
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load job results";
      void vscode.window.showWarningMessage(message);
    }
  }

  private postJobProgress(payload: JobProgressPayload): void {
    this.post({ type: "job:progress", payload });
  }

  private async handleRepoListRepos(): Promise<void> {
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    this.post({
      type: "repo:tree",
      payload: { path: "", items: [], loading: true, provider, scope: "repos" }
    });
    try {
      const repos = await this.options.codeHostRouter.listExplorerRepositories({
        provider: this.currentContext.provider,
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        branch: this.currentContext.branch
      });
      const items = repos.map((entry) => ({
        path: `${entry.provider ?? provider}:${entry.owner}/${entry.repo}`,
        name: `${entry.owner}/${entry.repo}`,
        type: "repo" as const
      }));
      this.post({
        type: "repo:tree",
        payload: { path: "", items, provider, scope: "repos" }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load repositories.";
      this.post({
        type: "repo:tree",
        payload: { path: "", items: [], error: message, provider, scope: "repos" }
      });
    }
  }

  private async handleRepoSelect(payload: {
    provider: RepoContext["provider"];
    owner: string;
    repo: string;
    branch?: string;
  }): Promise<void> {
    this.setRepoContext(payload);
    await openRepoInEditor({
      owner: payload.owner,
      repo: payload.repo,
      provider: payload.provider ?? this.currentContext.provider ?? this.preferences.defaultCodeHost,
      branch: payload.branch ?? this.currentContext.branch
    });
    await this.handleRepoList("");
  }

  private async handleRepoList(path: string): Promise<void> {
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    this.post({
      type: "repo:tree",
      payload: { path, items: [], loading: true, provider, scope: "files" }
    });
    try {
      const tree = await this.options.codeHostRouter.getRepositoryTree(path, {
        provider,
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        branch: this.currentContext.branch
      });
      const items = tree.entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        updatedAt: entry.lastModified
      }));
      this.post({
        type: "repo:tree",
        payload: { path: tree.path, items, provider, scope: "files" }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load remote tree.";
      this.post({
        type: "repo:tree",
        payload: { path, items: [], error: message, provider, scope: "files" }
      });
    }
  }

  private applyDefaultRepoToContext(): void {
    this.currentContext = {
      ...this.currentContext,
      provider: this.currentContext.provider || this.preferences.defaultCodeHost,
      owner: this.currentContext.owner || this.preferences.owner || undefined,
      repo: this.currentContext.repo || this.preferences.repo || undefined,
      branch: this.currentContext.branch || this.preferences.branch || undefined
    };
  }

  private syncDescription(): void {
    const description = this.currentContext.file ?? "No active file";
    this.options.onDescriptionChange?.(description);
  }

  private postContext(): void {
    this.syncDescription();
    this.post({ type: "context:update", payload: this.currentContext });
  }

  private postIntentFeedback(payload: IntentFeedbackState): void {
    this.post({ type: "intent:feedback", payload });
  }

  private postHealth(health: IntegrationHealth[]): void {
    this.post({
      type: "degradation:health",
      payload: health.map(toHealthPayload)
    });
  }

  private async pushDegradationState(): Promise<void> {
    const health = await this.options.healthMonitor.getAll();
    this.latestHealth = health;
    this.postHealth(health);
    this.postFeatureStatuses(health);
  }

  private postFeatureStatuses(health: IntegrationHealth[]): void {
    this.post({
      type: "degradation:feature-status",
      payload: featureStatuses(health)
    });
  }

  private async handleDegradationRefresh(payload?: { feature?: string; retrace?: boolean }): Promise<void> {
    this.contextFetchCache.clear();
    await this.options.degradationCache.clear();
    this.options.codeHostRouter.clearClientCache();

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const next = repoContextFromEditor(editor, this.preferences, this.currentContext);
      this.currentContext = {
        ...this.currentContext,
        ...next,
        file: next.file ? toRepositoryRelativePath(next.file) : next.file
      };
      this.postContext();
    } else if (this.currentContext.file) {
      this.currentContext = {
        ...this.currentContext,
        file: toRepositoryRelativePath(this.currentContext.file)
      };
      this.postContext();
    }

    await this.options.healthMonitor.force();

    if (payload?.retrace && this.currentContext.file) {
      this.postIntentFeedback({
        status: "loading",
        intent: UserIntent.QUICK_ACTION_CLICKED,
        actionId: "trace-decision",
        title: "Refreshing trace",
        message: "Fetching fresh GitHub history…",
        progress: 35
      });
      const event = this.intentDetector.fromQuickAction("trace-decision", this.currentContext);
      await this.runIntentFetch(event);
      this.postDecisionTimelineFromBundle();
      return;
    }

    this.postDegradationNotification({
      id: `refresh-${Date.now()}`,
      severity: "info",
      title: "Cache cleared",
      message: "Stale context cache cleared. Run Trace Decision again for a fresh trace.",
      feature: payload?.feature,
      action: "refresh"
    });
  }

  private postDegradationNotification(payload: DegradationNotificationPayload): void {
    if (!this.degradationConfig.notifyUser) {
      return;
    }
    if (this.degradationConfig.userNotificationLevel === "critical" && payload.severity !== "critical") {
      return;
    }
    if (this.degradationConfig.userNotificationLevel === "warnings" && payload.severity === "info") {
      return;
    }
    this.post({ type: "degradation:notification", payload });
  }

  private maybeNotifyDegradation(request: ContextFetchRequest, result: ContextFetchResult): void {
    if (!result.stale && !result.error) {
      return;
    }
    const action = request.params.quickAction;
    this.postDegradationNotification({
      id: `${request.id}:degradation`,
      severity: result.error ? "critical" : "warning",
      title: result.error ? "Context unavailable" : "Using best-effort context",
      message: result.message ?? result.error ?? "Showing degraded context.",
      feature: typeof action === "string" ? action : undefined,
      action: result.error ? "retry" : "refresh"
    });
  }

  private postToChat(message: WebviewOutbound): void {
    void this.webview?.postMessage(message);
  }

  private postToSettings(message: WebviewOutbound): void {
    void this.settingsWebview?.postMessage(message);
  }

  /** @deprecated Use postToChat for chat-only messages */
  private post(message: WebviewOutbound): void {
    this.postToChat(message);
  }

  private async pushSettingsState(): Promise<void> {
    const message: WebviewOutbound = { type: "settings:state", payload: this.preferences };
    this.postToChat(message);
    this.postToSettings(message);
  }

  private postTheme(): void {
    const mode: ThemeMode = activeThemeMode();
    const payload: ThemePayload = { mode };
    const message: WebviewOutbound = { type: "theme:update", payload };
    this.postToChat(message);
    this.postToSettings(message);
  }

  private writeCache(key: string, value: unknown): void {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private readCache(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public async pushWorkspacePrompts(): Promise<void> {
    const prompts = await loadWorkspacePrompts();
    const validIds = new Set(prompts.map((entry) => entry.id));
    let pinnedIds = await loadPinnedPromptIds(this.options.extensionContext);
    const pruned = prunePinnedPromptIds(pinnedIds, validIds);
    if (pruned.length !== pinnedIds.length) {
      pinnedIds = await savePinnedPromptIds(this.options.extensionContext, pruned);
    } else {
      pinnedIds = pruned;
    }
    const payload = {
      prompts: prompts.map((entry) => ({
        id: entry.id,
        title: entry.title,
        template: entry.template,
        actionId: entry.actionId
      })),
      pinnedIds,
      hasWorkspace: hasWorkspaceFolder()
    };
    const message: WebviewOutbound = { type: "prompts:list", payload };
    this.postToChat(message);
    this.postToSettings(message);
  }

  public async broadcastPromptLibrary(): Promise<void> {
    for (const session of coopSessionRegistry.getAll()) {
      await session.pushWorkspacePrompts();
    }
  }
}

function buildRepoId(preferences: UserPreferences, context: RepoContext): string {
  const owner = context.owner ?? preferences.owner;
  const repo = context.repo ?? preferences.repo;
  const provider = context.provider ?? preferences.defaultCodeHost;
  if (owner && repo) {
    return `${provider}:${owner}/${repo}`;
  }
  return `${provider}:unknown/unknown`;
}

function jobTitleForAction(actionId: string): string {
  switch (actionId) {
    case "knowledge-gaps":
      return "Scanning for knowledge gaps";
    case "blast-radius":
      return "Building dependency graph";
    case "understand-repo":
      return "Generating repository summary";
    default:
      return "Running background job";
  }
}

function extractGapSummary(result: Record<string, unknown>): JobProgressPayload["resultSummary"] | undefined {
  if (typeof result.foundGaps !== "number") {
    const nested = result.results as Record<string, unknown> | undefined;
    if (nested && typeof nested.foundGaps === "number") {
      return {
        foundGaps: Number(nested.foundGaps),
        highPriority: Number(nested.highPriority ?? 0),
        mediumPriority: Number(nested.mediumPriority ?? 0),
        lowPriority: Number(nested.lowPriority ?? 0)
      };
    }
    return undefined;
  }
  return {
    foundGaps: Number(result.foundGaps),
    highPriority: Number(result.highPriority ?? 0),
    mediumPriority: Number(result.mediumPriority ?? 0),
    lowPriority: Number(result.lowPriority ?? 0)
  };
}

function completionMessageFor(event: IntentEvent): string {
  if (event.context.buttonClicked === "blast-radius") {
    return "Dependency context is ready.";
  }
  if (event.context.buttonClicked === "knowledge-gaps") {
    return "Knowledge-gap context is ready.";
  }
  if (event.context.buttonClicked) {
    return "Quick action context is ready.";
  }
  return "Context is ready.";
}

function toConflictSummary(
  conflict: DetectedConflict,
  resolution: ReturnType<ConflictResolutionStrategy["resolve"]>
): ConflictSummary {
  return {
    id: conflict.id,
    type: conflict.type,
    severity: conflict.severity,
    title: titleForConflict(conflict.type, conflict.severity),
    message: conflict.message,
    recommendation: resolution.recommendation,
    authoritative: resolution.authoritative,
    alternatives: resolution.alternatives,
    actionRequired: resolution.actionRequired,
    detectedAt: conflict.detectedAt.toISOString(),
    file: conflict.file,
    repoId: conflict.repoId
  };
}

function titleForConflict(type: string, severity: ConflictSeverity): string {
  const label = type.toLowerCase().replace(/_/g, " ");
  return `${severity.toUpperCase()} ${label}`;
}

function collectMetadataConflicts(
  repoId: string | undefined,
  file: string | undefined,
  byType: Map<string, Record<string, unknown>>
): MetadataConflictInput[] {
  const all = [...byType.values()];
  return all.flatMap((data) => {
    const message = stringValue(data.metadataConflict);
    if (!message) {
      return [];
    }
    const leftSource = stringValue(data.leftSource) ?? "github";
    const rightSource = stringValue(data.rightSource) ?? "jira_ticket";
    return [
      {
        repoId,
        file,
        kind: stringValue(data.metadataKind),
        message,
        severity: severityValue(data.metadataSeverity),
        sources: [
          {
            source: leftSource,
            label: stringValue(data.leftLabel),
            value: data.leftValue,
            lastUpdated: dateValue(data.leftLastUpdated)
          },
          {
            source: rightSource,
            label: stringValue(data.rightLabel),
            value: data.rightValue,
            lastUpdated: dateValue(data.rightLastUpdated)
          }
        ],
        suggestedResolution: stringValue(data.metadataSuggestedResolution)
      }
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function severityValue(value: unknown): ConflictSeverity | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : undefined;
}

function codeCompletion(value: unknown): "complete" | "partial" | "unfinished" | "unknown" | undefined {
  return value === "complete" || value === "partial" || value === "unfinished" || value === "unknown"
    ? value
    : undefined;
}

function toHealthPayload(health: IntegrationHealth): IntegrationHealthPayload {
  return {
    provider: health.provider,
    status: health.status,
    lastCheck: health.lastCheck.toISOString(),
    error: health.error,
    recoveryStrategy: health.recoveryStrategy,
    latency: health.latency,
    errorRate: health.errorRate
  };
}
