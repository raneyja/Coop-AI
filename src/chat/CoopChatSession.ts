import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { handlePatchComplete } from "../edit/handlePatchComplete";
import {
  applyPendingPatch,
  applyPendingPatchHunk,
  rejectPendingPatchHunk,
  rejectPendingPatchWithState,
  resolvePatchCardsSnapshot,
  setPendingPatchMatchLocations,
  setPendingSharedMatchProposal,
  undoLastPatchWithState
} from "../edit/patchActions";
import { setLastEditUserMessage } from "../edit/patchSession";
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
import { providersForFeature, type QuickActionFeatureId } from "../degradation/fallbackMatrix";
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
import {
  contextGatheringMessagesFor,
  isPlainChatIntent,
  type ContextGatheringMessageOptions
} from "../context/contextGatheringMessages";
import { appendThinkingProcessingTerms } from "../context/thinkingProcessingTerms";
import { CacheEntry, RateLimitAwareExecutor } from "../context/rateLimitAwareExecution";
import { createChatOutputGate, delayUntilMinResponseVisible } from "./chatResponseTiming";
import { ThreadRunManager, SESSION_RUN_THREAD_ID, type ChatTurn } from "./chatTurn";
import {
  abortablePromise,
  clearResponseDeadlineForSynthesis,
  isSoftGatherLatencyMessage,
  remainingContextGatherBudgetMs
} from "../config/responseDeadline";
import { renderWebviewHtml } from "./renderWebviewHtml";
import { ensureSidebarMinWidth } from "../ui/ensureSidebarMinWidth";
import type {
  CachedValue,
  ChatFileMention,
  ChatImageAttachment,
  ChatMessage,
  ChatPersistedArtifact,
  ConflictResolutionState,
  ConflictSummary,
  ComposerMode,
  DegradationNotificationPayload,
  IntentFeedbackState,
  MentionSearchResult,
  PatchCardState,
  PatchCardsUpdatePayload,
  RepoContext,
  ThemeMode,
  ThemePayload,
  SettingsStatePayload,
  UserPreferences,
  WebviewInbound,
  WebviewOutbound
} from "./types";
import { clearPresenceCaches } from "../api/slack/presenceCheck";
import { EMPTY_IDENTITY_DIRECTORY } from "../identity/types";
import { CACHE_TTL_MS } from "./types";
import {
  deliverableForQuickAction,
  displayStatusForChatDeliverable
} from "../jobs/jobActivityPolicy";
import { JobApiClient, jobTypeForQuickAction, shouldUseAsyncJob } from "../jobs/JobApiClient";
import { formatWaitTime } from "../jobs/types";
import type { JobProgressPayload } from "./types";
import { resolveCoopBaseUrl } from "../api/resolveBaseUrl";
import { syncAllThreadsToBackend, syncThreadToBackend } from "./threadSync";
import { resolveGitUserEmail } from "./resolveGitUserEmail";
import { formatUserFacingNetworkError } from "../api/userFacingErrors";
import { ChatQuotaExceededError } from "../api/CoopBackendClient";
import { CHAT_STOPPED_MESSAGE } from "./chatStopped";
import { buildQuotaExceededUpgradeUrl, isFreeQuotaExhausted } from "./quotaNotice";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport } from "../types/ownership";
import { buildDecisionSynthesisUserPrompt } from "../prompts/decisionSynthesis";
import { buildOwnershipSynthesisUserPrompt } from "../prompts/ownershipSynthesis";
import { buildRepoSummarySynthesisUserPrompt } from "../prompts/repoSummarySynthesis";
import { buildBlastRadiusSynthesisUserPrompt } from "../prompts/blastRadiusSynthesis";
import { buildKnowledgeGapsSynthesisUserPrompt } from "../prompts/knowledgeGapsSynthesis";
import { buildIntegrationSynthesisUserPrompt } from "../prompts/integrationSynthesis";
import {
  blastRadiusFromBundle,
  confluenceSearchFromBundle,
  contextBundleHasRepoFactEvidence,
  googleDocsSearchFromBundle,
  integrationSearchFromBundle,
  jiraSearchFromBundle,
  knowledgeGapsFromBundle,
  notionSearchFromBundle,
  repoSummaryFromBundle,
  slackSearchFromBundle,
  teamsSearchFromBundle,
  type RepoSummaryEvidence
} from "../context/contextBundleEvidence";
import { isIntegrationConnectedForSources } from "../context/integrationEvidenceVisibility";
import {
  extractBlastSearchSymbols,
  extractExportNamesFromSource,
  filterJobDependentsForFile,
  isTrustedBlastGraphSource,
  mergeDurableDependentsIntoContextData,
  mergeSearchDependentsFallbackIntoDependenciesData,
  resolveTrustedRemoteDependents,
  searchDependentsFallback
} from "../engines/blastRadiusDependentsFallback";
import { isFileCallerQuery } from "../context/fileCallerIntent";
import { repoIdFromCoordinates, type RepoCoordinates } from "../api/codeHosts/types";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import { resolveEffectiveQuickAction } from "./effectiveQuickAction";
import {
  buildMissingIntentClarificationResponse,
  shouldClarifyFirstChatTurn
} from "./chatMessageIntent";
import {
  filterSuggestableActions,
  offerFromActionId,
  shouldOfferQuickActionSuggest,
  suggestRunChipLabel
} from "./quickActionSuggestIntent";
import {
  classifyQuickActionIntent,
  type IntentSuggestCompleteFn
} from "./quickActionIntentModel";
import { isIntentSuggestModelEnabled } from "../config/intentSuggestConfig";
import {
  planChatIntentFromRules,
  classifyChatIntentPlan,
  resolveChatIntentExecution,
  buildIntentPlanActivityMessages,
  buildIntentPlanStatusLine,
  buildIntentPlanTrustPreamble,
  emptyChatIntentPlan,
  type ChatIntentPlan
} from "./intentPlanner";
import { buildMultiToolPlainChatUserPrompt } from "../prompts/multiToolPlainChatSynthesis";
import { CHAT_INTENT_TOOL_PROVIDERS } from "./intentPlanner/types";
import { enrichDecisionTimelineSourcePreviews } from "../context/enrichDecisionTimelineSourcePreviews";
import {
  EVIDENCE_PREVIEW_TIMEOUT_MS,
  type EvidencePreviewCompleteFn
} from "../context/evidencePreviewModel";
import { openReferencedLink } from "./openReferencedLink";
import {
  buildUserMessageWithContext,
  formatChatMessageWithLocalFiles,
  formatChatMessageWithMentionFiles,
  selectionTextFromContent,
  useCaseFromQuickAction,
  resolveChatUseCase
} from "../prompts/systemPrompts";
import {
  appendQuickActionMentionScope,
  quickActionHistoryContent,
  quickActionModelPrompt,
  quickActionPromptParts,
  type QuickActionMentionRef
} from "../prompts/quickActionPrompts";
import { getFeatureModelAssignment, resolveRuntimeModelForUseCase } from "../config/featureModelAssignments";
import {
  filterMentionsByInScopeKeys,
  allMentionsOutOfScopeForActiveRepo,
  mentionAttachmentKey,
  mentionsHaveOutOfScopeForActiveRepo,
  plainChatHistoryContent,
  plainChatRefersToAttachedFile,
  partitionMentionsForQuickAction,
  partitionMentionsForTraceDecision,
  withContextChipLine,
  historyContentHasScopeChips,
  formatSelectedLinesChip,
  type MentionScopeQuickAction
} from "../prompts/mentionScope";
import {
  buildOutOfScopeMentionOnlyResponse,
  resolveOutOfScopeMentionLabels
} from "../prompts/mentionResponseEnrichment";
import {
  parseSlashCommand,
  slashCommandHistoryContent,
  type ParsedSlashCommand
} from "../context/slashCommands";
import {
  assembleDualRepoCompareEvidence,
  dualRepoCompareHistoryContent,
  dualRepoCompareUserMessage,
  DUAL_REPO_COMPARE_MAX_FILES_PER_SIDE,
  DUAL_REPO_COMPARE_USAGE,
  parseDualRepoCompareArgs,
  type DualRepoComparePlan
} from "../context/dualRepoCompare";
import { isQuickActionId, type QuickActionId } from "../webview/types";
import type { IntegrationChatProvider } from "./types";
import {
  applyPromptTemplate,
  mergeComposerWithPromptTemplate,
  promptVariablesFromContext,
  resolvePromptLibraryRun
} from "../prompts/promptLibraryRun";
import {
  deleteWorkspacePrompt,
  hasWorkspaceFolder,
  loadWorkspacePrompts,
  replaceWorkspacePrompts,
  saveWorkspacePrompt,
  updateWorkspacePrompt,
  watchWorkspacePrompts,
  type WorkspacePromptEntry
} from "../prompts/workspacePromptLibrary";
import {
  loadPinnedPromptIds,
  prunePinnedPromptIds,
  savePinnedPromptIds,
  updatePinnedPromptIds
} from "../prompts/pinnedPrompts";
import { ChatThreadStore } from "./chatThreadStore";
import { readChatSessionIdleMs } from "../config/chatSessionConfig";
import { summarizeThreadTitle } from "./threadTitle";
import { type SettingsScreen, isSettingsScreen, migrateSettingsScreen } from "./settingsScreens";
import {
  inferContextScope,
  isExplicitRepoScope,
  normalizeRepoContext,
  repoContextForFile,
  repoContextForRepoSelect
} from "../context/contextScope";
import { mergeRepoContext, stripStaleContextWarning } from "../context/repoContextMerge";
import {
  dropForeignActiveFileEvidence,
  shouldIsolateActiveFileForQuickAction,
  shouldSkipLocalEditorAttachForRepoScope
} from "../workspace/repoEvidenceIsolation";
import { gatherPackageBoundaryEvidence } from "../workspace/repoPackageBoundaryEvidence";
import { buildRepoId } from "./buildRepoId";
import {
  buildTraceDecisionSearchSeeds,
  mergeTraceDecisionIntegrationEvidence
} from "../context/traceDecisionSearch";
import {
  isQuickActionBlocked,
  quickActionBlockedMessage,
  shouldSkipOpenFileAttach,
  shouldWarnOpenFileAttachFailure
} from "../context/quickActionScope";
import { collectOpenEditorFileRefs, collectOpenEditorPaths, editorContextFromRepoContext } from "../context/editorManifestContext";
import { PRICING_PAGE_URL } from "../config/siteConfig";
import { hybridEnrichContext } from "../indexing/hybridQuery";
import {
  mergeRepoSemanticContext,
  searchRepoForChat,
  searchRepoForFocusQuery
} from "../context/repoSemanticRetrieval";
import {
  focusQueryForRetrieval,
  mergeFocusFilesIntoEntryFiles
} from "../context/userFocusQuery";
import {
  knowledgeGapsFocusGatherTerms,
  knowledgeGapsFocusTopicGapStubs,
  knowledgeGapsGatherQuery,
  mergeKnowledgeGapsFocusStubsIntoScan,
  openFileRelatedToGapsFocus,
  resolveKnowledgeGapsAuditScope
} from "../context/knowledgeGapsFocus";
import { isCoopDevMode, readLightningBackend, updateLightningConfiguration } from "../config/lightningConfig";
import type { IndexBackend } from "../indexing/indexBackend";
import type { LightningStatusBar } from "../extension/lightningStatusBar";
import {
  attachLocalFilesToData,
  normalizeRelativePath,
  sliceFileContent,
  type LocalFileContextPayload
} from "../context/localFileContext";
import { applyLocalFallbackToResult, contextResultHasLocalFiles } from "../context/localContextMerge";
import { localFilesFromContextData } from "../context/localFileContext";
import {
  readExternalOpenFileForChat,
  pickEditorForContext,
  pickLocalEditorForContext,
  pickRemoteEditorForContext,
  resolveEditorFile
} from "../context/editorFileContext";
import { looksLikeAbsoluteDiskPath, isOsAbsoluteDiskPath } from "../context/outsideWorkspaceFile";
import {
  isRemoteProvenanceContext,
  isSameRepoFilePath,
  preserveRemoteChipSource
} from "../context/fileChipIdentity";
import { readOpenTabFilesForChat } from "../context/openTabFileContext";
import { pathsReferToSameFile, isRemoteTabAbsolutePath } from "../context/githubVfsUri";
import {
  resolveLocalAbsolutePath,
  searchLocalWorkspaceFiles
} from "../context/localFileResolver";
import { AGENTS_MD_FILENAME, AGENTS_MD_SKELETON } from "../context/agentsMdSkeleton";
import {
  getAttachedAgentsMdPath,
  setAttachedAgentsMdPath
} from "../context/agentsMdAttachmentStore";
import {
  formatProjectInstructionsBlock
} from "../context/projectInstructionsLoader";
import { loadProjectInstructionsCached } from "../context/projectInstructionsCache";
import { resolveProjectInstructionsState } from "../context/projectInstructionsStatus";
import { readProjectInstructionsEnabled } from "../config/projectInstructionsConfig";
import {
  MENTION_SEARCH_LIMIT,
  WORKSPACE_LOCAL_REPO_ID,
  dedupeHybridMentionResults,
  graphHitsToMentionResults,
  localPathsToMentionResults,
  mergeHybridMentionSearchResults,
  resolveMentionFileContent,
  rankMentionSearchResults
} from "./mentionSearchMerge";
import { isFreePlan, resolveSearchScopeForPlan } from "../license/licenseChecker";
import { resolvePlainChatIntegrationProvider } from "./integrationProviderRouting";
import { isIncidentShapedQuery, shouldFetchIncidentIntegrations } from "../context/incidentIntent";
import {
  isStatusTransitionAsk,
  buildStatusTransitionSynthesisUserPrompt,
  extractStatusTransitionEvidence,
  statusTransitionGatherQuery,
  type FollowedStatusFile,
  type StatusTransitionEvidence
} from "../context/statusTransitionGrounding";
import {
  buildEmailTemplateSynthesisUserPrompt,
  emailTemplateGatherQuery,
  extractHandlerFollowCandidates,
  handlerPathsForTriggeredJob,
  extractTriggeredJobNames,
  isEmailTemplateTicketAsk,
  matchEmailTemplatesInTree,
  resolveEmailTemplateCandidates,
  type FollowedJobFile
} from "../context/emailTemplateGrounding";
import {
  buildExistingCapabilitySynthesisUserPrompt,
  extractExistingCapabilityEvidence,
  isFeatureAddAsk,
  type ExistingCapabilityEvidence
} from "../context/existingCapabilityGrounding";
import {
  buildIncidentReconstructionUserPrompt,
  incidentIntegrationsFromBundle
} from "../prompts/incidentReconstruction";
import { enrichChatContextWithIntegrations as mergeIntegrationChatContext, contextBundleHasIntegrationSearch } from "../context/integrationChatEnrichment";
import {
  IndexedRepoWorkspace,
  localDiskMatchesTargetRepo,
  mergeRepoInventoryContext
} from "../workspace/IndexedRepoWorkspace";
import {
  enrichContextWithIndexedRepo,
  hasUnderstandRepoEntryBodies,
  readRepoFileForContext,
  understandRepoEmptyEvidenceMessage,
  understandRepoMissingEntryBodiesMessage
} from "../context/indexedRepoContextEnrichment";
import { hasRepoSummaryEvidence, buildRepoSummaryEvidence } from "../context/buildRepoSummaryContext";
import { coopBuildBanner, COOP_EXTENSION_BUILD_ID } from "../config/coopBuildId";
import { fetchIndexedBranch } from "../context/resolveRepoBranch";
import { resolveActiveRepoTarget } from "../workspace/repoTargetResolver";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { hasRepoFactNeed, needsRepoTreeOverview, repoFactNeeds, shouldSkipQuickActionSuggest } from "../workspace/repoFactIntent";
import { enrichIntentFetchResultsOnce } from "../context/intentIntegrationEnrichment";
import { shouldFetchConfluenceContext } from "../context/confluenceContext";
import { shouldFetchGoogleDocsContext } from "../context/googleDocsContext";
import { shouldFetchJiraContext } from "../context/jiraContext";
import { shouldFetchNotionContext } from "../context/notionContext";
import { shouldFetchSlackContext } from "../context/slackContext";
import type { ResolvedIntegrationScope, ScopedIntegrationProvider } from "../integrationScope/types";
import { readAgentModeSetting } from "../config/agentModeConfig";
import { AGENT_JOB_WALL_MS, AGENT_MAX_TOOL_ROUNDS } from "../config/agentJobBudget";
import { shouldRunAgentToolLoop, shouldSuppressSuggestChipsForAgentHunt } from "./agentRouting";
import { buildAgentToolPlanPrompt } from "../api/agent/parseAgentToolPlan";
import {
  EDIT_NO_TARGET_FILE_ERROR,
  EDIT_UNREADABLE_FILE_ERROR,
  hasEditTargetInScope,
  isConcreteFileEditAsk,
  resolveEditEditorSnapPreference,
  shouldBypassAdvisoryGroundingForEdit,
  shouldTrackEditRequest
} from "./editSendRouting";

export type CoopChatSessionOptions = {
  extensionUri: vscode.Uri;
  extensionContext: vscode.ExtensionContext;
  api: SecureApiClient;
  healthMonitor: HealthMonitor;
  degradationCache: DegradationCache;
  codeHostRouter: import("../api/codeHosts/codeHostRouter").CodeHostRouter;
  codeHostSecrets: import("../api/codeHosts/codeHostSecrets").CodeHostSecrets;
  integrationSecrets: import("../api/integrations/integrationSecrets").IntegrationSecrets;
  indexManager: import("../indexing/indexManager").IndexManager;
  indexBackend: IndexBackend;
  lightningStatusBar: LightningStatusBar;
  identityDirectoryStore: import("../identity/identityDirectoryStore").IdentityDirectoryStore;
  agentOrchestrator: import("../api/agent/AgentOrchestrator").AgentOrchestrator;
  onDescriptionChange?: (description: string) => void;
  onTitleChange?: (title: string) => void;
  enforceSidebarMinWidth?: boolean;
  /** When set, enables persisted multi-thread history for this session (sidebar). */
  threadScopeKey?: string;
  /**
   * Start with empty chips (no global last-repo restore, no editor harvest).
   * Used for chat panels moved into a new window so Window A's file/repo does not stick.
   */
  startBlank?: boolean;
};

/**
 * Time budget for Understand Repo's connected-tool search. It queries every
 * connected integration but drops any that don't return within this window so a
 * slow tool can't stall the overview.
 */
const UNDERSTAND_REPO_INTEGRATION_BUDGET_MS = 10_000;

export class CoopChatSession {
  private webview?: vscode.Webview;
  private settingsWebview?: vscode.Webview;
  private settingsMessageDisposable?: vscode.Disposable;
  private closeSettingsHandler?: () => void;
  private pendingSettingsScreen?: SettingsScreen;
  private readonly chatHistory: ChatMessage[] = [];
  private threadArtifacts: ChatPersistedArtifact[] = [];
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
  private chatTurnStartedAt = 0;
  private workspaceFacade?: IndexedRepoWorkspace;
  private readonly jobClient: JobApiClient;
  private lastJobResult?: unknown;
  /** Accumulates status lines for chat-deliverable jobs so the narrative timeline keeps moving. */
  private readonly chatDeliverableNarrative = new Map<string, string[]>();
  /** Last activityMessages posted per thread — preserved when job narrative starts. */
  private readonly lastActivityMessagesByThread = new Map<string, string[]>();
  /** Thread receiving live tool activity during enrich (including quiet /gaps gather). */
  private activityFeedbackThreadId?: string;
  private lastContextBundle: ContextFetchResult[] = [];
  private lastTraceDecisionTimeline?: DecisionTimeline;
  private pendingEvidenceArtifactId?: string;
  /**
   * Plain-chat suggest interrupt — waiting for Find Owner / Just answer chip.
   * Cleared on resolve or a new unrelated send.
   */
  private pendingQuickActionSuggest?: {
    focus: string;
    mentions?: ChatFileMention[];
    attachments?: ChatImageAttachment[];
    assistantTimestamp: number;
  };
  /** Abort in-flight hybrid intent-suggest model call (user Stop). */
  private intentSuggestAbort?: AbortController;
  /**
   * Phase A: intent plan for the in-flight send. Every turn re-plans (UX-G7).
   * Agent loop reads this — do not treat agentMode as a sticky thread.
   */
  private turnIntentPlan?: ChatIntentPlan;
  private turnStreamAbort?: AbortSignal;
  private sessionCostUsd = 0;
  private readonly threadRuns = new ThreadRunManager();
  private workspacePromptWatcher?: vscode.Disposable;
  private contextDebugChannel?: vscode.OutputChannel;
  private pendingChatLocalFiles?: LocalFileContextPayload;
  private editorContextSuppressedUntil = 0;
  /**
   * When false, ignore passive editor snaps (active tab / visibility).
   * Fresh new-window panels stay blank until Use-repo or an explicit file pick.
   */
  private allowPassiveEditorSnap = true;
  /** Keeps chat context file anchored during file-scoped quick actions and evidence review opens. */
  private pinnedContextFile?: string;
  /**
   * Repo-relative path from Coop remote explorer (or a thread restored with
   * fileSource:"remote"). Gates open + attach to codehost/VFS only — never local disk.
   */
  private remoteProvenanceFile?: string;
  private pendingChatMentions?: ChatFileMention[];
  /** Explicit dual-repo /compare turn — evidence for exactly two indexed repos. */
  private pendingDualRepoCompare?: DualRepoComparePlan;
  /** Set during /edit sends so semantic retrieval uses the edit gate. */
  private pendingCodeEditIntent = false;
  private readonly threadStore?: ChatThreadStore;

  public constructor(
    private readonly options: CoopChatSessionOptions
  ) {
    if (options.threadScopeKey) {
      this.threadStore = new ChatThreadStore(options.extensionContext, options.threadScopeKey);
    }
    this.intentConfig = readIntentConfiguration();
    this.conflictConfig = readConflictConfiguration();
    this.degradationConfig = readDegradationConfiguration();
    this.intentDebouncer = new IntentDebouncer({ rules: this.intentConfig.debounceRules });
    this.requestBatcher = this.createRequestBatcher();
    this.requestPrioritizer = this.createRequestPrioritizer();
    this.preferences = {
      model: "claude-sonnet-4-6",
      llmProvider: "anthropic",
      temperature: 0.5,
      maxTokens: 2000,
      llmEnabled: true,
      autocompleteEnabled: true,
      useCachedResponses: true,
      includeSelection: true,
      includeActiveFile: true,
      apiBaseUrl: resolveCoopBaseUrl().baseUrl,
      owner: "",
      repo: "",
      branch: "",
      hasApiKey: false,
      isSignedIn: false,
      defaultCodeHost: "github",
      gitlabBaseUrl: "https://gitlab.com/api/v4",
      hasGitHubToken: false,
      hasGitHubAppInstalled: false,
      devMode: false,
      hasGitLabToken: false,
      hasGitLabAppInstalled: false,
      hasBitbucketCredentials: false,
      hasBitbucketAppInstalled: false,
      hasSlackToken: false,
      hasSlackInstalled: false,
      hasAtlassianInstalled: false,
      hasJiraCredentials: false,
      hasTeamsInstalled: false,
      hasTeamsToken: false,
      hasConfluenceCredentials: false,
      hasNotionInstalled: false,
      hasNotionToken: false,
      hasGoogleDocsInstalled: false,
      hasGoogleDocsToken: false,
      jiraBaseUrl: "https://your-domain.atlassian.net",
      confluenceBaseUrl: "https://your-domain.atlassian.net/wiki",
      searchScopeMode: "repo",
      searchCollectionId: ""
    };
    this.jobClient = new JobApiClient({
      baseUrl: resolveCoopBaseUrl().baseUrl,
      getToken: () => this.options.api.getToken()
    });
    if (options.startBlank) {
      this.allowPassiveEditorSnap = false;
    }
    coopSessionRegistry.register(this);
  }

  public dispose(): void {
    this.threadRuns.abortAll();
    this.intentDebouncer.dispose();
    this.requestBatcher.cancelAll("Session disposed.");
    this.requestPrioritizer.clear("Session disposed.");
    coopSessionRegistry.unregister(this);
  }

  public attachWebview(webview: vscode.Webview): void {
    this.webview = webview;
    this.reloadChatWebviewHtml();
    this.wireWebview(webview, "chat");
    coopSessionRegistry.setActive(this);
  }

  public reloadChatWebviewHtml(): void {
    if (!this.webview) {
      return;
    }
    this.webview.html = renderWebviewHtml(this.webview, this.options.extensionUri, {
      view: "chat",
      enforceMinWidth: this.options.enforceSidebarMinWidth
    });
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
    this.threadStore?.recordActivity();
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
    // Drop legacy cross-window global chip seed (owner/repo leaked across VS Code windows).
    void this.options.extensionContext.globalState.update("coopAI.lastRepoContext", undefined);
    const startBlank = this.options.startBlank === true;
    if (!startBlank) {
      // Same-window sidebar reload only — never seed from User/global defaults into a new window.
      this.applyDefaultRepoToContext();
    }
    this.postTheme();
    await this.pushSettingsState();
    if (this.threadStore && !startBlank) {
      const active = this.threadStore.resolveStartupThread(readChatSessionIdleMs());
      this.chatHistory.push(...active.messages);
      this.threadArtifacts = [...(active.artifacts ?? [])];
      this.sessionCostUsd = active.sessionCostUsd;
      this.setThreadTitle(active.title);
      if (active.repoContext) {
        // Cold start / extension reload: restore owner/repo only.
        // Do NOT chip or open last session's file — that runs when the user
        // explicitly switches to (opens) that thread in the UI.
        this.currentContext = stripStaleContextWarning(
          normalizeRepoContext(
            mergeRepoContext(this.currentContext, {
              provider: active.repoContext.provider,
              owner: active.repoContext.owner,
              repo: active.repoContext.repo,
              branch: active.repoContext.branch,
              scope: active.repoContext.scope === "repo" ? "repo" : undefined
            })
          )
        );
      }
    }
    this.dropFileChipUnlessOpenInEditor();
    // New windows stay blank until Use-repo / file pick / editor focus in this window.
    if (!startBlank) {
      this.snapContextFromOpenEditors();
    }
    this.postContext();
    this.postChatHistory();
    this.pushThreadsList();
    this.syncAllLocalThreadsToBackend();
  }

  /**
   * After moving a chat panel into a new window: wipe chips inherited from the
   * creating window and wait for an explicit repo/file selection here.
   * Keeps context if Use-repo / openChatForRepo already assigned one before move finished.
   */
  public beginFreshWindowContext(): void {
    if (isExplicitRepoScope(this.currentContext) || this.currentContext.file?.trim()) {
      this.enablePassiveEditorSnap();
      this.postContext();
      return;
    }
    this.pinnedContextFile = undefined;
    this.remoteProvenanceFile = undefined;
    this.allowPassiveEditorSnap = false;
    this.intentDebouncer.cancelAll();
    this.currentContext = {};
    this.postContext();
  }

  private enablePassiveEditorSnap(): void {
    this.allowPassiveEditorSnap = true;
  }

  private threadSyncOptions() {
    return {
      baseUrl: resolveCoopBaseUrl().baseUrl,
      getToken: () => this.options.api.getToken(),
      getOwnerEmail: () => resolveGitUserEmail()
    };
  }

  private syncAllLocalThreadsToBackend(): void {
    if (!this.threadStore) {
      return;
    }
    void syncAllThreadsToBackend(this.threadStore.listAllThreads(), this.threadSyncOptions());
  }

  private syncActiveThreadToBackend(): void {
    if (!this.threadStore) {
      return;
    }
    const thread = this.threadStore.getActiveThread();
    void syncThreadToBackend(thread, this.threadSyncOptions());
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
    if (this.preferences.plan === "free" && !isFreeQuotaExhausted(this.preferences.quotaCredits)) {
      this.post({ type: "chat:quota-cleared" });
    }
    await this.pushSettingsState();
  }

  public refreshEditorContext(editor: vscode.TextEditor | undefined): void {
    if (!this.allowPassiveEditorSnap) {
      return;
    }
    if (Date.now() < this.editorContextSuppressedUntil) {
      return;
    }
    // Coop sidebar / settings webview steals focus → activeTextEditor is often undefined
    // while Downloads / Cmd+O tabs remain visible. Never chip from an empty editor alone.
    const effective = this.resolveEditorForContextRefresh(editor);
    if (!effective) {
      // File closed / Welcome only — drop the chip when the preferred path is gone.
      // Explorer mid-open is protected by editorContextSuppressedUntil above.
      const before = this.currentContext.file;
      this.dropFileChipUnlessOpenInEditor();
      if (before !== this.currentContext.file) {
        this.postContext();
      }
      return;
    }
    const intent = this.intentDetector.detectEditorIntent(effective);
    const snapPrefs = {
      ...this.preferences,
      includeActiveFile: true
    };
    const nextContext = repoContextFromEditor(effective, snapPrefs, this.currentContext);
    const event = this.intentDetector.create(intent, {
      file: nextContext.file,
      fileSource: nextContext.fileSource,
      contextWarning: nextContext.contextWarning,
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

  /** Tab close / visible-editors change — clear chip if the chipped file is gone. */
  public reconcileEditorFileChips(): void {
    if (!this.allowPassiveEditorSnap && !this.currentContext.file?.trim()) {
      return;
    }
    if (Date.now() < this.editorContextSuppressedUntil) {
      return;
    }
    const before = this.currentContext.file;
    this.dropFileChipUnlessOpenInEditor();
    if (before !== this.currentContext.file) {
      this.postContext();
      return;
    }
    this.refreshEditorContext(vscode.window.activeTextEditor);
  }

  /**
   * Prefer the passed editor, else a tab matching the current context file.
   * When context is blank, only the focused active editor may chip — never harvest
   * another window's visible tabs (same extension host / auxiliary windows).
   */
  private resolveEditorForContextRefresh(
    editor: vscode.TextEditor | undefined
  ): vscode.TextEditor | undefined {
    const preferred = this.currentContext.file;
    if (editor && !editor.document.isClosed) {
      const resolved = resolveEditorFile(editor);
      if (resolved.file?.trim()) {
        // Remote session: ignore focus on a local clone of the chipped path.
        if (
          this.isWorkingOnRemoteProvenance() &&
          preferred?.trim() &&
          resolved.fileSource !== "remote" &&
          resolved.fileSource !== "external" &&
          isSameRepoFilePath(resolved.file, preferred)
        ) {
          return pickRemoteEditorForContext(preferred);
        }
        return editor;
      }
    }
    if (this.isWorkingOnRemoteProvenance()) {
      return pickRemoteEditorForContext(preferred);
    }
    if (preferred?.trim()) {
      // Explorer pick set a file chip but the tab isn't open yet — don't steal it with
      // an unrelated visible editor (that was the false "opened" CoopSettingsPanel bug).
      return pickLocalEditorForContext(preferred) ?? pickEditorForContext(preferred);
    }
    // Blank context: focused editor only (no visibleTextEditors scan across windows).
    const active = vscode.window.activeTextEditor;
    if (active && !active.document.isClosed) {
      const resolved = resolveEditorFile(active);
      if (resolved.file?.trim()) {
        return active;
      }
    }
    return undefined;
  }

  /** Immediate chip sync (no debounce) — used on initialize / webview-ready. */
  private snapContextFromOpenEditors(): boolean {
    if (!this.allowPassiveEditorSnap) {
      return false;
    }
    const editor = this.resolveEditorForContextRefresh(vscode.window.activeTextEditor);
    if (!editor) {
      return false;
    }
    const snapPrefs = { ...this.preferences, includeActiveFile: true, includeSelection: true };
    this.currentContext = mergeRepoContext(
      this.currentContext,
      repoContextFromEditor(editor, snapPrefs, this.currentContext)
    );
    this.currentContext = this.withRemoteProvenance(this.currentContext);
    return Boolean(this.currentContext.file?.trim());
  }

  /**
   * Clear a file chip that isn't backed by an open editor tab.
   * Used on cold start when there is no thread file to restore — Welcome-only must not
   * ghost yesterday's file. Thread open uses applyThreadRepoContext (chip + open) instead.
   */
  private dropFileChipUnlessOpenInEditor(): void {
    const preferred = this.currentContext.file?.trim();
    if (!preferred) {
      if (this.currentContext.fileSource || this.currentContext.selectedLines) {
        this.clearFileFieldsFromContext();
      }
      return;
    }
    const open = this.isWorkingOnRemoteProvenance()
      ? pickRemoteEditorForContext(preferred)
      : pickLocalEditorForContext(preferred) ?? pickEditorForContext(preferred);
    if (open) {
      return;
    }
    // Remote chip may still be valid with API-backed content and no VFS tab yet.
    if (this.isWorkingOnRemoteProvenance()) {
      return;
    }
    this.clearFileFieldsFromContext();
  }

  public handleThemeChange(): void {
    this.postTheme();
  }

  public newChat(): void {
    if (this.threadStore) {
      this.persistActiveThread();
      this.remoteProvenanceFile = undefined;
      // Fresh thread: keep owner/repo only — never inherit the prior file chip.
      const thread = this.threadStore.startNewThread({
        provider: this.currentContext.provider,
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        branch: this.currentContext.branch
      });
      this.activateThread(thread);
      return;
    }
    this.remoteProvenanceFile = undefined;
    this.resetChatState();
    this.clearFileFieldsFromContext();
    this.post({ type: "chat:history", payload: { messages: [], artifacts: [] } });
    this.postContext();
  }

  private activeThreadId(): string {
    return this.threadStore?.getActiveThreadId() ?? SESSION_RUN_THREAD_ID;
  }

  private isViewingThread(threadId: string): boolean {
    return this.activeThreadId() === threadId;
  }

  /** Post to the webview only when the user is viewing that thread. */
  private postForThread(threadId: string, message: WebviewOutbound): void {
    if (!this.isViewingThread(threadId)) {
      return;
    }
    this.post(message);
  }

  private abortActiveJob(threadId?: string): void {
    const id = threadId ?? this.activeThreadId();
    const turn = this.threadRuns.get(id);
    const jobId = turn?.jobId;
    if (jobId) {
      void this.jobClient.cancelJob(jobId).catch(() => undefined);
      if (turn) {
        turn.jobId = undefined;
      }
    }
  }

  /**
   * User Stop: abort the turn, clear thinking/job activity, and land a Cursor-style
   * "Stopped." message (or keep any partial assistant text).
   */
  private handleStreamCancel(threadId: string): void {
    this.intentSuggestAbort?.abort();
    this.intentSuggestAbort = undefined;

    const turn = this.threadRuns.get(threadId);
    const partialText = turn?.partialAssistant?.trim() ?? "";
    const jobId = turn?.jobId;
    const quickAction = turn?.quickAction;
    const history = turn ? [...turn.history] : undefined;
    const artifacts = turn ? [...turn.artifacts] : undefined;
    const sessionCostUsd = turn?.sessionCostUsd;
    const turnContext = turn?.context;

    this.abortActiveJob(threadId);
    this.threadRuns.abort(threadId);
    this.clearIntentFeedback(threadId);

    if (jobId) {
      this.postJobProgress(
        {
          jobId,
          status: "cancelled",
          title: quickAction ? jobTitleForAction(quickAction) : "Stopped",
          deliverable: quickAction ? deliverableForQuickAction(quickAction) : "chat",
          showViewResults: false,
          message: CHAT_STOPPED_MESSAGE,
          progress: 0
        },
        threadId
      );
    }

    const stoppedMessage: ChatMessage = {
      role: "assistant",
      content: partialText || CHAT_STOPPED_MESSAGE,
      timestamp: Date.now(),
      links: []
    };

    if (history) {
      history.push(stoppedMessage);
      if (this.isViewingThread(threadId)) {
        this.chatHistory.length = 0;
        this.chatHistory.push(...history);
        if (artifacts) {
          this.threadArtifacts = artifacts;
        }
        if (sessionCostUsd !== undefined) {
          this.sessionCostUsd = sessionCostUsd;
        }
        this.postForThread(threadId, {
          type: "chat:cancelled",
          payload: {
            message: stoppedMessage,
            threadId,
            hadPartial: Boolean(partialText)
          }
        });
        this.postChatHistory();
        this.persistActiveThread();
      } else if (this.threadStore && sessionCostUsd !== undefined) {
        const stored = this.threadStore.getThreadById(threadId);
        this.threadStore.setThread(
          threadId,
          history,
          sessionCostUsd,
          stored?.title ?? "New Chat",
          artifacts ?? stored?.artifacts ?? [],
          turnContext ?? stored?.repoContext
        );
        const thread = this.threadStore.getThreadById(threadId);
        if (thread) {
          void syncThreadToBackend(thread, this.threadSyncOptions());
        }
      }
    } else if (this.isViewingThread(threadId)) {
      // Idempotent Stop with no active turn — clear activity only.
      this.postForThread(threadId, {
        type: "chat:cancelled",
        payload: { threadId }
      });
    }

    this.pushThreadsList();
  }

  private resetChatState(): void {
    this.threadRuns.abortAll();
    this.chatHistory.length = 0;
    this.threadArtifacts = [];
    this.sessionCostUsd = 0;
    this.pinnedContextFile = undefined;
    this.setThreadTitle("New Chat");
  }

  private setThreadTitle(title: string): void {
    this.options.onTitleChange?.(title);
    this.threadStore?.updateActiveTitle(title);
    this.pushThreadsList();
    this.syncActiveThreadToBackend();
  }

  private persistActiveThread(): void {
    if (!this.threadStore) {
      return;
    }
    const active = this.threadStore.getActiveThread();
    this.threadStore.setActiveThread(
      this.chatHistory,
      this.sessionCostUsd,
      active.title,
      this.threadArtifacts,
      this.currentContext
    );
    void this.syncActiveThreadToBackend();
  }

  private persistTurnThread(turn: ChatTurn): void {
    if (!this.threadStore) {
      return;
    }
    const stored = this.threadStore.getThreadById(turn.threadId);
    const title = stored?.title ?? "New Chat";
    this.threadStore.setThread(
      turn.threadId,
      turn.history,
      turn.sessionCostUsd,
      title,
      turn.artifacts,
      turn.context
    );
    const thread = this.threadStore.getThreadById(turn.threadId);
    if (thread) {
      void syncThreadToBackend(thread, this.threadSyncOptions());
    }
  }

  private finishTurnAssistantMessage(turn: ChatTurn, finalMessage: ChatMessage): void {
    turn.history.push(finalMessage);
    if (this.isViewingThread(turn.threadId)) {
      this.chatHistory.push(finalMessage);
      this.post({ type: "chat:complete", payload: { message: finalMessage, threadId: turn.threadId } });
      this.postChatHistory();
      this.sessionCostUsd = turn.sessionCostUsd;
      this.persistActiveThread();
    } else {
      this.persistTurnThread(turn);
    }
    this.threadRuns.complete(turn);
    this.pushThreadsList();
  }

  private pushThreadsList(): void {
    if (!this.threadStore) {
      return;
    }
    const active = this.threadStore.getActiveThread();
    const running = new Set(this.threadRuns.runningThreadIds());
    this.post({
      type: "threads:list",
      payload: {
        activeId: active.id,
        activeTitle: active.title,
        threads: this.threadStore.listSummaries().map((thread) => ({
          ...thread,
          isRunning: running.has(thread.id)
        }))
      }
    });
  }

  private activateThread(thread: ReturnType<ChatThreadStore["getActiveThread"]>): void {
    // Do not abort background turns — other threads keep generating.
    this.pinnedContextFile = undefined;
    this.chatHistory.length = 0;
    this.threadArtifacts = [];
    this.chatHistory.push(...thread.messages);
    this.threadArtifacts = [...(thread.artifacts ?? [])];
    this.sessionCostUsd = thread.sessionCostUsd;
    this.setThreadTitle(thread.title);
    this.post({
      type: "chat:thread-changed",
      payload: { threadId: thread.id, title: thread.title }
    });
    this.postChatHistory();
    const running = this.threadRuns.get(thread.id);
    if (running && running.status === "running") {
      this.chatHistory.length = 0;
      this.chatHistory.push(...running.history);
      this.threadArtifacts = [...running.artifacts];
      this.sessionCostUsd = running.sessionCostUsd;
      this.postChatHistory();
      this.post({
        type: "chat:stream-resume",
        payload: { threadId: thread.id, partialText: running.partialAssistant }
      });
      if (running.partialAssistant.length === 0) {
        // Still in intent/job phase — restore loading strip for this thread.
        this.postIntentFeedbackForThread(thread.id, {
          status: "loading",
          intent: UserIntent.MANUAL_CHAT_SUBMIT,
          title: "Working",
          message: "Still generating in this thread…"
        });
      }
    }
    this.pushThreadsList();
    // Thread-scoped file: chip + open in editor. Not a global "last session" ghost.
    void this.restoreContextForActivatedThread(thread);
  }

  private async restoreContextForActivatedThread(
    thread: ReturnType<ChatThreadStore["getActiveThread"]>
  ): Promise<void> {
    if (thread.repoContext?.file?.trim()) {
      await this.applyThreadRepoContext(thread.repoContext);
    } else {
      this.remoteProvenanceFile = undefined;
      this.clearFileFieldsFromContext();
      if (thread.repoContext) {
        this.currentContext = stripStaleContextWarning(
          normalizeRepoContext(
            mergeRepoContext(this.currentContext, {
              provider: thread.repoContext.provider,
              owner: thread.repoContext.owner,
              repo: thread.repoContext.repo,
              branch: thread.repoContext.branch,
              scope: thread.repoContext.scope === "repo" ? "repo" : undefined
            })
          )
        );
      }
      // Do not snap the open editor onto a new/empty thread — that recreated the
      // leftover L chip after New Chat while CoopSettingsPanel.ts stayed open.
    }
    this.postContext();
  }

  /**
   * Apply a chat thread's saved repo/file context: chip it and open the file in the editor.
   * Global cold-start persistence must NOT use this for arbitrary last-session files —
   * only when the user is opening a specific thread.
   */
  private async applyThreadRepoContext(repoContext: RepoContext): Promise<void> {
    this.currentContext = stripStaleContextWarning(
      normalizeRepoContext(mergeRepoContext(this.currentContext, repoContext))
    );
    const file = this.currentContext.file?.trim();
    if (!file) {
      this.remoteProvenanceFile = undefined;
      return;
    }

    if (repoContext.fileSource === "remote" || this.currentContext.fileSource === "remote") {
      this.setRemoteProvenance(file);
    } else {
      this.remoteProvenanceFile = undefined;
    }

    const alreadyOpen =
      this.currentContext.fileSource === "remote"
        ? pickRemoteEditorForContext(file)
        : pickLocalEditorForContext(file) ?? pickEditorForContext(file);
    if (alreadyOpen) {
      try {
        await vscode.window.showTextDocument(alreadyOpen.document, {
          viewColumn: alreadyOpen.viewColumn ?? vscode.ViewColumn.One,
          preview: false,
          preserveFocus: false
        });
      } catch {
        // Chip still valid — tab exists.
      }
      this.currentContext = this.withRemoteProvenance(this.currentContext);
      return;
    }

    const opened = await this.openContextFileInEditor(file);
    if (!opened) {
      this.remoteProvenanceFile = undefined;
      this.clearFileFieldsFromContext();
    } else {
      this.currentContext = this.withRemoteProvenance(this.currentContext);
    }
  }

  /** Open a repo-relative or absolute path for thread restore / picker. */
  private async openContextFileInEditor(path: string): Promise<boolean> {
    this.editorContextSuppressedUntil = Date.now() + 8_000;
    this.intentDebouncer.cancelAll();

    const remoteOnly = isRemoteProvenanceContext(this.currentContext, this.remoteProvenanceFile);
    if (!remoteOnly) {
      const absolute = resolveLocalAbsolutePath(path);
      if (absolute) {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
            preserveFocus: false
          });
          return true;
        } catch {
          // fall through to remote
        }
      }
    }

    if (!this.currentContext.owner?.trim() || !this.currentContext.repo?.trim()) {
      return false;
    }

    let opened = await openRemoteFileInEditor({
      owner: this.currentContext.owner,
      repo: this.currentContext.repo,
      filePath: path,
      provider: this.currentContext.provider ?? this.preferences.defaultCodeHost,
      branch: this.currentContext.branch,
      preserveSidebarFocus: false,
      allowLocalClone: !remoteOnly
    });
    if (!opened) {
      opened = await this.openRemoteFileFromApi(path, undefined, { preserveFocus: false });
    }
    return opened;
  }

  private clearFileFieldsFromContext(): void {
    this.currentContext = normalizeRepoContext({
      ...this.currentContext,
      file: undefined,
      fileSource: undefined,
      selectedLines: undefined,
      selectedSymbol: undefined,
      languageId: undefined,
      scope: this.currentContext.scope === "repo" ? "repo" : undefined
    });
  }

  private setRemoteProvenance(path: string): void {
    const trimmed = path.trim().replace(/\\/g, "/");
    if (!trimmed || isOsAbsoluteDiskPath(trimmed)) {
      this.remoteProvenanceFile = undefined;
      return;
    }
    this.remoteProvenanceFile = trimmed.replace(/^\/+/, "");
  }

  /**
   * Re-assert remote chip + pin for a remote-picked path.
   * Does not authorize local-disk attach — remote content must come from VFS/API.
   */
  private withRemoteProvenance(ctx: RepoContext): RepoContext {
    // Re-pin from an existing remote stamp so attach/send paths that skipped
    // setRemoteProvenance still survive local-clone editor snaps.
    if (
      !this.remoteProvenanceFile?.trim() &&
      ctx.fileSource === "remote" &&
      ctx.file?.trim() &&
      !isOsAbsoluteDiskPath(ctx.file)
    ) {
      this.setRemoteProvenance(ctx.file);
    }

    const pin = this.remoteProvenanceFile?.trim();
    if (!pin) {
      return ctx;
    }
    if (!ctx.file?.trim()) {
      // Transient empty editor events must not drop the remote pin.
      return ctx;
    }
    if (isOsAbsoluteDiskPath(ctx.file)) {
      // Same path reported as a local fsPath (leftover tab) — keep remote intent on the pin.
      // Attach still refuses local disk when isWorkingOnRemoteProvenance().
      const pinAbs = resolveLocalAbsolutePath(pin);
      if (pinAbs && pathsReferToSameFile(pinAbs, ctx.file)) {
        return {
          ...ctx,
          file: pin,
          fileSource: "remote",
          scope: "file"
        };
      }
      this.remoteProvenanceFile = undefined;
      return ctx;
    }
    if (!isSameRepoFilePath(ctx.file, pin)) {
      this.remoteProvenanceFile = undefined;
      return ctx;
    }
    return {
      ...ctx,
      file: pin,
      fileSource: "remote",
      scope: "file"
    };
  }

  /** Existing chip source for local-buffer attach — pin counts as remote even if stamp was demoted. */
  private chipSourceBeforeLocalAttach(): RepoContext["fileSource"] {
    if (this.isWorkingOnRemoteProvenance()) {
      return "remote";
    }
    return this.currentContext.fileSource;
  }

  /** User chose remote explorer / codehost — never fall through to local disk. */
  private isWorkingOnRemoteProvenance(): boolean {
    return isRemoteProvenanceContext(this.currentContext, this.remoteProvenanceFile);
  }

  private async switchThread(threadId: string): Promise<void> {
    if (!this.threadStore) {
      return;
    }
    this.persistActiveThread();
    const thread = this.threadStore.switchTo(threadId);
    if (!thread) {
      return;
    }
    this.activateThread(thread);
  }

  public setRepoContext(context: Pick<RepoContext, "provider" | "owner" | "repo" | "branch">): void {
    this.pinnedContextFile = undefined;
    this.remoteProvenanceFile = undefined;
    this.enablePassiveEditorSnap();
    // Sidebar clicks steal editor focus — suppress prefs-seeded snaps that would
    // resurrect the previously selected repository.
    this.editorContextSuppressedUntil = Date.now() + 8_000;
    this.intentDebouncer.cancelAll();
    this.currentContext = mergeRepoContext(
      this.currentContext,
      repoContextForRepoSelect(context) as RepoContext
    );
    this.syncPreferencesFromRepoSelection(context);
    this.postContext();
  }

  /** Keep Settings owner/repo aligned with explorer Use repo so editor identity can't revert. */
  private syncPreferencesFromRepoSelection(
    context: Pick<RepoContext, "provider" | "owner" | "repo" | "branch">
  ): void {
    const owner = (context.owner ?? "").trim();
    const repo = (context.repo ?? "").trim();
    if (!owner || !repo) {
      return;
    }
    const branch = (context.branch ?? "").trim();
    const sameRepo =
      owner === (this.preferences.owner ?? "").trim() &&
      repo === (this.preferences.repo ?? "").trim();
    // Switching repos without a resolved branch must not keep the prior repo's branch.
    const nextBranch: string = branch || (sameRepo ? this.preferences.branch : "");
    if (
      owner === this.preferences.owner &&
      repo === this.preferences.repo &&
      nextBranch === this.preferences.branch
    ) {
      return;
    }
    this.preferences = {
      ...this.preferences,
      owner,
      repo,
      branch: nextBranch
    };
    void updateConfiguration({
      owner,
      repo,
      branch: nextBranch
    });
  }

  public clearChat(): void {
    if (this.threadStore) {
      this.threadRuns.abort(this.threadStore.getActiveThreadId());
      this.persistActiveThread();
      const thread = this.threadStore.clearActiveThread();
      this.activateThread(thread);
      return;
    }
    this.newChat();
  }

  public openSettings(screen?: SettingsScreen): void {
    if (screen) {
      this.pendingSettingsScreen = screen;
    }
    // Lazy import avoids circular dependency with CoopSettingsPanel.
    void import("../CoopSettingsPanel").then(({ CoopSettingsPanel }) => {
      CoopSettingsPanel.createOrReveal(this.options.extensionUri, this);
    });
  }

  public navigateSettings(screen: SettingsScreen): void {
    this.pendingSettingsScreen = screen;
    this.flushPendingSettingsNavigation();
  }

  public flushPendingSettingsNavigation(): void {
    if (!this.pendingSettingsScreen || !this.settingsWebview) {
      return;
    }
    this.postToSettings({
      type: "settings:navigate",
      payload: { screen: this.pendingSettingsScreen }
    });
    this.pendingSettingsScreen = undefined;
  }

  public getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  public async sendEditFollowUp(message: string): Promise<void> {
    await this.handleChatSend(message, undefined, undefined, { composerMode: "edit" });
  }

  public async sendUserMessage(
    message: string,
    quickAction?: string,
    options?: { mentions?: ChatFileMention[]; attachments?: ChatImageAttachment[] }
  ): Promise<void> {
    await this.runResolvedPromptText(message, quickAction, options);
  }

  private async runResolvedPromptText(
    template: string,
    actionId?: string,
    options?: {
      mentions?: ChatFileMention[];
      attachments?: ChatImageAttachment[];
    }
  ): Promise<void> {
    const plan = resolvePromptLibraryRun(template, actionId);
    const mentions = options?.mentions;
    const attachments = options?.attachments;

    switch (plan.kind) {
      case "slash":
        await this.routeSlashCommand(plan.parsed, attachments, mentions);
        return;
      case "quick-action":
        await this.handleChatSend("", plan.actionId, attachments, {
          mentions,
          slashUserArgs: plan.slashUserArgs
        });
        return;
      case "chat":
        await this.handleChatSend(plan.message, undefined, attachments, { mentions });
        return;
    }
  }

  private resolvePromptLibraryText(entry: WorkspacePromptEntry, composerText?: string): string {
    return mergeComposerWithPromptTemplate(
      composerText,
      applyPromptTemplate(entry.template, promptVariablesFromContext(this.currentContext))
    );
  }

  public insertPromptLibraryEntry(
    entry: WorkspacePromptEntry,
    options?: { composerText?: string }
  ): void {
    this.postToChat({
      type: "prompts:insert",
      payload: {
        text: this.resolvePromptLibraryText(entry, options?.composerText),
        actionId: entry.actionId
      }
    });
  }

  private async runPromptLibraryEntry(
    entry: WorkspacePromptEntry,
    options?: {
      mentions?: ChatFileMention[];
      attachments?: ChatImageAttachment[];
      composerText?: string;
    }
  ): Promise<void> {
    const text = this.resolvePromptLibraryText(entry, options?.composerText);
    await this.runResolvedPromptText(text, entry.actionId, {
      mentions: options?.mentions,
      attachments: options?.attachments
    });
  }

  public async submitQuickAction(actionId: QuickActionId, context?: RepoContext): Promise<void> {
    if (context) {
      // Merge so an explicit file (including outside-workspace) is never dropped.
      this.currentContext = mergeRepoContext(this.currentContext, context);
      this.postContext();
    }
    await this.handleChatSend("", actionId);
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
        const message = formatUserFacingNetworkError(error, "Unexpected extension error.");
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
          // Snap open tabs only when passive editor following is armed.
          // Fresh new-window panels stay blank until Use-repo / file pick.
          if (this.allowPassiveEditorSnap) {
            this.snapContextFromOpenEditors();
          }
          this.postContext();
          try {
            await this.pushSettingsState();
          } catch (error) {
            console.error("[CoopAI] pushSettingsState failed on webview-ready", error);
          }
          void this.pushLightningState();
          this.postChatHistory();
          this.pushThreadsList();
          this.pushPatchState();
          void this.pushWorkspacePrompts();
          this.workspacePromptWatcher?.dispose();
          this.workspacePromptWatcher = watchWorkspacePrompts(() => void this.pushWorkspacePrompts());
        } else {
          try {
            await this.pushSettingsState();
          } catch (error) {
            console.error("[CoopAI] pushSettingsState failed on settings webview-ready", error);
          }
          void this.pushWorkspacePrompts();
          void this.handleCollectionsListRequest();
          this.flushPendingSettingsNavigation();
          void this.pushLightningState();
        }
        return;
      case "ui:close-settings":
        this.closeSettingsHandler?.();
        return;
      case "ui:open-settings": {
        const screen = message.payload?.screen;
        this.openSettings(screen && isSettingsScreen(migrateSettingsScreen(screen)) ? migrateSettingsScreen(screen) : undefined);
        return;
      }
      case "ui:ensure-min-width":
        if (this.options.enforceSidebarMinWidth) {
          await ensureSidebarMinWidth(message.payload.width, message.payload.minWidth);
        }
        return;
      case "context:dismiss-warning":
        this.currentContext = { ...this.currentContext, contextWarning: undefined };
        this.postContext();
        return;
      case "agents:create-skeleton":
      case "agents:start-from-template":
        await this.startFromAgentsMdTemplate();
        return;
      case "agents:attach":
        await this.attachAgentsMd();
        return;
      case "agents:open":
        await this.openAgentsMd();
        return;
      case "chat:send":
        await this.handleChatSend(
          message.payload.message,
          message.payload.quickAction,
          message.payload.attachments,
          {
            historyContent: message.payload.historyContent,
            mentions: message.payload.mentions,
            slashUserArgs: message.payload.slashUserArgs,
            targetFile: message.payload.targetFile
          }
        );
        return;
      case "chat:suggest-resolve":
        await this.handleSuggestResolve(message.payload);
        return;
      case "mention:search":
        await this.handleMentionSearch(message.payload.pattern);
        return;
      case "collections:list-request":
        await this.handleCollectionsListRequest();
        return;
      case "chat:stream-cancel": {
        this.handleStreamCancel(this.activeThreadId());
        return;
      }
      case "prompts:list-request":
        await this.pushWorkspacePrompts();
        return;
      case "prompts:run": {
        const prompts = await loadWorkspacePrompts();
        const entry = prompts.find((item) => item.id === message.payload.id);
        if (!entry) {
          return;
        }
        this.insertPromptLibraryEntry(entry, {
          composerText: message.payload.composerText
        });
        if (source === "settings") {
          void vscode.commands.executeCommand("workbench.view.extension.coopAI");
        }
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
      case "prompts:commit": {
        const entries = message.payload.prompts.map((entry) => ({
          id: entry.id,
          title: entry.title,
          template: entry.template,
          actionId: entry.actionId
        }));
        await replaceWorkspacePrompts(entries);
        const validIds = new Set(entries.map((entry) => entry.id));
        await updatePinnedPromptIds(
          this.options.extensionContext,
          message.payload.pinnedIds,
          validIds
        );
        await this.broadcastPromptLibrary();
        void vscode.window.showInformationMessage("Prompt library saved.");
        return;
      }
      case "chat:new":
      case "threads:new":
        this.newChat();
        return;
      case "chat:clear":
        this.clearChat();
        return;
      case "threads:switch":
        void this.switchThread(message.payload.threadId);
        return;
      case "repo:list":
        if (message.payload.scope === "repos") {
          await this.handleRepoListRepos(source);
        } else if (message.payload.ephemeral) {
          await this.handleEphemeralRepoList(message.payload.path || "", message.payload, source);
        } else {
          await this.handleRepoList(message.payload.path || "", source);
        }
        return;
      case "repo:search":
        if (message.payload.ephemeral) {
          await this.handleEphemeralRepoSearch(message.payload, source);
        } else {
          await this.handleRepoSearch(message.payload.query, source);
        }
        return;
      case "repo:select":
        await this.handleRepoSelect(message.payload);
        return;
      case "github:repos:list":
        await this.handleGithubReposList(message.payload?.query, message.payload?.requestId);
        return;
      case "workspace:repos:load":
        await this.handleWorkspaceReposLoad();
        return;
      case "workspace:repos:save":
        await this.handleWorkspaceReposSave(message.payload.repoIds);
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
        void this.handleRemoteFileIntent(message.payload);
        return;
      case "link:open":
        void openReferencedLink(message.payload.url);
        return;
      case "settings:update": {
        const { autocompleteEnabled, ...rest } = message.payload;
        if (autocompleteEnabled !== undefined) {
          await vscode.commands.executeCommand("coopAI.setAutocompleteEnabled", autocompleteEnabled);
        }
        await updateConfiguration(rest);
        if (message.payload.jiraBaseUrl !== undefined) {
          await this.options.integrationSecrets.updateJiraBaseUrl(message.payload.jiraBaseUrl);
        }
        if (message.payload.confluenceBaseUrl !== undefined) {
          await this.options.integrationSecrets.updateConfluenceBaseUrl(message.payload.confluenceBaseUrl);
        }
        await this.refreshAllSessionsPreferences();
        return;
      }
      case "settings:update-api-key":
        await this.options.api.setToken(message.payload.apiKey);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-api-key":
        await this.options.api.clearToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:copy-api-key": {
        const token = await this.options.api.getToken();
        if (!token) {
          void vscode.window.showWarningMessage("No API key saved.");
          return;
        }
        await vscode.env.clipboard.writeText(token);
        void vscode.window.showInformationMessage("API key copied to clipboard.");
        return;
      }
      case "settings:reveal-api-key": {
        const token = await this.options.api.getToken();
        if (token) {
          this.postToSettings({ type: "settings:api-key-revealed", payload: { apiKey: token } });
        }
        return;
      }
      case "settings:sign-in-password":
        await this.handleSignInPassword(message.payload.email, message.payload.password);
        return;
      case "settings:sign-in-google":
        await this.handleSignInGoogle();
        return;
      case "settings:forgot-password":
        await this.handleForgotPassword(message.payload.email);
        return;
      case "settings:sign-in-sso":
        await this.handleSignInSso(message.payload?.org);
        return;
      case "settings:sign-out":
        await this.options.api.logout(this.preferences.apiBaseUrl);
        await this.options.identityDirectoryStore.clear();
        clearPresenceCaches();
        await this.refreshAllSessionsPreferences();
        void vscode.window.showInformationMessage("Signed out of Coop.");
        return;
      case "settings:test-connection":
        await this.handleTestConnection(source);
        return;
      case "settings:complete-onboarding":
        await this.handleCompleteOnboarding();
        return;
      case "settings:install-github-app":
        await this.handleInstallGithubApp();
        return;
      case "settings:refresh-github-installation":
        await this.handleRefreshInstallation("github", source);
        return;
      case "settings:install-gitlab-app":
        await this.handleInstallGitlabApp();
        return;
      case "settings:refresh-gitlab-installation":
        await this.handleRefreshInstallation("gitlab", source);
        return;
      case "settings:install-bitbucket-app":
        await this.handleInstallBitbucketApp();
        return;
      case "settings:refresh-bitbucket-installation":
        await this.handleRefreshInstallation("bitbucket", source);
        return;
      case "settings:install-slack-app":
        await this.handleInstallSlackApp();
        return;
      case "settings:refresh-slack-installation":
        await this.handleRefreshInstallation("slack", source);
        return;
      case "settings:install-atlassian-app":
        await this.handleInstallAtlassianApp();
        return;
      case "settings:refresh-atlassian-installation":
        await this.handleRefreshInstallation(message.payload?.key ?? "jira", source);
        return;
      case "settings:install-notion-app":
        await this.handleInstallNotionApp();
        return;
      case "settings:refresh-notion-installation":
        await this.handleRefreshInstallation("notion", source);
        return;
      case "settings:install-google-docs-app":
        await this.handleInstallGoogleDocsApp();
        return;
      case "settings:refresh-google-docs-installation":
        await this.handleRefreshInstallation("google-docs", source);
        return;
      case "settings:install-teams-app":
        await this.handleInstallTeamsApp();
        return;
      case "settings:refresh-teams-installation":
        await this.handleRefreshInstallation("teams", source);
        return;
      case "settings:update-github-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.codeHostSecrets.setGitHubToken(message.payload.token);
        await this.syncGithubCredentialToCloud(message.payload.token);
        this.options.codeHostRouter.clearClientCache("github");
        await this.options.degradationCache.clear();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-github-token":
        await this.options.codeHostSecrets.clearGitHubToken();
        this.options.codeHostRouter.clearClientCache("github");
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-gitlab-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.codeHostSecrets.setGitLabToken(message.payload.token);
        this.options.codeHostRouter.clearClientCache("gitlab");
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-gitlab-token":
        await this.options.codeHostSecrets.clearGitLabToken();
        this.options.codeHostRouter.clearClientCache("gitlab");
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-bitbucket-credentials":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.codeHostSecrets.setBitbucketCredentials(
          message.payload.username,
          message.payload.appPassword
        );
        this.options.codeHostRouter.clearClientCache("bitbucket");
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-bitbucket-credentials":
        await this.options.codeHostSecrets.clearBitbucketCredentials();
        this.options.codeHostRouter.clearClientCache("bitbucket");
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:test-code-host":
        await this.handleTestCodeHost(message.payload.provider, source);
        return;
      case "settings:update-slack-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setSlackToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-slack-token":
        await this.options.integrationSecrets.clearSlackToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-jira-credentials":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setJiraCredentials(
          message.payload.email,
          message.payload.token,
          message.payload.baseUrl
        );
        if (message.payload.baseUrl?.trim()) {
          await updateConfiguration({ jiraBaseUrl: message.payload.baseUrl.trim().replace(/\/+$/, "") });
        }
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-jira-credentials":
        await this.options.integrationSecrets.clearJiraCredentials();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-teams-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setTeamsToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-teams-token":
        await this.options.integrationSecrets.clearTeamsToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-confluence-credentials":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setConfluenceCredentials(
          message.payload.email,
          message.payload.token,
          message.payload.baseUrl
        );
        if (message.payload.baseUrl?.trim()) {
          const normalized = message.payload.baseUrl.trim().replace(/\/+$/, "");
          await updateConfiguration({
            confluenceBaseUrl: normalized.endsWith("/wiki") ? normalized : `${normalized}/wiki`
          });
        }
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-confluence-credentials":
        await this.options.integrationSecrets.clearConfluenceCredentials();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:copy-jira-to-confluence": {
        const creds = await this.options.integrationSecrets.getCredentials();
        if (!creds.jiraEmail || !creds.jiraToken) {
          void vscode.window.showWarningMessage(
            "Configure Jira email and API token first (Settings → Tools → Jira)."
          );
          return;
        }
        const jiraBase = creds.jiraBaseUrl?.trim().replace(/\/+$/, "") ?? "";
        const confluenceBase = jiraBase ? `${jiraBase}/wiki` : creds.confluenceBaseUrl;
        await this.options.integrationSecrets.setConfluenceCredentials(
          creds.jiraEmail,
          creds.jiraToken,
          confluenceBase
        );
        if (confluenceBase) {
          await updateConfiguration({ confluenceBaseUrl: confluenceBase });
        }
        await this.refreshAllSessionsPreferences();
        void vscode.window.showInformationMessage("Copied Jira credentials to Confluence.");
        return;
      }
      case "settings:update-notion-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setNotionToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-notion-token":
        await this.options.integrationSecrets.clearNotionToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:update-google-docs-token":
        if (!isCoopDevMode()) {
          return;
        }
        await this.options.integrationSecrets.setGoogleDocsToken(message.payload.token);
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:clear-google-docs-token":
        await this.options.integrationSecrets.clearGoogleDocsToken();
        await this.refreshAllSessionsPreferences();
        return;
      case "settings:save-identity-directory":
        if (this.preferences.canInstallIntegrations === false) {
          void vscode.window.showWarningMessage(
            "Only organization admins can save teammate identity links."
          );
          return;
        }
        await this.options.identityDirectoryStore.save(
          message.payload.directory,
          this.preferences.apiBaseUrl
        );
        clearPresenceCaches();
        await this.pushSettingsState();
        return;
      case "settings:test-integration":
        await this.handleTestIntegration(message.payload.provider, source, message.payload.draft);
        return;
      case "degradation:refresh":
        await this.handleDegradationRefresh(message.payload);
        return;
      case "conflict:action":
        this.handleConflictAction(message.payload.conflictId, message.payload.action);
        return;
      case "patch:apply":
        await applyPendingPatch(
          (payload) => this.postPatchUpdate(payload),
          message.payload?.messageTimestamp,
          message.payload?.matchSelections
        );
        return;
      case "patch:reject":
        rejectPendingPatchWithState(
          (payload) => this.postPatchUpdate(payload),
          "explicit",
          message.payload?.messageTimestamp
        );
        return;
      case "patch:apply-hunk":
        await applyPendingPatchHunk(
          (payload) => this.postPatchUpdate(payload),
          message.payload?.messageTimestamp,
          message.payload.hunkId,
          message.payload.matchLocationIds
        );
        return;
      case "patch:reject-hunk":
        rejectPendingPatchHunk(
          (payload) => this.postPatchUpdate(payload),
          message.payload?.messageTimestamp,
          message.payload.hunkId
        );
        return;
      case "patch:set-match-locations":
        setPendingPatchMatchLocations(
          (payload) => this.postPatchUpdate(payload),
          message.payload.messageTimestamp,
          message.payload.hunkId,
          message.payload.locationIds
        );
        return;
      case "patch:set-shared-match-proposal":
        setPendingSharedMatchProposal(
          (payload) => this.postPatchUpdate(payload),
          message.payload.messageTimestamp,
          message.payload.relativePath,
          message.payload.groupId,
          message.payload.locationId,
          message.payload.proposalId
        );
        return;
      case "patch:undo":
        await undoLastPatchWithState(
          (payload) => this.postPatchUpdate(payload),
          message.payload?.messageTimestamp
        );
        return;
      case "patch:open-file":
        void this.handleRemoteFileIntent({ path: message.payload.path, preserveContext: true });
        return;
      case "ownership:copy-draft":
        await vscode.env.clipboard.writeText(message.payload.text);
        void vscode.window.showInformationMessage("Ownership message draft copied to clipboard.");
        return;
      case "evidence:copy-text":
        await vscode.env.clipboard.writeText(message.payload.text);
        void vscode.window.showInformationMessage(message.payload.toast ?? "Copied to clipboard.");
        return;
      case "job:cancel":
        await this.handleJobCancel(message.payload.jobId);
        return;
      case "job:view-results":
        await this.handleJobViewResults(message.payload.jobId);
        return;
      case "lightning:ready":
        await this.pushLightningState();
        return;
      case "lightning:enable-global":
        await updateLightningConfiguration({ globalEnabled: true });
        await this.pushLightningState();
        void this.options.lightningStatusBar.refresh();
        return;
      case "lightning:disable-global":
        await updateLightningConfiguration({ globalEnabled: false });
        await this.pushLightningState();
        void this.options.lightningStatusBar.refresh();
        return;
      case "lightning:enable-repo":
        await this.handleLightningEnableRepo(message.payload.repoId);
        return;
      case "lightning:disable-repo":
        await this.options.indexBackend.disableRepo(message.payload.repoId);
        await this.pushLightningState();
        void this.options.lightningStatusBar.refresh();
        return;
      case "lightning:refresh-repo":
        await this.handleLightningRefreshRepo(message.payload.repoId);
        return;
      case "lightning:upgrade":
        void vscode.env.openExternal(vscode.Uri.parse(PRICING_PAGE_URL));
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
    if (Date.now() < this.editorContextSuppressedUntil) {
      return [];
    }
    const incoming = intentContextToRepoContext(event.context);
    if (
      this.pinnedContextFile &&
      incoming.file &&
      !pathsReferToSameFile(incoming.file, this.pinnedContextFile)
    ) {
      // User switched files in the editor — release the prior quick-action pin.
      this.pinnedContextFile = undefined;
    }
    // Remote provenance: ignore leftover local-clone snaps for the SAME path.
    // Explicit local choice (Downloads / different workspace file) clears remote — Rule B.
    if (this.isWorkingOnRemoteProvenance() && incoming.file?.trim()) {
      const explicitLocal =
        incoming.fileSource === "external" || isOsAbsoluteDiskPath(incoming.file);
      const differentLocalFile =
        (incoming.fileSource === "workspace" || incoming.fileSource === "git") &&
        this.currentContext.file?.trim() &&
        !isSameRepoFilePath(incoming.file, this.currentContext.file);
      if (explicitLocal || differentLocalFile) {
        this.remoteProvenanceFile = undefined;
        // Fall through to merge as local.
      } else if (
        incoming.fileSource !== "remote" &&
        this.currentContext.file?.trim() &&
        isSameRepoFilePath(incoming.file, this.currentContext.file)
      ) {
        this.currentContext = this.withRemoteProvenance(this.currentContext);
        this.postContext();
        return this.runIntentFetch(event, { quiet: true });
      }
    }
    // Never force scope:"repo" on an empty editor event — that wiped Downloads chips when
    // the sidebar stole focus (normalize stamped scope:repo → isExplicitRepoScope true).
    // Explicit explorer "Use repo" goes through setRepoContext / repoContextForRepoSelect.
    const toMerge = incoming.file?.trim()
      ? ({ ...incoming, scope: "file" } as RepoContext)
      : ({
          provider: incoming.provider,
          owner: incoming.owner,
          repo: incoming.repo,
          branch: incoming.branch
        } as RepoContext);
    this.currentContext = mergeRepoContext(this.currentContext, toMerge);
    this.currentContext = this.withRemoteProvenance(this.currentContext);
    this.postContext();
    return this.runIntentFetch(event, { quiet: true });
  }

  private async handleRemoteFileIntent(intent: {
    path: string;
    line?: number;
    preserveContext?: boolean;
  }): Promise<void> {
    const { path, line, preserveContext } = intent;

    if (preserveContext) {
      await this.openRepoFileForReview(path, line);
      this.postContext();
      return;
    }

    // Cancel pending editor snaps so a late FILE_SWITCHED can't overwrite this pick.
    this.intentDebouncer.cancelAll();
    this.pinnedContextFile = undefined;
    this.enablePassiveEditorSnap();
    // Hold editor refresh while we open — remote pick must not be overwritten by a
    // leftover local clone tab of the same path before VFS/API content is ready.
    this.editorContextSuppressedUntil = Date.now() + 8_000;

    // Absolute Downloads / Cmd+O path — always local (L), never stamp remote.
    // Use isOsAbsoluteDiskPath only (not looksLikeAbsoluteDiskPath) so "/src/foo.ts"
    // repo-relative paths are not misclassified as Downloads.
    if (isOsAbsoluteDiskPath(path)) {
      this.remoteProvenanceFile = undefined;
      const absolute = resolveLocalAbsolutePath(path) ?? path.replace(/\\/g, "/");
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preview: false,
          preserveFocus: false
        });
        if (line) {
          const position = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
      } catch {
        void vscode.window.showWarningMessage(`CoopAI could not open ${path} in the editor.`);
      }
      this.currentContext = mergeRepoContext(
        this.currentContext,
        repoContextForFile(absolute, this.currentContext.owner, this.currentContext.repo, {
          fileSource: "external"
        }) as RepoContext
      );
      this.postContext();
      return;
    }

    this.setRemoteProvenance(path);
    this.currentContext = mergeRepoContext(
      this.currentContext,
      repoContextForFile(path, this.currentContext.owner, this.currentContext.repo, {
        fileSource: "remote"
      }) as RepoContext
    );
    this.postContext();

    if (this.currentContext.owner && this.currentContext.repo) {
      // Remote explorer pick: VFS / API only — never a local clone of the same path.
      let opened = await openRemoteFileInEditor({
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        filePath: path,
        line,
        provider: this.currentContext.provider ?? this.preferences.defaultCodeHost,
        branch: this.currentContext.branch,
        preserveSidebarFocus: false
      });
      if (!opened) {
        opened = await this.openRemoteFileFromApi(path, line, { preserveFocus: false });
      }
      if (!opened) {
        const relative = path.replace(/^\/+/, "");
        void vscode.window.showWarningMessage(
          `CoopAI added ${relative} to context. Install GitHub Repositories to open remote files in the editor without reloading VS Code.`
        );
      }
    }

    this.currentContext = this.withRemoteProvenance(this.currentContext);
    this.postContext();

    const event = this.intentDetector.create(UserIntent.FILE_SWITCHED, {
      ...repoContextToIntentContext(this.currentContext),
      source: "webview"
    });
    await this.runIntentFetch(event, { quiet: true });
  }

  /** Open a repo file for manual review without changing chat context. */
  private async openRepoFileForReview(path: string, line?: number): Promise<void> {
    this.editorContextSuppressedUntil = Date.now() + 15_000;
    this.intentDebouncer.cancelAll();

    const remoteOnly = this.isWorkingOnRemoteProvenance();
    if (!remoteOnly) {
      const absolute = resolveLocalAbsolutePath(path);
      if (absolute) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true
        });
        this.revealLineInEditor(editor, line);
        return;
      }
    }

    if (this.currentContext.owner && this.currentContext.repo) {
      let opened = await openRemoteFileInEditor({
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        filePath: path,
        line,
        provider: this.currentContext.provider ?? this.preferences.defaultCodeHost,
        branch: this.currentContext.branch,
        preserveSidebarFocus: true,
        reviewOpen: true,
        allowLocalClone: !remoteOnly
      });
      if (!opened) {
        opened = await this.openRemoteFileFromApi(path, line, { preserveFocus: true, reviewOpen: true });
      }
      if (!opened) {
        const relative = path.replace(/^\/+/, "");
        void vscode.window.showWarningMessage(
          `Could not open ${relative} in the editor. Install GitHub Repositories to open remote files without reloading VS Code.`
        );
      }
    }
  }

  private revealLineInEditor(editor: vscode.TextEditor, line?: number): void {
    if (!line) {
      return;
    }
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private async openRemoteFileFromApi(
    filePath: string,
    line?: number,
    options?: { preserveFocus?: boolean; reviewOpen?: boolean }
  ): Promise<boolean> {
    const { owner, repo, provider, branch } = this.currentContext;
    if (!owner || !repo) {
      return false;
    }
    try {
      const remote = await this.options.codeHostRouter.getFileContent(filePath, {
        provider: provider ?? this.preferences.defaultCodeHost,
        owner,
        repo,
        branch
      });
      const text = remote.content ?? remote.lines.map((entry) => entry.text).join("\n");
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const language =
        ext === "ts" || ext === "tsx"
          ? "typescript"
          : ext === "js" || ext === "jsx"
            ? "javascript"
            : ext === "json"
              ? "json"
              : ext === "md"
                ? "markdown"
                : undefined;
      const doc = await vscode.workspace.openTextDocument({ content: text, language });
      const editor = await vscode.window.showTextDocument(doc, options?.reviewOpen
        ? {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: true
          }
        : {
            viewColumn: vscode.ViewColumn.One,
            preview: options?.preserveFocus ?? false,
            preserveFocus: options?.preserveFocus ?? false
          });
      this.revealLineInEditor(editor, line);
      return true;
    } catch {
      return false;
    }
  }

  private async runIntentFetch(
    event: IntentEvent,
    options: { quiet?: boolean; turn?: ChatTurn } = {}
  ): Promise<ContextFetchResult[]> {
    const requestTypes = requestTypesForIntent(event);
    if (requestTypes.length === 0) {
      return options.turn?.contextBundle ?? this.lastContextBundle;
    }

    const loadingState = this.loadingFeedbackFor(event);
    const turn = options.turn;
    const feedbackThreadId = turn?.threadId;
    const previousActivityThread = this.activityFeedbackThreadId;
    this.activityFeedbackThreadId = feedbackThreadId ?? this.activeThreadId();

    if (!options.quiet) {
      if (feedbackThreadId) {
        this.postIntentFeedbackForThread(feedbackThreadId, loadingState);
      } else {
        this.postIntentFeedback(loadingState);
      }
    } else if (loadingState.activityMessages?.length && this.activityFeedbackThreadId) {
      // Quiet gather (e.g. /gaps) still seeds tool lines so Slack/Jira stay visible.
      const threadId = this.activityFeedbackThreadId;
      const actionId = event.context.buttonClicked;
      const key = `${threadId}:${actionId ?? "chat"}`;
      const prior = this.chatDeliverableNarrative.get(key) ?? [];
      const merged = mergeActivityMessageLists(prior, loadingState.activityMessages);
      this.chatDeliverableNarrative.set(key, merged);
      this.postIntentFeedbackForThread(threadId, {
        status: "loading",
        intent: event.intent,
        actionId,
        title: loadingState.title,
        message: merged[merged.length - 1] ?? loadingState.message,
        activityMessages: merged,
        progress: loadingState.progress
      });
    }

    const requests = buildContextRequests(event, requestTypes).map((request) => {
      // Soft gather clock for blast-radius (responseDeadline) — shared across job + sync gather.
      if (request.params.quickAction !== "blast-radius") {
        return request;
      }
      const gatherStartedAt = this.chatTurnStartedAt || turn?.startedAt || Date.now();
      return {
        ...request,
        params: { ...request.params, gatherStartedAt }
      };
    });
    try {
      const baseResults = await Promise.all(
        requests.map((request) =>
          this.requestPrioritizer.enqueue(request, (prioritized) => this.requestBatcher.enqueue(prioritized))
        )
      );
      const results = await enrichIntentFetchResultsOnce({
        requests,
        results: baseResults,
        enrich: (result, request) => this.enrichChatContextWithIntegrations(result, request)
      });
      this.processConflicts(event, results);

      if (!options.quiet) {
        if (turn && !this.threadRuns.isStreamActive(turn)) {
          return turn.contextBundle;
        }
        const stale = results.find((result) => result.stale);
        const error = results.find((result) => result.error);
        const postFeedback = (payload: IntentFeedbackState) => {
          if (feedbackThreadId) {
            this.postIntentFeedbackForThread(feedbackThreadId, payload);
          } else {
            this.postIntentFeedback(payload);
          }
        };
        if (stale) {
          postFeedback({
            status: "rate-limited",
            intent: event.intent,
            actionId: event.context.buttonClicked,
            title: "Using cached context",
            message: stale.message,
            stale: true
          });
        } else if (error) {
          postFeedback({
            status: "error",
            intent: event.intent,
            actionId: event.context.buttonClicked,
            title: "Context fetch failed",
            message: error.error
          });
        } else if (!isPlainChatIntent(event) && event.context.buttonClicked !== "trace-decision") {
          // Plain chat keeps the loading strip until the first streamed token.
          postFeedback({
            status: "complete",
            intent: event.intent,
            actionId: event.context.buttonClicked,
            title: "Context ready",
            message: completionMessageFor(event)
          });
        }
      }

      if (turn) {
        if (!this.threadRuns.isStreamActive(turn)) {
          return turn.contextBundle;
        }
        // Fresh Trace must not reuse a prior file's decision_history from the turn/session bundle.
        const priorBundle =
          event.context.buttonClicked === "trace-decision"
            ? turn.contextBundle.filter((entry) => entry.type !== "decision_history")
            : turn.contextBundle;
        turn.contextBundle = mergeContextBundleResults(priorBundle, results, event.context.file);
        if (this.isViewingThread(turn.threadId)) {
          this.lastContextBundle = turn.contextBundle;
        }
        return turn.contextBundle;
      }

      const priorSessionBundle =
        event.context.buttonClicked === "trace-decision"
          ? this.lastContextBundle.filter((entry) => entry.type !== "decision_history")
          : this.lastContextBundle;
      this.lastContextBundle = mergeContextBundleResults(
        priorSessionBundle,
        results,
        event.context.file
      );
      return this.lastContextBundle;
    } catch (error) {
      if (!options.quiet) {
        const message = error instanceof Error ? error.message : "Context fetch failed";
        const payload: IntentFeedbackState = {
          status: "error",
          intent: event.intent,
          actionId: event.context.buttonClicked,
          title: "Context fetch failed",
          message
        };
        if (feedbackThreadId) {
          this.postIntentFeedbackForThread(feedbackThreadId, payload);
        } else {
          this.postIntentFeedback(payload);
        }
      }
      return turn?.contextBundle ?? this.lastContextBundle;
    } finally {
      this.activityFeedbackThreadId = previousActivityThread;
    }
  }

  private async fetchContextRequest(request: ContextFetchRequest): Promise<ContextFetchResult> {
    let result: ContextFetchResult;
    const isUnderstandRepo =
      request.params.quickAction === "understand-repo" && request.type === "file_metadata";

    if (isUnderstandRepo) {
      // Single path: same loader Remote browse / /understand use. No dual enrich race.
      result = await this.fetchUnderstandRepoEvidence(request);
    } else if (request.type === "chat_context") {
      const localPayload = this.pendingDualRepoCompare
        ? undefined
        : await this.tryFetchLocalFileContext(request);
      result = await this.buildBaseContextResult(request, localPayload);
      const queryText = request.intent.context?.queryText;
      if (this.pendingDualRepoCompare) {
        result = await this.enrichChatContextWithDualRepoCompare(request, result);
      } else if (hasRepoFactNeed(repoFactNeeds(queryText))) {
        result = await this.enrichChatContextWithRepoInventory(request, result);
      } else {
        result = await this.enrichChatContextWithSemanticSearch(request, result);
      }
      if (!this.pendingDualRepoCompare) {
        result = await this.enrichWithIndexedWorkspace(request, result);
      }
    } else {
      result = await this.buildBaseContextResult(request);
      result = await this.enrichWithIndexedWorkspace(request, result);
    }

    if (request.params.quickAction === "knowledge-gaps" && request.type === "knowledge_gaps") {
      result = await this.enrichKnowledgeGapsWithFocusSearch(request, result);
    }

    // Plain chat "who calls / who imports" — durable remote dependents (same API as Blast).
    if (
      request.type === "dependencies" &&
      !request.params.quickAction &&
      isFileCallerQuery(request.intent.context?.queryText)
    ) {
      result = await this.enrichPlainChatWithDurableDependents(request, result);
    }

    return result;
  }

  /**
   * Zero-Clone: indexBackend.dependents / import-parse first, then remote search.
   * Never localRoots. Soft-budget capped via remainingContextGatherBudgetMs.
   */
  private async enrichPlainChatWithDurableDependents(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    const file = request.params.file?.trim();
    const repoId = request.params.repoId?.trim();
    if (!file || !repoId) {
      return result;
    }

    const remainingMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    if (remainingMs <= 0) {
      return result;
    }

    const maxPatterns = remainingMs < 4_000 ? 4 : remainingMs < 8_000 ? 6 : 10;
    const askSymbols = extractBlastSearchSymbols(request.intent.context?.queryText, file);
    let exportSymbols: string[] = [];
    try {
      const workspace = this.indexedRepoWorkspace();
      const target = this.repoTargetForRequest(request);
      const evidence = await workspace.readFile(target, file);
      if (evidence?.content?.trim()) {
        exportSymbols = extractExportNamesFromSource(evidence.content);
      }
    } catch {
      // Soft gather — path-suffix patterns still run.
    }
    const symbols = [...new Set([...exportSymbols, ...askSymbols])];

    let resolved: Awaited<ReturnType<typeof resolveTrustedRemoteDependents>>;
    try {
      // Durable-first: skip Zoekt enrich when import-parse already returned callers.
      // If durable is empty, resolveTrustedRemoteDependents still runs remote search.
      resolved = await resolveTrustedRemoteDependents(this.options.indexBackend, repoId, file, {
        maxPatterns,
        symbols,
        enrichWithSearch: false
      });
    } catch {
      return result;
    }

    if (resolved.dependents.length === 0) {
      return result;
    }

    const baseData =
      typeof result.data === "object" && result.data !== null
        ? (result.data as Record<string, unknown>)
        : {};
    return {
      ...result,
      data: mergeDurableDependentsIntoContextData(
        { ...baseData, file },
        resolved
      )
    };
  }

  /**
   * Gaps + slash focus → index search for the focus string (not the leftover open file).
   * Soft-budget capped; synthesis still runs if search is thin or times out.
   */
  private async enrichKnowledgeGapsWithFocusSearch(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    const gatherQuery = knowledgeGapsGatherQuery(request.intent.context.queryText);
    if (!gatherQuery) {
      return result;
    }

    const baseData =
      typeof result.data === "object" && result.data !== null
        ? (result.data as Record<string, unknown>)
        : {};
    let data: Record<string, unknown> = { ...baseData, userFocus: gatherQuery };

    const target = this.repoTargetForRequest(request);
    const repoId = target.repoId?.trim();
    const owner = target.owner?.trim();
    const repo = target.repo?.trim();
    const remainingMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    if (!repoId || remainingMs <= 0) {
      return { ...result, data };
    }

    const provider =
      target.provider === "gitlab" || target.provider === "bitbucket" || target.provider === "github"
        ? target.provider
        : this.preferences.defaultCodeHost;

    try {
      const focusSearch = await Promise.race([
        searchRepoForFocusQuery({
          repoId,
          query: gatherQuery,
          indexBackend: this.options.indexBackend,
          api: this.options.api,
          apiBaseUrl: this.preferences.apiBaseUrl,
          branch: target.branch ?? this.currentContext.branch,
          owner,
          repo,
          provider
        }),
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), remainingMs);
        })
      ]);
      if (focusSearch?.files.length) {
        data = {
          ...data,
          focusSearchQuery: focusSearch.query,
          focusSearchPaths: focusSearch.files.map((file) => file.path),
          focusFiles: focusSearch.files
        };
      } else {
        data = { ...data, focusSearchQuery: gatherQuery };
      }
    } catch {
      data = { ...data, focusSearchQuery: gatherQuery };
    }

    return { ...result, data };
  }

  /**
   * Understand Repo evidence — one call through buildRepoSummaryEvidence (indexed then live),
   * after the turn already pinned the canonical branch. Capped to the gather budget so
   * synthesis can still start inside the 15s first-response window.
   */
  private async fetchUnderstandRepoEvidence(request: ContextFetchRequest): Promise<ContextFetchResult> {
    const target = this.repoTargetForRequest(request);
    const owner = target.owner?.trim();
    const repo = target.repo?.trim();
    const repoId = target.repoId?.trim();
    const base: ContextFetchResult = {
      requestId: request.id,
      type: request.type,
      data: {
        ...this.localContextDataFor(request),
        coopBuildId: COOP_EXTENSION_BUILD_ID
      },
      fetchedAt: new Date()
    };

    if (!owner || !repo || !repoId) {
      return {
        ...base,
        error: "missing-repo",
        message: `${coopBuildBanner()}: no repository selected for Understand Repo.`
      };
    }

    const budgetMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    if (budgetMs <= 0) {
      return {
        ...base,
        error: "gather-budget-exhausted",
        message: `${coopBuildBanner()}: context gather budget exhausted before repository evidence loaded.`
      };
    }

    const provider =
      target.provider === "gitlab" || target.provider === "bitbucket" || target.provider === "github"
        ? target.provider
        : this.preferences.defaultCodeHost;

    const userFocus = focusQueryForRetrieval(request.intent.context.queryText);

    try {
      const evidencePromise = buildRepoSummaryEvidence({
        api: this.options.api,
        apiBaseUrl: this.preferences.apiBaseUrl,
        codeHostRouter: this.options.codeHostRouter,
        owner,
        repo,
        branch: target.branch ?? this.currentContext.branch,
        repoId,
        provider,
        activeFile: undefined,
        userFocus,
        resolveWorkspaceBranch: async (id) => this.resolveWorkspaceDefaultBranch(id)
      });
      const evidence = await Promise.race([
        evidencePromise,
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), budgetMs);
        })
      ]);

      const baseData =
        typeof base.data === "object" && base.data !== null
          ? (base.data as Record<string, unknown>)
          : {};
      let evidenceData =
        evidence && typeof evidence === "object" ? (evidence as Record<string, unknown>) : {};

      // Focus ask → index/Zoekt search; merge hit bodies into entryFiles for synthesis.
      if (userFocus) {
        const remainingMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
        if (remainingMs > 0) {
          const focusSearch = await Promise.race([
            searchRepoForFocusQuery({
              repoId,
              query: userFocus,
              indexBackend: this.options.indexBackend,
              api: this.options.api,
              apiBaseUrl: this.preferences.apiBaseUrl,
              branch: target.branch ?? this.currentContext.branch,
              owner,
              repo,
              provider
            }),
            new Promise<undefined>((resolve) => {
              setTimeout(() => resolve(undefined), remainingMs);
            })
          ]);
          if (focusSearch?.files.length) {
            const priorEntries = Array.isArray(evidenceData.entryFiles)
              ? (evidenceData.entryFiles as Array<{ path: string; content?: string; truncated?: boolean }>)
              : [];
            evidenceData = {
              ...evidenceData,
              userFocus,
              entryFiles: mergeFocusFilesIntoEntryFiles(priorEntries, focusSearch.files),
              repoSemanticSearch: focusSearch,
              focusSearchQuery: focusSearch.query,
              focusSearchPaths: focusSearch.files.map((file) => file.path)
            };
          } else {
            evidenceData = { ...evidenceData, userFocus };
          }
        }
      }

      const resolvedFromEvidence =
        typeof evidenceData.branch === "string" ? evidenceData.branch.trim() : undefined;
      const data: Record<string, unknown> = {
        ...evidenceData,
        ...baseData,
        indexedWorkspaceAttached: true,
        coopBuildId: COOP_EXTENSION_BUILD_ID,
        resolvedBranch: resolvedFromEvidence || target.branch || this.currentContext.branch
      };

      const resolvedBranch =
        typeof data.resolvedBranch === "string" ? data.resolvedBranch.trim() : undefined;
      if (resolvedBranch && resolvedBranch !== this.currentContext.branch) {
        this.currentContext = { ...this.currentContext, branch: resolvedBranch };
        this.postContext();
      }

      return {
        ...base,
        data,
        error: hasRepoSummaryEvidence(data) ? undefined : "empty-evidence",
        message: hasRepoSummaryEvidence(data)
          ? `${coopBuildBanner()}: repository evidence attached.`
          : `${coopBuildBanner()}: no attachable repository evidence.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        error: "understand-repo-fetch-failed",
        message: `${coopBuildBanner()}: ${message}`
      };
    }
  }

  private mergeUnderstandRepoContextResults(
    indexedFirst: ContextFetchResult,
    featureResult: ContextFetchResult
  ): ContextFetchResult {
    const indexedData =
      typeof indexedFirst.data === "object" && indexedFirst.data !== null
        ? (indexedFirst.data as Record<string, unknown>)
        : {};
    const featureData =
      typeof featureResult.data === "object" && featureResult.data !== null
        ? (featureResult.data as Record<string, unknown>)
        : {};

    const mergedData = {
      ...featureData,
      ...indexedData,
      entryFiles: indexedData.entryFiles ?? featureData.entryFiles,
      manifest: featureData.manifest ?? indexedData.manifest,
      treeOverview: indexedData.treeOverview ?? featureData.treeOverview,
      repoInventory: indexedData.repoInventory ?? featureData.repoInventory,
      repository: featureData.repository ?? indexedData.repository
    };

    return {
      ...featureResult,
      ...indexedFirst,
      data: mergedData,
      error: hasRepoSummaryEvidence(mergedData) ? undefined : featureResult.error ?? indexedFirst.error,
      message: featureResult.message ?? indexedFirst.message
    };
  }

  /** Single entry point for indexed-repo facts and remote file reads. */
  private indexedRepoWorkspace(): IndexedRepoWorkspace {
    if (!this.workspaceFacade) {
      this.workspaceFacade = new IndexedRepoWorkspace({
        api: this.options.api,
        apiBaseUrl: this.preferences.apiBaseUrl,
        codeHostRouter: this.options.codeHostRouter
      });
    }
    return this.workspaceFacade;
  }

  private repoTargetForRequest(request: ContextFetchRequest): RepoTarget {
    const owner = request.params.owner ?? this.currentContext.owner ?? this.preferences.owner;
    const repo = request.params.repo ?? this.currentContext.repo ?? this.preferences.repo;
    const provider =
      (request.params.provider as RepoContext["provider"] | undefined) ??
      this.currentContext.provider ??
      this.preferences.defaultCodeHost ??
      "github";
    const repoId =
      request.params.repoId?.trim() ||
      (owner && repo ? buildRepoId(this.preferences, { owner, repo, provider }) : undefined);
    return {
      repoId,
      branch: request.params.branch ?? this.currentContext.branch ?? this.preferences.branch,
      owner,
      repo,
      provider
    };
  }

  private async enrichWithIndexedWorkspace(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    if (!(await this.shouldAttachIndexedWorkspace(request))) {
      return result;
    }
    let target = this.repoTargetForRequest(request);
    if (!target.repoId?.trim()) {
      return result;
    }
    const budgetMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    const enriched = await enrichContextWithIndexedRepo({
      deps: {
        api: this.options.api,
        apiBaseUrl: this.preferences.apiBaseUrl,
        codeHostRouter: this.options.codeHostRouter
      },
      target,
      request,
      result,
      budgetMs,
      resolveWorkspaceBranch: async (repoId) => this.resolveWorkspaceDefaultBranch(repoId)
    });

    const resolvedBranch = (enriched.data as { resolvedBranch?: string } | undefined)?.resolvedBranch;
    if (resolvedBranch?.trim() && resolvedBranch !== this.currentContext.branch) {
      this.currentContext = { ...this.currentContext, branch: resolvedBranch.trim() };
      this.postContext();
    }

    return enriched;
  }

  /** Prefer Deep-Index / GitHub default / workspace over stale Settings `main`. */
  private async pinCanonicalRepoBranchForTurn(): Promise<void> {
    const owner = this.currentContext.owner?.trim();
    const repo = this.currentContext.repo?.trim();
    if (!owner || !repo) {
      return;
    }
    const provider =
      this.currentContext.provider ?? this.preferences.defaultCodeHost ?? "github";
    const repoId = buildRepoId(this.preferences, { owner, repo, provider });
    if (!repoId) {
      return;
    }

    let branch: string | undefined;
    const hasApiToken = await this.options.api.hasToken();

    // 1) Indexed branch (Deep-Index) — strongest signal for non-main defaults like preview.
    if (hasApiToken) {
      try {
        branch = await this.resolveIndexedBranchForTarget(repoId, {
          repoId,
          owner,
          repo,
          provider,
          branch: this.currentContext.branch
        });
      } catch {
        branch = undefined;
      }
    }

    // 2) Full resolver (workspace catalog + tree probe) when index is missing.
    if (!branch) {
      try {
        const resolved = await resolveActiveRepoTarget(
          {
            repoId,
            owner,
            repo,
            branch: this.currentContext.branch,
            provider
          },
          {
            api: this.options.api,
            apiBaseUrl: this.preferences.apiBaseUrl,
            codeHostRouter: this.options.codeHostRouter,
            resolveWorkspaceBranch: hasApiToken
              ? async (id) => this.resolveWorkspaceDefaultBranch(id)
              : undefined
          }
        );
        branch = resolved.branch?.trim() || undefined;
      } catch {
        /* fall through */
      }
    }

    // 3) Live code-host default branch (works even without Coop API token).
    if (!branch) {
      try {
        const remote = await this.options.codeHostRouter.getRepository({
          provider,
          owner,
          repo
        });
        branch = remote.defaultBranch?.trim() || undefined;
      } catch {
        /* keep session branch */
      }
    }

    if (!branch) {
      this.logContextDebug(
        `Branch pin: no canonical branch for ${owner}/${repo} (session=${this.currentContext.branch ?? "none"})`
      );
      return;
    }

    if (branch === this.currentContext.branch) {
      return;
    }

    this.logContextDebug(
      `Branch pin: ${this.currentContext.branch ?? "none"} → ${branch} for ${owner}/${repo}`
    );
    this.currentContext = { ...this.currentContext, branch };
    this.postContext();
    // Stop Settings defaultBranch from re-poisoning the next snap with stale main.
    if (branch !== this.preferences.branch) {
      this.preferences = { ...this.preferences, branch };
      void updateConfiguration({ branch });
    }
  }

  private async resolveWorkspaceDefaultBranch(repoId: string): Promise<string | undefined> {
    if (!(await this.options.api.hasToken())) {
      return undefined;
    }
    try {
      const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
      const entry = workspace.repos.find(
        (item) => item.repoId === repoId || item.repoId.toLowerCase() === repoId.toLowerCase()
      );
      return entry?.defaultBranch?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveIndexedBranchForTarget(
    repoId: string,
    target: RepoTarget
  ): Promise<string | undefined> {
    if (!(await this.options.api.hasToken())) {
      return undefined;
    }
    return fetchIndexedBranch(this.options.api, this.preferences.apiBaseUrl, repoId, target);
  }

  private async shouldAttachIndexedWorkspace(request: ContextFetchRequest): Promise<boolean> {
    if (await this.isRepoInWorkspaceForRequest(request)) {
      return true;
    }
    const target = this.repoTargetForRequest(request);
    if (
      isExplicitRepoScope(this.currentContext) &&
      target.owner &&
      target.repo &&
      target.owner === this.currentContext.owner &&
      target.repo === this.currentContext.repo
    ) {
      return true;
    }
    return false;
  }

  private async isRepoInWorkspaceForRequest(request: ContextFetchRequest): Promise<boolean> {
    const target = this.repoTargetForRequest(request);
    const repoId = target.repoId?.trim();
    if (!repoId) {
      return false;
    }
    if (this.preferences.workspaceRepoIds?.includes(repoId)) {
      return true;
    }
    if (!(await this.options.api.hasToken())) {
      return false;
    }
    try {
      const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
      return workspace.repos.some(
        (entry) => entry.repoId === repoId || entry.repoId.toLowerCase() === repoId.toLowerCase()
      );
    } catch {
      return this.preferences.workspaceRepoIds?.includes(repoId) ?? false;
    }
  }

  private async enrichChatContextWithRepoInventory(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    const queryText = request.intent.context?.queryText;
    const needs = repoFactNeeds(queryText);
    if (!hasRepoFactNeed(needs)) {
      return result;
    }

    const workspace = this.indexedRepoWorkspace();
    const target = this.repoTargetForRequest(request);
    const needCount = needs.fileCount || needs.lineCount;
    const needStructure = needs.treeOverview || needs.packageManifests;

    const load = async (): Promise<ContextFetchResult> => {
      try {
        const [inventory, structure] = await Promise.all([
          needCount
            ? workspace.getInventory(target, needs, { allowExpensiveTreeWalk: false })
            : Promise.resolve(undefined),
          needStructure
            ? needs.packageManifests
              ? gatherPackageBoundaryEvidence(workspace, target)
              : workspace.getTreeOverview(target).then((treeOverview) => ({
                  treeOverview,
                  entryFiles: [] as Array<{
                    path: string;
                    content: string;
                    truncated?: boolean;
                    repoId: string;
                  }>,
                  note: undefined as string | undefined
                }))
            : Promise.resolve(undefined)
        ]);
        const treeOverview = structure?.treeOverview;
        const entryFiles = structure?.entryFiles;
        const packageBoundaryNote =
          structure && "note" in structure ? structure.note : undefined;
        const packageStructure =
          structure && "packageStructure" in structure ? structure.packageStructure : undefined;
        return mergeRepoInventoryContext(result, inventory, treeOverview, {
          entryFiles,
          packageBoundaryNote,
          packageStructure
        });
      } catch {
        return mergeRepoInventoryContext(result, {
          source: "unavailable",
          note: "Failed to load repository inventory. Do not estimate repository totals from search samples."
        });
      }
    };

    // Keep inventory inside the gather budget so synthesis can still answer within 15s.
    const budgetMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    if (budgetMs <= 0) {
      return mergeRepoInventoryContext(result, {
        source: "unavailable",
        note: "Timed out loading repository inventory within the response budget."
      });
    }

    return await Promise.race([
      load(),
      delayMs(budgetMs).then(() =>
        mergeRepoInventoryContext(result, {
          source: "unavailable",
          note: "Timed out loading repository inventory within the response budget."
        })
      )
    ]);
  }

  private async enrichChatContextWithSemanticSearch(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    try {
      const searchScope = resolveSearchScope(this.preferences);
      const semantic = await searchRepoForChat({
        request,
        indexBackend: this.options.indexBackend,
        api: this.options.api,
        apiBaseUrl: this.preferences.apiBaseUrl,
        branch: request.params.branch ?? this.currentContext.branch ?? this.preferences.branch,
        collectionId: searchScope.mode === "collection" ? searchScope.collectionId : undefined,
        searchScope: searchScope.scope,
        inScopeMentionCount: this.countInScopeMentionsForSemanticRetrieval(request),
        codeEditIntent: this.pendingCodeEditIntent,
        selectionText: this.pendingCodeEditIntent ? this.selectedCodeSnippet(2000) : undefined
      });
      return mergeRepoSemanticContext(result, semantic);
    } catch {
      return result;
    } finally {
      this.pendingChatMentions = undefined;
      // Keep pendingCodeEditIntent until local files are resolved for the model prompt.
    }
  }

  /**
   * /compare — fetch topic evidence from exactly two indexed repos in parallel.
   * Soft gather budget only; never invent long timeouts. Partial evidence is OK.
   */
  private async enrichChatContextWithDualRepoCompare(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    const plan = this.pendingDualRepoCompare;
    const baseData =
      typeof result.data === "object" && result.data !== null
        ? (result.data as Record<string, unknown>)
        : {};
    if (!plan) {
      return result;
    }

    const budgetMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    const stickyRepoId = buildRepoId(this.preferences, this.currentContext);
    const provider =
      this.preferences.defaultCodeHost === "gitlab" ||
      this.preferences.defaultCodeHost === "bitbucket" ||
      this.preferences.defaultCodeHost === "github"
        ? this.preferences.defaultCodeHost
        : "github";

    const fetchSide = async (side: DualRepoComparePlan["left"]) => {
      if (budgetMs <= 0) {
        return undefined;
      }
      try {
        return await Promise.race([
          searchRepoForFocusQuery({
            repoId: side.repoId,
            query: plan.topic,
            indexBackend: this.options.indexBackend,
            api: this.options.api,
            apiBaseUrl: this.preferences.apiBaseUrl,
            branch: this.currentContext.branch ?? this.preferences.branch,
            owner: side.owner,
            repo: side.repo,
            provider: side.provider || provider,
            maxFiles: DUAL_REPO_COMPARE_MAX_FILES_PER_SIDE
          }),
          new Promise<undefined>((resolve) => {
            setTimeout(() => resolve(undefined), budgetMs);
          })
        ]);
      } catch {
        return undefined;
      }
    };

    try {
      const [leftSearch, rightSearch] = await Promise.all([
        fetchSide(plan.left),
        fetchSide(plan.right)
      ]);
      const evidence = assembleDualRepoCompareEvidence({
        plan,
        leftFiles: leftSearch?.files ?? [],
        rightFiles: rightSearch?.files ?? [],
        stickyRepoId
      });
      return {
        ...result,
        data: {
          ...baseData,
          dualRepoCompare: evidence,
          // Drop sticky local attach — compare evidence is explicit dual only.
          localFiles: undefined
        }
      };
    } catch {
      const evidence = assembleDualRepoCompareEvidence({
        plan,
        leftFiles: [],
        rightFiles: [],
        stickyRepoId
      });
      return {
        ...result,
        data: {
          ...baseData,
          dualRepoCompare: evidence,
          localFiles: undefined
        }
      };
    } finally {
      this.pendingDualRepoCompare = undefined;
    }
  }

  private countInScopeMentionsForSemanticRetrieval(request: ContextFetchRequest): number {
    const mentions = this.pendingChatMentions;
    if (!mentions?.length) {
      return 0;
    }
    const activeRepoId = request.params.repoId ?? buildRepoId(this.preferences, this.currentContext);
    return partitionMentionsForTraceDecision(this.quickActionMentionRefs(mentions), activeRepoId).inRepo
      .length;
  }

  private async buildBaseContextResult(
    request: ContextFetchRequest,
    prefetchedLocal?: LocalFileContextPayload
  ): Promise<ContextFetchResult> {
    const localPayload = prefetchedLocal ?? (await this.tryFetchLocalFileContext(request));

    if (this.degradationConfig.enableGracefulFallback) {
      const action = request.params.quickAction as QuickActionFeatureId | undefined;
      const health = action ? await this.healthForQuickAction(action) : [];
      const degraded = await runFeatureFallback({
        request,
        health,
        cache: this.options.degradationCache
      });
      if (degraded) {
        const merged = applyLocalFallbackToResult(degraded, localPayload);
        this.maybeNotifyDegradation(request, merged);
        const enriched = await hybridEnrichContext(request, merged, this.options.indexBackend);
        return this.enrichWithAgentToolsIfEnabled(request, enriched);
      }
    }

    const base: ContextFetchResult = applyLocalFallbackToResult(
      {
        requestId: request.id,
        type: request.type,
        data: this.localContextDataFor(request),
        fetchedAt: new Date()
      },
      localPayload
    );
    const enriched = await hybridEnrichContext(request, base, this.options.indexBackend);
    return this.enrichWithAgentToolsIfEnabled(request, enriched);
  }

  private async enrichWithAgentToolsIfEnabled(
    request: ContextFetchRequest,
    result: ContextFetchResult
  ): Promise<ContextFetchResult> {
    if (
      request.type !== "chat_context" ||
      request.params.quickAction ||
      this.pendingDualRepoCompare ||
      this.pendingCodeEditIntent
    ) {
      return result;
    }

    const query = request.intent.context?.queryText;
    if (!query?.trim()) {
      return result;
    }

    if (
      !shouldRunAgentToolLoop({
        query,
        hasQuickAction: Boolean(request.params.quickAction),
        agentModeSetting: readAgentModeSetting(),
        intentPlan: this.turnIntentPlan,
        isEditTurn: this.pendingCodeEditIntent,
        contextBundle: [result]
      })
    ) {
      return result;
    }

    const repoId = request.params.repoId;
    if (!repoId) {
      return result;
    }

    try {
      const agentResult = await this.options.agentOrchestrator.run(
        {
          message: query,
          repoId,
          maxSteps: AGENT_MAX_TOOL_ROUNDS
        },
        {
          signal: this.turnStreamAbort,
          wallMs: AGENT_JOB_WALL_MS,
          planTurn: (input) => this.planAgentToolTurn(input),
          onStep: (_step, steps) => {
            this.postForThread(this.activeThreadId(), {
              type: "agent:activity",
              payload: {
                threadId: this.activeThreadId(),
                steps: steps.map((entry) => ({
                  index: entry.index,
                  tool: entry.tool,
                  summary: entry.summary,
                  completed: entry.completed
                }))
              }
            });
          }
        }
      );
      if (!agentResult.context) {
        return result;
      }

      const baseData =
        typeof result.data === "object" && result.data !== null
          ? (result.data as Record<string, unknown>)
          : {};

      return {
        ...result,
        data: {
          ...baseData,
          agentTools: agentResult.context,
          agentSteps: agentResult.steps
        }
      };
    } catch {
      return result;
    }
  }

  /**
   * Cheap JSON turn that picks the next read-only repo tool.
   * Fail-open: empty string → orchestrator falls back or stops.
   */
  private async planAgentToolTurn(input: {
    message: string;
    repoId: string;
    round: number;
    priorSteps: Array<{ summary: string }>;
    lastToolResult?: string;
  }): Promise<string> {
    if (this.turnStreamAbort?.aborted) {
      return JSON.stringify({ done: true });
    }
    const assignment = getFeatureModelAssignment("intentSuggest");
    const prompt = buildAgentToolPlanPrompt({
      message: input.message,
      repoId: input.repoId,
      round: input.round,
      priorSummaries: input.priorSteps.map((step) => step.summary),
      lastToolResult: input.lastToolResult
    });
    let full = "";
    try {
      await this.options.api.streamChat(
        {
          message: prompt,
          context: {},
          history: [],
          model: assignment.model,
          provider: assignment.provider,
          useCase: "intent_suggest",
          temperature: 0,
          maxTokens: 400,
          enableThinking: false
        },
        (chunk) => {
          full += chunk;
        },
        this.preferences.apiBaseUrl,
        this.turnStreamAbort
      );
    } catch {
      return "";
    }
    return full;
  }

  private async enrichChatContextWithIntegrations(
    result: ContextFetchResult,
    request: ContextFetchRequest
  ): Promise<ContextFetchResult> {
    const contextText = await this.integrationContextText(result, request);
    const integrationScopes = await this.resolveIntegrationScopes(request);
    const gapsFocus =
      request.params.quickAction === "knowledge-gaps"
        ? knowledgeGapsGatherQuery(request.intent.context.queryText)
        : undefined;
    const focusTerms = gapsFocus ? knowledgeGapsFocusGatherTerms(gapsFocus) : [];
    // When Gaps has focus text and the open file is unrelated, do not let the
    // leftover helper path dominate Confluence/Notion/Slack discovery terms.
    const activeFileForIntegrations =
      gapsFocus &&
      request.params.file?.trim() &&
      !openFileRelatedToGapsFocus(request.params.file, gapsFocus)
        ? undefined
        : request.params.file;
    const gathering = this.contextGatheringOptions();
    return mergeIntegrationChatContext({
      result,
      request,
      secrets: this.options.integrationSecrets,
      codeHostRouter: this.options.codeHostRouter,
      owner: request.params.owner ?? this.currentContext.owner ?? this.preferences.owner,
      repo: request.params.repo ?? this.currentContext.repo ?? this.preferences.repo,
      activeFile: activeFileForIntegrations,
      contextText,
      codeHostProvider: gathering.codeHostProvider ?? this.preferences.defaultCodeHost,
      codeHostConnected: gathering.codeHostConnected ?? this.isCodeHostConnected(),
      integrations: gathering.integrations,
      integrationScopes,
      // Focus phrases first so Gaps subsystem asks reach doc/discussion search.
      extraSearchTerms: focusTerms.length ? focusTerms : undefined,
      // Live tool lines in thinking UI — including quiet /gaps gather.
      onToolActivity: (toolEvent) => {
        if (toolEvent.phase !== "start") {
          return;
        }
        this.appendLiveToolActivityLine(
          toolEvent.label,
          request.params.quickAction,
          String(request.intent.intent)
        );
      },
      // Understand Repo pulls from every connected tool but is time-bounded so a
      // single slow integration can't block the overview. Slower tools are dropped.
      budgetMs:
        request.params.quickAction === "understand-repo"
          ? UNDERSTAND_REPO_INTEGRATION_BUDGET_MS
          : request.params.quickAction === "knowledge-gaps" ||
              (request.type === "chat_context" &&
                shouldFetchIncidentIntegrations(request.intent.context.queryText))
            ? Math.max(1, remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now()))
            : undefined
    });
  }

  /** Append a real tool line to the activity checklist (Slack, Jira, …). */
  private appendLiveToolActivityLine(
    line: string,
    actionId: string | undefined,
    intent?: string
  ): void {
    const threadId = this.activityFeedbackThreadId ?? this.activeThreadId();
    const turn = this.threadRuns.get(threadId);
    if (turn && turn.status !== "running") {
      return;
    }
    const key = `${threadId}:${actionId ?? "chat"}`;
    const prior =
      this.chatDeliverableNarrative.get(key) ??
      this.lastActivityMessagesByThread.get(threadId) ??
      [];
    if (prior.includes(line)) {
      // Re-post so the webview treats this tool as the active step again.
      this.postIntentFeedbackForThread(threadId, {
        status: "loading",
        intent,
        actionId,
        title: actionId ? jobTitleForAction(actionId) : "Fetching context...",
        message: line,
        activityMessages: prior
      });
      return;
    }
    const next = [...prior, line];
    this.chatDeliverableNarrative.set(key, next);
    this.postIntentFeedbackForThread(threadId, {
      status: "loading",
      intent,
      actionId,
      title: actionId ? jobTitleForAction(actionId) : "Fetching context...",
      message: line,
      activityMessages: next
    });
  }

  private async resolveIntegrationScopes(
    request: ContextFetchRequest
  ): Promise<Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>> | undefined> {
    if (isCoopDevMode()) {
      return undefined;
    }

    const providers: ScopedIntegrationProvider[] = [];
    if (shouldFetchSlackContext(request)) {
      providers.push("slack");
    }
    if (shouldFetchJiraContext(request) || shouldFetchConfluenceContext(request)) {
      providers.push("atlassian");
    }
    if (shouldFetchNotionContext(request)) {
      providers.push("notion");
    }
    if (shouldFetchGoogleDocsContext(request)) {
      providers.push("google-docs");
    }
    if (providers.length === 0) {
      return undefined;
    }

    const scopes: Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>> = {};
    await Promise.all(
      providers.map(async (provider) => {
        try {
          scopes[provider] = await this.options.api.getIntegrationScope(
            this.preferences.apiBaseUrl,
            provider
          );
        } catch {
          /* scope optional when API unavailable */
        }
      })
    );
    return scopes;
  }

  private async integrationContextText(
    result: ContextFetchResult,
    _request: ContextFetchRequest
  ): Promise<string[]> {
    // Zero-Clone: only bodies already on the bundle (remote attach) — never disk.
    return localFilesFromContextData(result.data).map((file) => file.content);
  }

  private async tryFetchLocalFileContext(
    _request: ContextFetchRequest
  ): Promise<LocalFileContextPayload | undefined> {
    // Zero-Clone: never prefetch workspace/disk bodies for gather.
    return undefined;
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

  public postPatchUpdate(payload: PatchCardsUpdatePayload): void {
    this.post({ type: "patch:update", payload });
  }

  private pushPatchState(): void {
    this.postPatchUpdate(resolvePatchCardsSnapshot());
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
                ownershipScore: numberValue(ownership.confidence) ?? scoreFromReport(ownership.report),
                recentCommits: numberValue(ownership.recentCommits) ?? commitsFromReport(ownership.report)
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

  private selectionFocusActivityMessage(context: RepoContext = this.currentContext): string | undefined {
    if (!context.selectedLines || context.selectedLines.length !== 2) {
      return undefined;
    }
    const lines = formatSelectedLinesChip(context.selectedLines);
    const file = context.file?.trim();
    if (file) {
      const base = file.split("/").pop() ?? file;
      return `Looking at ${lines} in ${base}…`;
    }
    return `Looking at highlighted ${lines}…`;
  }

  private withSelectionFocusActivity(messages: string[], context?: RepoContext): string[] {
    const focus = this.selectionFocusActivityMessage(context);
    if (!focus) {
      return messages;
    }
    return [focus, ...messages.filter((message) => message !== focus)];
  }

  private loadingFeedbackFor(
    event: IntentEvent,
    intentPlan?: ChatIntentPlan
  ): IntentFeedbackState {
    const action = event.context.buttonClicked;
    const baseMessages = contextGatheringMessagesFor(event, this.contextGatheringOptions());
    const planMessages = intentPlan ? buildIntentPlanActivityMessages(intentPlan) : [];
    const statusLine = intentPlan ? buildIntentPlanStatusLine(intentPlan) : undefined;
    const merged = [
      ...(statusLine ? [statusLine] : []),
      ...planMessages,
      ...baseMessages
    ];
    const activityMessages = this.withSelectionFocusActivity(
      dedupeActivityMessages(merged),
      intentContextToRepoContext(event.context)
    );
    if (action === "blast-radius") {
      return {
        status: "loading",
        intent: event.intent,
        actionId: action,
        title: statusLine ?? "Analyzing dependencies...",
        message: activityMessages[0],
        activityMessages,
        progress: 35
      };
    }
    if (action === "knowledge-gaps") {
      return {
        status: "loading",
        intent: event.intent,
        actionId: action,
        title: statusLine ?? "Scanning for knowledge gaps",
        message: activityMessages[0],
        activityMessages,
        progress: 15
      };
    }
    return {
      status: "loading",
      intent: event.intent,
      actionId: action,
      title: statusLine ?? "Fetching context...",
      message: activityMessages[0],
      activityMessages
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

  private async handleCompleteOnboarding(): Promise<void> {
    try {
      await this.options.api.completeOrgOnboarding(this.preferences.apiBaseUrl);
      await this.refreshAllSessionsPreferences();
    } catch (error) {
      // Banner already hid permanently in the webview; surface a soft warning only.
      const message = error instanceof Error ? error.message : "Could not mark org setup complete.";
      void vscode.window.showWarningMessage(message);
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
    } catch (error) {
      this.publishTestResult({ ok: false, message: this.testFailureMessage(error) }, source);
    }
  }

  private async handleTestIntegration(
    provider: IntegrationChatProvider,
    source: "chat" | "settings",
    draft?: { email?: string; token?: string; baseUrl?: string }
  ): Promise<void> {
    try {
      const { testIntegrationChat } = await import("../api/integrations/integrationTest");
      const result = await testIntegrationChat(provider, this.options.integrationSecrets, draft);
      this.publishTestResult(result, source);
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

  private async handleRefreshInstallation(
    key:
      | import("./types").CodeHostProviderPreference
      | "slack"
      | "jira"
      | "confluence"
      | "teams"
      | "notion"
      | "google-docs",
    source: "chat" | "settings"
  ): Promise<void> {
    try {
      await this.refreshAllSessionsPreferences();
      const prefs = this.preferences;
      const result = this.refreshStatusForKey(key, prefs);
      this.publishRefreshResult(result, source);
    } catch (error) {
      this.publishRefreshResult(
        { ok: false, message: this.testFailureMessage(error) },
        source
      );
    }
  }

  private refreshStatusForKey(
    key:
      | import("./types").CodeHostProviderPreference
      | "slack"
      | "jira"
      | "confluence"
      | "teams"
      | "notion"
      | "google-docs",
    prefs: UserPreferences
  ): { ok: boolean; message: string } {
    switch (key) {
      case "github": {
        const connected = prefs.hasGitHubAppInstalled || prefs.hasGitHubToken;
        return connected
          ? { ok: true, message: "GitHub status refreshed — connected." }
          : { ok: false, message: "GitHub status refreshed — not connected. Install the GitHub App." };
      }
      case "gitlab": {
        const connected = prefs.hasGitLabAppInstalled || prefs.hasGitLabToken;
        return connected
          ? { ok: true, message: "GitLab status refreshed — connected." }
          : { ok: false, message: "GitLab status refreshed — not connected. Authorize GitLab." };
      }
      case "bitbucket": {
        const connected = prefs.hasBitbucketAppInstalled || prefs.hasBitbucketCredentials;
        return connected
          ? { ok: true, message: "Bitbucket status refreshed — connected." }
          : { ok: false, message: "Bitbucket status refreshed — not connected. Authorize Bitbucket." };
      }
      case "slack": {
        const connected = prefs.hasSlackInstalled || prefs.hasSlackToken;
        return connected
          ? {
              ok: true,
              message: prefs.slackTeamName
                ? `Slack status refreshed — connected to ${prefs.slackTeamName}.`
                : "Slack status refreshed — connected."
            }
          : { ok: false, message: "Slack status refreshed — not connected. Connect Slack." };
      }
      case "jira": {
        const connected = prefs.hasAtlassianInstalled || prefs.hasJiraCredentials;
        return connected
          ? {
              ok: true,
              message: prefs.atlassianSiteName
                ? `Jira status refreshed — connected to ${prefs.atlassianSiteName}.`
                : "Jira status refreshed — connected."
            }
          : { ok: false, message: "Jira status refreshed — not connected. Connect Atlassian." };
      }
      case "confluence": {
        const connected = prefs.hasAtlassianInstalled || prefs.hasConfluenceCredentials;
        return connected
          ? {
              ok: true,
              message: prefs.atlassianSiteName
                ? `Confluence status refreshed — connected to ${prefs.atlassianSiteName}.`
                : "Confluence status refreshed — connected."
            }
          : { ok: false, message: "Confluence status refreshed — not connected. Connect Atlassian." };
      }
      case "teams": {
        const connected = prefs.hasTeamsInstalled || prefs.hasTeamsToken;
        return connected
          ? {
              ok: true,
              message: prefs.teamsDisplayName
                ? `Teams status refreshed — connected as ${prefs.teamsDisplayName}.`
                : "Teams status refreshed — connected."
            }
          : { ok: false, message: "Teams status refreshed — not connected. Connect Microsoft Teams." };
      }
      case "notion": {
        const connected = prefs.hasNotionInstalled || prefs.hasNotionToken;
        return connected
          ? {
              ok: true,
              message: prefs.notionWorkspaceName
                ? `Notion status refreshed — connected to ${prefs.notionWorkspaceName}.`
                : "Notion status refreshed — connected."
            }
          : { ok: false, message: "Notion status refreshed — not connected. Connect Notion." };
      }
      case "google-docs": {
        const connected = prefs.hasGoogleDocsInstalled || prefs.hasGoogleDocsToken;
        return connected
          ? {
              ok: true,
              message: prefs.googleDocsDisplayName
                ? `Google Docs status refreshed — connected as ${prefs.googleDocsDisplayName}.`
                : "Google Docs status refreshed — connected."
            }
          : { ok: false, message: "Google Docs status refreshed — not connected. Connect Google Docs." };
      }
      default:
        return { ok: true, message: "Status refreshed." };
    }
  }

  private publishRefreshResult(
    result: { ok: boolean; message: string },
    source: "chat" | "settings"
  ): void {
    if (source === "settings") {
      this.postToSettings({ type: "settings:refresh-result", payload: result });
    } else {
      this.postToChat({ type: "settings:refresh-result", payload: result });
    }
  }

  private emitUsageEvent(eventType: string, metadata?: Record<string, unknown>): void {
    void this.options.api.recordUsageEvents(eventType, metadata).catch(() => undefined);
  }

  private async handleChatSend(
    message: string,
    quickAction?: string,
    attachments?: ChatImageAttachment[],
    options?: {
      sourceHint?: string;
      integrationProvider?: IntegrationChatProvider;
      /** Planner allowlist — fetch these connected tools even without naming them in heuristics. */
      fetchIntegrations?: IntegrationChatProvider[];
      /** Active intent plan for this turn (trust UX + multi-tool synthesis). */
      intentPlan?: ChatIntentPlan;
      /** Bubble/history text; defaults to message (or quick-action tag prefix). */
      historyContent?: string;
      mentions?: ChatFileMention[];
      /** Custom text after a slash command token (e.g. `/gaps focus on auth`). */
      slashUserArgs?: string;
      /** Scope a quick action to a repository path (e.g. anchor file from a Sources card). */
      targetFile?: string;
      composerMode?: ComposerMode;
      /** Resume plain chat after a suggest chip without offering chips again. */
      skipQuickActionSuggest?: boolean;
      /** Continue after suggest without duplicating the user bubble already in history. */
      skipUserHistoryPush?: boolean;
      /** Skip Chat Intent Planner (already planned / slash / re-entry). */
      skipChatIntentPlanner?: boolean;
    }
  ): Promise<void> {
    // A new send abandons any unanswered suggest chips.
    if (!options?.skipQuickActionSuggest && !options?.skipUserHistoryPush) {
      this.dismissPendingQuickActionSuggest();
    }
    if (options?.intentPlan) {
      this.turnIntentPlan = options.intentPlan;
    }

    // Slash-command routing applies only to manually typed messages — never to
    // button-driven quick actions or already-routed integration prompts.
    if (!quickAction && !options?.sourceHint) {
      const parsed = parseSlashCommand(message);
      if (parsed) {
        await this.routeSlashCommand(parsed, attachments, options?.mentions);
        return;
      }
    }

    // Chat Intent Planner (plain chat): pick workflow + connected tools before chips/edit.
    // Slash and explicit integrationProvider remain the override.
    if (
      !quickAction &&
      !options?.sourceHint &&
      !options?.integrationProvider &&
      !options?.composerMode &&
      !options?.skipChatIntentPlanner &&
      !options?.skipQuickActionSuggest
    ) {
      const plan = await this.resolveChatIntentPlan(message);
      this.turnIntentPlan = plan;
      const decision = resolveChatIntentExecution(plan);
      if (decision.kind === "silent-workflow") {
        void this.emitUsageEvent("chat_intent.silent_workflow", {
          workflow: decision.workflow,
          tools: decision.tools
        });
        await this.handleChatSend("", decision.workflow, attachments, {
          slashUserArgs: decision.focus,
          historyContent: message,
          mentions: options?.mentions,
          fetchIntegrations: decision.tools.length ? decision.tools : undefined,
          intentPlan: decision.plan,
          skipQuickActionSuggest: true,
          skipChatIntentPlanner: true
        });
        return;
      }
      if (decision.kind === "confirm-workflow") {
        if (
          shouldSuppressSuggestChipsForAgentHunt({
            query: message,
            agentModeSetting: readAgentModeSetting()
          })
        ) {
          this.turnIntentPlan = emptyChatIntentPlan(message);
        } else {
          void this.emitUsageEvent("chat_intent.confirm_workflow", {
            workflow: decision.plan.workflow,
            tools: decision.tools
          });
          await this.completeQuickActionSuggestClarification(
            message,
            decision.offer,
            options?.mentions,
            attachments
          );
          return;
        }
      }
      if (decision.kind === "tools-only") {
        void this.emitUsageEvent("chat_intent.tools_only", { tools: decision.tools });
        options = {
          ...options,
          fetchIntegrations: decision.tools,
          intentPlan: decision.plan,
          // Single named tool keeps primary-source synthesis; multi-tool uses allowlist only.
          integrationProvider:
            decision.tools.length === 1 ? decision.tools[0] : options?.integrationProvider,
          skipChatIntentPlanner: true
        };
      } else if (
        !options?.integrationProvider &&
        !this.detectChatIntegrationProvider(message)
      ) {
        // Legacy chip path when planner has nothing (medium phrase-only still handled above).
        let offer = shouldOfferQuickActionSuggest(message, this.currentContext);
        if (!offer && isIntentSuggestModelEnabled() && !shouldSkipQuickActionSuggest(message)) {
          offer = await this.resolveHybridIntentSuggestOffer(message);
        }
        if (offer) {
          if (
            shouldSuppressSuggestChipsForAgentHunt({
              query: message,
              agentModeSetting: readAgentModeSetting()
            })
          ) {
            this.turnIntentPlan = emptyChatIntentPlan(message);
          } else {
            await this.completeQuickActionSuggestClarification(
              message,
              offer,
              options?.mentions,
              attachments
            );
            return;
          }
        }
      }
    }

    // Concrete "change this file" asks in plain chat must use the /edit Apply path —
    // soft prompt guidance alone still yields Copy-only language fences.
    if (
      !quickAction &&
      !options?.composerMode &&
      !options?.sourceHint &&
      !options?.integrationProvider &&
      isConcreteFileEditAsk(message)
    ) {
      options = { ...options, composerMode: "edit" };
    }

    this.snapEditorContextBeforeSend({
      allowLocalFileForEdit: options?.composerMode === "edit",
      preferRemoteForEdit: options?.composerMode === "edit"
    });

    // /edit requires an anchored file. Never demote to ask — that yields Summary /
    // status narratives (e.g. PENDING→OPEN) with no apply-able patch.
    if (
      !quickAction &&
      options?.composerMode === "edit" &&
      !hasEditTargetInScope({
        file: this.currentContext.file,
        mentionCount: options.mentions?.length ?? 0
      })
    ) {
      this.post({
        type: "chat:error",
        payload: { message: EDIT_NO_TARGET_FILE_ERROR }
      });
      return;
    }

    if (options?.mentions?.length) {
      this.currentContext = { ...this.currentContext, contextWarning: undefined };
      this.postContext();
    }

    await this.pinCanonicalRepoBranchForTurn();

    // Understand Repo is repo-wide only — drop leftover file chips (e.g. local AGENTS.md
    // from the EDH Coop-AI folder) so Use-repo coordinates stay authoritative.
    if (quickAction === "understand-repo") {
      this.currentContext = {
        ...this.currentContext,
        file: undefined,
        fileSource: undefined,
        selectedLines: undefined,
        selectedSymbol: undefined,
        languageId: undefined,
        scope: "repo",
        contextWarning: undefined
      };
      this.postContext();
    } else if (
      shouldIsolateActiveFileForQuickAction(quickAction) ||
      // Structure / package-boundary chat must not treat a foreign Coop tab as SoT.
      (!quickAction && needsRepoTreeOverview(message))
    ) {
      // Gaps / Trace / Blast / Owner / structure: never treat a foreign open editor as primary evidence.
      const localMatches = await localDiskMatchesTargetRepo({
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        provider: this.currentContext.provider
      });
      const isolated = dropForeignActiveFileEvidence(this.currentContext, {
        localWorkspaceMatchesUseRepo: localMatches
      });
      if (isolated.file !== this.currentContext.file || isolated.scope !== this.currentContext.scope) {
        this.currentContext = isolated;
        this.remoteProvenanceFile = undefined;
        this.postContext();
      }
    }

    const integrationProviderForGuard =
      quickAction || options?.sourceHint
        ? options?.integrationProvider
        : options?.integrationProvider ?? this.detectChatIntegrationProvider(message);
    if (
      shouldClarifyFirstChatTurn({
        message,
        hasPriorThreadMessages: this.chatHistory.length > 0,
        hasQuickAction: Boolean(quickAction),
        hasAttachments: Boolean(attachments?.length),
        hasMentions: Boolean(options?.mentions?.length),
        hasSourceHint: Boolean(options?.sourceHint),
        hasIntegrationProvider: Boolean(integrationProviderForGuard)
      })
    ) {
      await this.completeMissingIntentClarification(message, options?.mentions, attachments);
      return;
    }

    const actionContext = quickAction
      ? this.contextForQuickAction(this.currentContext, options?.targetFile)
      : this.currentContext;
    if (quickAction === "understand-repo") {
      this.currentContext = { ...this.currentContext, contextWarning: undefined };
    }
    const structureIntent = !quickAction && needsRepoTreeOverview(message);
    this.pendingChatLocalFiles =
      structureIntent ||
      Boolean(this.pendingDualRepoCompare) ||
      shouldSkipOpenFileAttach({
        quickAction,
        context: this.currentContext
      })
        ? undefined
        : this.loadLocalFilesSyncForChat({
            // Full active file for /edit and plain chat so SEARCH hunks can match beyond a selection.
            fullFile: options?.composerMode === "edit" || !quickAction
          });
    // Attach paths mutate currentContext directly (skip merge) — re-stamp remote + push chip.
    this.currentContext = this.withRemoteProvenance(this.currentContext);
    this.postContext();

    if (quickAction && isQuickActionBlocked(quickAction as QuickActionId, actionContext)) {
      this.post({
        type: "chat:error",
        payload: {
          message: quickActionBlockedMessage(quickAction as QuickActionId, actionContext)
        }
      });
      return;
    }

    if (await this.blockIfFreeQuotaExhausted()) {
      return;
    }

    if (quickAction) {
      void this.emitUsageEvent(`quick_action.${quickAction.replace(/-/g, "_")}`);
    }

    if (
      quickAction &&
      ["blast-radius", "find-owner", "trace-decision", "knowledge-gaps"].includes(quickAction) &&
      actionContext.file?.trim()
    ) {
      this.pinnedContextFile = actionContext.file.trim();
    }

    if (quickAction === "trace-decision") {
      const nextFile = actionContext.file?.trim();
      const priorFile = this.lastTraceDecisionTimeline?.file?.trim();
      if (nextFile && priorFile && !pathsReferToSameFile(nextFile, priorFile)) {
        this.lastTraceDecisionTimeline = undefined;
      }
    }

    const inheritedQuickAction = resolveEffectiveQuickAction(quickAction, this.chatHistory);
    // Planner tools-only / plain turns must not inherit a prior [blast-radius] sticky QA.
    const suppressInheritedQuickAction =
      Boolean(options?.fetchIntegrations?.length) ||
      Boolean(options?.integrationProvider) ||
      options?.intentPlan?.mode === "plain" ||
      options?.intentPlan?.mode === "tools-only";
    const intentQuickAction = quickAction ?? (suppressInheritedQuickAction ? undefined : inheritedQuickAction);

    const mentionRefs = this.quickActionMentionRefs(options?.mentions);
    const modelMessage = quickAction
      ? options?.slashUserArgs !== undefined
        ? appendQuickActionMentionScope(
            quickAction as QuickActionId,
            options.slashUserArgs,
            actionContext,
            mentionRefs
          )
        : quickActionModelPrompt(quickAction as QuickActionId, actionContext, mentionRefs)
      : message;

    // For a standard quick-action click, synthesis prompts only need the imperative
    // task sentence — the DIRECTIVE/context/evidence-bundle boilerplate is already
    // covered by the synthesis system prompt. Slash-arg focus text is passed separately
    // as userFocus so the canned action task stays intact.
    const taskMessage =
      quickAction
        ? quickActionPromptParts(quickAction as QuickActionId, actionContext, mentionRefs).task
        : modelMessage;
    const userFocus = options?.slashUserArgs?.trim() || undefined;

    const historyContent =
      options?.historyContent ??
      (quickAction
        ? quickActionHistoryContent(
            quickAction as QuickActionId,
            actionContext,
            options?.slashUserArgs,
            mentionRefs
          )
        : plainChatHistoryContent(message, mentionRefs, {
            context: actionContext,
            // Every user bubble (plain chat, follow-ups, /edit) shows active scope.
            includeContextChips: true
          }));
    // Stamp file/repo/branch when missing (follow-ups, bare slash lines). Leave
    // quick-action chip lines intact; always refresh for /edit + highlights.
    const historyWithScope =
      options?.composerMode === "edit" ||
      Boolean(actionContext.selectedLines) ||
      !historyContentHasScopeChips(historyContent)
        ? withContextChipLine(historyContent, actionContext, mentionRefs)
        : historyContent;
    if (shouldTrackEditRequest(options, quickAction)) {
      setLastEditUserMessage(historyWithScope);
      void this.emitUsageEvent("edit.requested");
    }
    const userMessage: ChatMessage = {
      role: "user",
      content: historyWithScope,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined
    };
    if (!options?.skipUserHistoryPush) {
      this.chatHistory.push(userMessage);
      if (this.chatHistory.length === 1) {
        this.setThreadTitle(
          summarizeThreadTitle({
            content: historyWithScope || attachments?.[0]?.name || "File attachment",
            quickAction,
            context: this.currentContext
          })
        );
      }
      this.postChatHistory();
      this.persistActiveThread();
    }
    this.chatTurnStartedAt = Date.now();

    const turn = this.threadRuns.begin({
      threadId: this.activeThreadId(),
      context: { ...this.currentContext },
      history: [...this.chatHistory],
      artifacts: [...this.threadArtifacts],
      sessionCostUsd: this.sessionCostUsd,
      modelMessage,
      quickAction,
      pendingMentions: options?.mentions,
      codeEditIntent: options?.composerMode === "edit"
    });
    // Align turn clock with chat timing helper (soft gather budgets use startedAt).
    turn.startedAt = this.chatTurnStartedAt;
    this.turnStreamAbort = turn.streamAbort.signal;
    this.pushThreadsList();

    const fetchIntegrations = options?.fetchIntegrations;
    const prefetchIntentEvent = intentQuickAction
      ? this.intentDetector.fromQuickAction(
          intentQuickAction,
          actionContext,
          userFocus ?? modelMessage,
          { fetchIntegrations }
        )
      : this.intentDetector.fromManualChatSubmit(this.currentContext, message, {
          integrationProvider:
            options?.integrationProvider ??
            (fetchIntegrations && fetchIntegrations.length > 1
              ? undefined
              : this.detectChatIntegrationProvider(message)),
          fetchIntegrations
        });
    this.postIntentFeedbackForThread(
      turn.threadId,
      this.loadingFeedbackFor(prefetchIntentEvent, options?.intentPlan)
    );

    if (quickAction && shouldUseAsyncJob(quickAction)) {
      try {
        const ranAsync = await abortablePromise(
          this.runAsyncQuickAction(quickAction, modelMessage, turn),
          turn.streamAbort.signal
        );
        if (!this.threadRuns.isStreamActive(turn)) {
          return;
        }
        if (ranAsync) {
          // Keep planner allowlist on async Blast/Gaps enrichment — otherwise
          // "check Jira" silent Blast reverts to fetching every connected tool.
          const intentEvent = this.intentDetector.fromQuickAction(
            quickAction,
            turn.context,
            userFocus ?? modelMessage,
            { fetchIntegrations }
          );
          await abortablePromise(
            this.runIntentFetch(intentEvent, { quiet: true, turn }),
            turn.streamAbort.signal
          );
          if (!this.threadRuns.isStreamActive(turn)) {
            return;
          }
          this.enrichKnowledgeGapsBundle(quickAction, turn);
          if (quickAction === "blast-radius") {
            await abortablePromise(
              this.applyBlastRadiusJobResultToBundle(quickAction, turn),
              turn.streamAbort.signal
            );
          }
          await abortablePromise(
            this.postEvidenceCardsFromBundle(quickAction, undefined, turn, fetchIntegrations),
            turn.streamAbort.signal
          );
          await this.continueChatAfterContext(modelMessage, quickAction, attachments, {
            mentions: options?.mentions,
            composerMode: options?.composerMode,
            taskContent: taskMessage,
            userFocus,
            turn,
            intentPlan: options?.intentPlan,
            fetchIntegrations
          });
          return;
        }
      } catch (error) {
        if (!this.threadRuns.isStreamActive(turn)) {
          return;
        }
        throw error;
      }
    }

    if (!this.threadRuns.isStreamActive(turn)) {
      return;
    }

    const integrationProvider =
      options?.integrationProvider ??
      (quickAction
        ? undefined
        : fetchIntegrations && fetchIntegrations.length > 1
          ? undefined
          : this.detectChatIntegrationProvider(message));
    const intentEvent = intentQuickAction
      ? this.intentDetector.fromQuickAction(
          intentQuickAction,
          actionContext,
          userFocus ?? modelMessage,
          { fetchIntegrations }
        )
      : this.intentDetector.fromManualChatSubmit(turn.context, message, {
          integrationProvider,
          fetchIntegrations
        });
    this.pendingChatMentions = options?.mentions;
    this.pendingCodeEditIntent = options?.composerMode === "edit";
    try {
      await abortablePromise(this.runIntentFetch(intentEvent, { turn }), turn.streamAbort.signal);
    } catch (error) {
      if (!this.threadRuns.isStreamActive(turn)) {
        return;
      }
      throw error;
    }
    // Enrichment may resolve indexed branch after the turn snapshot — keep Scope in sync.
    if (
      this.currentContext.branch?.trim() &&
      turn.context.branch !== this.currentContext.branch
    ) {
      turn.context = { ...turn.context, branch: this.currentContext.branch };
    }
    if (!this.threadRuns.isStreamActive(turn)) {
      return;
    }
    this.enrichKnowledgeGapsBundle(quickAction, turn);
    if (quickAction === "understand-repo") {
      // Don't block synthesis on graph enrichment for the evidence card.
      void this.postEvidenceCardsFromBundle(quickAction, integrationProvider, turn, fetchIntegrations);
    } else {
      try {
        await abortablePromise(
          this.postEvidenceCardsFromBundle(quickAction, integrationProvider, turn, fetchIntegrations),
          turn.streamAbort.signal
        );
      } catch (error) {
        if (!this.threadRuns.isStreamActive(turn)) {
          return;
        }
        throw error;
      }
    }
    if (!this.threadRuns.isStreamActive(turn)) {
      return;
    }
    await this.continueChatAfterContext(modelMessage, quickAction, attachments, {
      sourceHint: options?.sourceHint,
      integrationProvider,
      mentions: options?.mentions,
      composerMode: options?.composerMode,
      taskContent: taskMessage,
      userFocus,
      turn,
      intentPlan: options?.intentPlan,
      fetchIntegrations
    });
  }

  private async completeMissingIntentClarification(
    message: string,
    mentions?: ChatFileMention[],
    attachments?: ChatImageAttachment[]
  ): Promise<void> {
    const mentionRefs = this.quickActionMentionRefs(mentions);
    const historyContent = plainChatHistoryContent(message, mentionRefs, {
      context: this.currentContext,
      includeContextChips: true
    });
    const userMessage: ChatMessage = {
      role: "user",
      content: historyContent,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined
    };
    this.chatHistory.push(userMessage);
    if (this.chatHistory.length === 1) {
      this.setThreadTitle(
        summarizeThreadTitle({
          content: historyContent || attachments?.[0]?.name || "File attachment",
          context: this.currentContext
        })
      );
    }
    this.postChatHistory();
    this.persistActiveThread();
    this.chatTurnStartedAt = Date.now();
    this.clearIntentFeedback();

    const responseContent = buildMissingIntentClarificationResponse({
      file: this.currentContext.file,
      owner: this.currentContext.owner ?? this.preferences.owner,
      repo: this.currentContext.repo ?? this.preferences.repo
    });

    await delayUntilMinResponseVisible(this.chatTurnStartedAt);
    const finalMessage: ChatMessage = {
      role: "assistant",
      content: responseContent,
      timestamp: Date.now()
    };
    this.chatHistory.push(finalMessage);
    this.post({ type: "chat:complete", payload: { message: finalMessage } });
    this.postChatHistory();
    this.persistActiveThread();
  }

  private dismissPendingQuickActionSuggest(): void {
    const pending = this.pendingQuickActionSuggest;
    if (!pending) {
      return;
    }
    this.pendingQuickActionSuggest = undefined;
    this.markSuggestResolved(pending.assistantTimestamp);
    this.postChatHistory();
    this.persistActiveThread();
  }

  /**
   * Hybrid path: call gpt-4o-mini only when the phrase classifier returned nothing.
   * Fail-open on error/timeout/abort → undefined (plain chat continues).
   */
  private async resolveHybridIntentSuggestOffer(
    message: string
  ): Promise<ReturnType<typeof shouldOfferQuickActionSuggest>> {
    this.intentSuggestAbort?.abort();
    const controller = new AbortController();
    this.intentSuggestAbort = controller;

    const complete: IntentSuggestCompleteFn = async (params) => {
      let full = "";
      await this.options.api.streamChat(
        {
          message: params.message,
          context: {},
          history: [],
          model: params.model,
          provider: params.provider,
          useCase: "intent_suggest",
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          enableThinking: false
        },
        (chunk) => {
          full += chunk;
        },
        this.preferences.apiBaseUrl,
        params.signal
      );
      return full;
    };

    try {
      void this.emitUsageEvent("suggest_intent.model_invoked");
      const result = await classifyQuickActionIntent(message, complete, {
        activeFile: this.currentContext.file,
        signal: controller.signal
      });
      if (!result || result.suggestions.length === 0) {
        void this.emitUsageEvent("suggest_intent.model_none");
        return undefined;
      }
      const available = filterSuggestableActions(result.suggestions, this.currentContext);
      if (available.length === 0) {
        void this.emitUsageEvent("suggest_intent.model_none");
        return undefined;
      }
      const top = available[0]!;
      void this.emitUsageEvent("suggest_intent.model_hit", {
        actionId: top.actionId
      });
      return offerFromActionId(top.actionId, result.confidence);
    } catch {
      void this.emitUsageEvent("suggest_intent.model_error");
      return undefined;
    } finally {
      if (this.intentSuggestAbort === controller) {
        this.intentSuggestAbort = undefined;
      }
    }
  }

  private markSuggestResolved(assistantTimestamp: number): void {
    for (let i = this.chatHistory.length - 1; i >= 0; i--) {
      const entry = this.chatHistory[i];
      if (entry?.role === "assistant" && entry.timestamp === assistantTimestamp && entry.suggest) {
        entry.suggest = { ...entry.suggest, resolved: true };
        return;
      }
    }
  }

  private async completeQuickActionSuggestClarification(
    message: string,
    offer: NonNullable<ReturnType<typeof shouldOfferQuickActionSuggest>>,
    mentions?: ChatFileMention[],
    attachments?: ChatImageAttachment[]
  ): Promise<void> {
    const mentionRefs = this.quickActionMentionRefs(mentions);
    const historyContent = plainChatHistoryContent(message, mentionRefs, {
      context: this.currentContext,
      includeContextChips: true
    });
    const userMessage: ChatMessage = {
      role: "user",
      content: historyContent,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined
    };
    this.chatHistory.push(userMessage);
    if (this.chatHistory.length === 1) {
      this.setThreadTitle(
        summarizeThreadTitle({
          content: historyContent || attachments?.[0]?.name || "File attachment",
          context: this.currentContext
        })
      );
    }
    this.postChatHistory();
    this.persistActiveThread();
    this.chatTurnStartedAt = Date.now();
    this.clearIntentFeedback();

    const chips = [
      ...offer.suggestions.map((suggestion) => ({
        kind: "quick-action" as const,
        actionId: suggestion.actionId,
        label: suggestRunChipLabel(suggestion.actionId)
      })),
      { kind: "plain" as const, label: "Just answer" }
    ];

    await delayUntilMinResponseVisible(this.chatTurnStartedAt);
    const assistantTimestamp = Date.now();
    const finalMessage: ChatMessage = {
      role: "assistant",
      content: offer.clarifyingPrompt,
      timestamp: assistantTimestamp,
      suggest: {
        focus: message.trim(),
        chips
      }
    };
    this.chatHistory.push(finalMessage);
    this.pendingQuickActionSuggest = {
      focus: message.trim(),
      mentions,
      attachments,
      assistantTimestamp
    };
    void this.emitUsageEvent("suggest_chip.shown");
    this.post({ type: "chat:complete", payload: { message: finalMessage } });
    this.postChatHistory();
    this.persistActiveThread();
  }

  private async handleSuggestResolve(
    payload: { choice: "plain" } | { choice: "action"; actionId: string }
  ): Promise<void> {
    const pending = this.pendingQuickActionSuggest;
    if (!pending) {
      return;
    }
    this.pendingQuickActionSuggest = undefined;
    this.markSuggestResolved(pending.assistantTimestamp);
    this.postChatHistory();
    this.persistActiveThread();

    if (payload.choice === "plain") {
      void this.emitUsageEvent("suggest_chip.dismissed");
      await this.handleChatSend(pending.focus, undefined, pending.attachments, {
        mentions: pending.mentions,
        skipQuickActionSuggest: true,
        skipUserHistoryPush: true,
        skipChatIntentPlanner: true,
        intentPlan: emptyChatIntentPlan(pending.focus)
      });
      return;
    }

    if (!isQuickActionId(payload.actionId)) {
      return;
    }
    const actionId = payload.actionId;
    if (isQuickActionBlocked(actionId, this.currentContext)) {
      this.post({
        type: "chat:error",
        payload: { message: quickActionBlockedMessage(actionId, this.currentContext) }
      });
      return;
    }

    void this.emitUsageEvent("suggest_chip.accepted");
    const mentionRefs = this.quickActionMentionRefs(pending.mentions);
    const historyContent = quickActionHistoryContent(
      actionId,
      this.currentContext,
      pending.focus,
      mentionRefs
    );
    await this.handleChatSend("", actionId, pending.attachments, {
      historyContent,
      mentions: pending.mentions,
      slashUserArgs: pending.focus
    });
  }

  private quickActionMentionRefs(mentions?: ChatFileMention[]): QuickActionMentionRef[] {
    return (mentions ?? []).slice(0, 3).map((mention) => ({
      path: mention.path,
      repoId: mention.repoId,
      source:
        mention.source ?? (mention.repoId === WORKSPACE_LOCAL_REPO_ID ? ("local" as const) : undefined)
    }));
  }

  private contextForQuickAction(context: RepoContext, targetFile?: string): RepoContext {
    const scoped = targetFile?.trim().replace(/^\/+/, "");
    if (!scoped) {
      return context;
    }
    return { ...context, file: scoped };
  }

  private async routeCompareSlashCommand(
    focus: string,
    attachments?: ChatImageAttachment[],
    mentions?: ChatFileMention[]
  ): Promise<void> {
    let catalogRepoIds: string[] = [];
    try {
      catalogRepoIds = await this.resolveMentionSearchRepoIds();
    } catch {
      catalogRepoIds = [];
    }
    const defaultOwner =
      this.currentContext.owner?.trim() || this.preferences.owner?.trim() || undefined;
    const parsed = parseDualRepoCompareArgs(focus, {
      catalogRepoIds,
      defaultOwner,
      defaultProvider: this.preferences.defaultCodeHost
    });
    if (!parsed.ok) {
      this.post({
        type: "chat:error",
        payload: { message: parsed.error || DUAL_REPO_COMPARE_USAGE }
      });
      return;
    }

    this.pendingDualRepoCompare = parsed.plan;
    const historyContent = dualRepoCompareHistoryContent(parsed.plan);
    const userText = dualRepoCompareUserMessage(parsed.plan);
    try {
      await this.handleChatSend(userText, undefined, attachments, {
        historyContent,
        mentions,
        slashUserArgs: parsed.plan.topic
      });
    } finally {
      // Enrich clears on success; clear here if the turn exited before context gather.
      if (this.pendingDualRepoCompare === parsed.plan) {
        this.pendingDualRepoCompare = undefined;
      }
    }
  }

  private async routeSlashCommand(
    parsed: ParsedSlashCommand,
    attachments?: ChatImageAttachment[],
    mentions?: ChatFileMention[]
  ): Promise<void> {
    const { def, focus } = parsed;
    const mentionRefs = this.quickActionMentionRefs(mentions);
    // Focus = text before + after the slash token (not args-after only).
    const slashUserArgs = focus.trim() || undefined;

    if (def.target.kind === "compare") {
      await this.routeCompareSlashCommand(focus, attachments, mentions);
      return;
    }

    if (def.target.kind === "action") {
      const actionId = def.target.actionId;
      if (isQuickActionBlocked(actionId, this.currentContext)) {
        this.post({
          type: "chat:error",
          payload: { message: quickActionBlockedMessage(actionId, this.currentContext) }
        });
        return;
      }
      const historyContent = quickActionHistoryContent(
        actionId,
        this.currentContext,
        slashUserArgs,
        mentionRefs
      );
      await this.handleChatSend("", actionId, attachments, {
        historyContent,
        mentions,
        slashUserArgs
      });
      return;
    }

    if (def.target.kind === "composer-mode") {
      const historyContent = slashCommandHistoryContent(def, focus);
      const userText =
        focus.trim() || "Generate search-replace patches for the requested changes.";
      await this.handleChatSend(userText, undefined, attachments, {
        historyContent,
        mentions,
        slashUserArgs: slashUserArgs,
        composerMode: def.target.mode
      });
      return;
    }

    if (def.target.kind !== "integration") {
      return;
    }

    const historyContent = slashCommandHistoryContent(def, focus);

    const provider = def.target.provider;
    if (!this.isIntegrationConnected(provider)) {
      const label = integrationLabel(provider);
      this.postDegradationNotification({
        id: `slash-${provider}-${Date.now()}`,
        severity: "warning",
        title: `${label} isn't connected`,
        message: `Connect ${label} in Settings to use /${provider}.`,
        provider,
        action: "refresh"
      });
      return;
    }

    const label = integrationLabel(provider);
    const repoLabel =
      this.preferences.owner && this.preferences.repo
        ? `${this.preferences.owner}/${this.preferences.repo}`
        : "this repository";
    const userText =
      focus.length > 0
        ? focus
        : provider === "jira"
          ? `Find Jira tickets related to ${repoLabel}.`
          : provider === "confluence"
            ? `Find Confluence pages related to ${repoLabel}.`
            : provider === "notion"
              ? `Find Notion pages related to ${repoLabel}.`
              : provider === "google-docs"
                ? `Find Google Docs related to ${repoLabel}.`
                : `Summarize the most relevant ${label} discussions for this code.`;
    const sourceHint = `Prioritize evidence from ${label} when answering. Cite specific ${label} messages or items when available, and clearly state when ${label} has no relevant information.`;
    await this.handleChatSend(userText, undefined, attachments, {
      sourceHint,
      integrationProvider: provider,
      historyContent,
      mentions,
      slashUserArgs
    });
  }

  private isIntegrationConnected(provider: IntegrationChatProvider): boolean {
    switch (provider) {
      case "slack":
        return this.preferences.hasSlackToken || this.preferences.hasSlackInstalled;
      case "jira":
        return this.preferences.hasJiraCredentials || this.preferences.hasAtlassianInstalled;
      case "teams":
        return this.preferences.hasTeamsToken || this.preferences.hasTeamsInstalled;
      case "confluence":
        return this.preferences.hasConfluenceCredentials || this.preferences.hasAtlassianInstalled;
      case "notion":
        return this.preferences.hasNotionToken || this.preferences.hasNotionInstalled;
      case "google-docs":
        return this.preferences.hasGoogleDocsToken || this.preferences.hasGoogleDocsInstalled;
      default:
        return false;
    }
  }

  private listConnectedIntegrationTools(): IntegrationChatProvider[] {
    return CHAT_INTENT_TOOL_PROVIDERS.filter((provider) => this.isIntegrationConnected(provider));
  }

  /**
   * Phrase-first Chat Intent Planner, with optional cheap model when rules return none.
   * Fail-open → empty plan (plain chat).
   */
  private async resolveChatIntentPlan(message: string): Promise<ChatIntentPlan> {
    const connectedTools = this.listConnectedIntegrationTools();
    const input = {
      message,
      activeFile: this.currentContext.file,
      connectedTools
    };
    const rulesPlan = planChatIntentFromRules(input);
    // Locked plain explain / any non-empty rules plan — do not let the model promote Blast.
    if (rulesPlan.mode === "plain" || rulesPlan.mode !== "none") {
      return rulesPlan;
    }
    if (!isIntentSuggestModelEnabled()) {
      return rulesPlan;
    }

    this.intentSuggestAbort?.abort();
    const controller = new AbortController();
    this.intentSuggestAbort = controller;
    const complete: IntentSuggestCompleteFn = async (params) => {
      let full = "";
      await this.options.api.streamChat(
        {
          message: params.message,
          context: {},
          history: [],
          model: params.model,
          provider: params.provider,
          useCase: "intent_suggest",
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          enableThinking: false
        },
        (chunk) => {
          full += chunk;
        },
        this.preferences.apiBaseUrl,
        params.signal
      );
      return full;
    };

    try {
      const modelPlan = await classifyChatIntentPlan(input, complete, {
        signal: controller.signal
      });
      return modelPlan ?? rulesPlan;
    } catch {
      return rulesPlan;
    } finally {
      if (this.intentSuggestAbort === controller) {
        this.intentSuggestAbort = undefined;
      }
    }
  }

  private detectChatIntegrationProvider(message: string): IntegrationChatProvider | undefined {
    return resolvePlainChatIntegrationProvider({
      message,
      isConnected: (provider) => this.isIntegrationConnected(provider)
    });
  }

  private isCodeHostConnected(): boolean {
    return this.isCodeHostProviderConnected(this.preferences.defaultCodeHost);
  }

  private isCodeHostProviderConnected(provider: import("./types").CodeHostProviderPreference): boolean {
    switch (provider) {
      case "gitlab":
        return this.preferences.hasGitLabToken || this.preferences.hasGitLabAppInstalled;
      case "bitbucket":
        return this.preferences.hasBitbucketCredentials || this.preferences.hasBitbucketAppInstalled;
      case "github":
      default:
        return this.preferences.hasGitHubToken || this.preferences.hasGitHubAppInstalled;
    }
  }

  private contextGatheringOptions(): ContextGatheringMessageOptions {
    const codeHostProvider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    return {
      codeHostProvider,
      codeHostConnected: this.isCodeHostProviderConnected(codeHostProvider),
      integrations: {
        jira: this.isIntegrationConnected("jira"),
        slack: this.isIntegrationConnected("slack"),
        teams: this.isIntegrationConnected("teams"),
        confluence: this.isIntegrationConnected("confluence"),
        notion: this.isIntegrationConnected("notion"),
        googleDocs: this.isIntegrationConnected("google-docs")
      }
    };
  }

  private postChatHistory(): void {
    this.post({
      type: "chat:history",
      payload: { messages: this.chatHistory, artifacts: this.threadArtifacts }
    });
  }

  private recordEvidenceArtifact(
    kind: ChatPersistedArtifact["kind"],
    artifactId: string,
    payload: Record<string, unknown>
  ): void {
    this.threadArtifacts.push({
      id: artifactId,
      kind,
      timestamp: Date.now(),
      payload
    });
    this.persistActiveThread();
  }

  private beginEvidenceArtifact(): string {
    const id = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingEvidenceArtifactId = id;
    return id;
  }

  private async postEvidenceCardsFromBundle(
    quickAction?: string,
    integrationProvider?: IntegrationChatProvider,
    turn?: ChatTurn,
    fetchIntegrations?: IntegrationChatProvider[]
  ): Promise<void> {
    await this.withTurnSessionMirrors(turn, async () => {
      const multiTools = (fetchIntegrations ?? []).filter(Boolean);
      if (turn && !this.isViewingThread(turn.threadId)) {
        // Still allocate evidence ids / artifacts onto the turn; skip UI posts.
        if (quickAction === "trace-decision") {
          this.beginEvidenceArtifact();
          return;
        }
        if (
          quickAction === "find-owner" ||
          quickAction === "understand-repo" ||
          quickAction === "blast-radius" ||
          quickAction === "knowledge-gaps" ||
          integrationProvider ||
          multiTools.length > 0
        ) {
          this.beginEvidenceArtifact();
        }
        return;
      }
      if (quickAction === "trace-decision") {
        await this.postDecisionTimelineFromBundle();
        return;
      }
      if (quickAction === "find-owner") {
        this.postOwnershipCardFromBundle();
        return;
      }
      if (quickAction === "understand-repo") {
        await this.postRepoSummaryEvidenceFromBundle();
        return;
      }
      if (quickAction === "blast-radius") {
        this.postBlastRadiusEvidenceFromBundle();
        return;
      }
      if (quickAction === "knowledge-gaps") {
        this.postKnowledgeGapsEvidenceFromBundle();
        return;
      }
      if (integrationProvider) {
        this.postIntegrationEvidenceFromBundle(integrationProvider);
        return;
      }
      // Multi-tool plain chat: one Sources card per planned tool that has evidence.
      if (multiTools.length >= 2) {
        for (const provider of multiTools) {
          this.postIntegrationEvidenceFromBundle(provider);
        }
      }
    });
  }

  private async enrichRepoSummaryGraphEvidence(
    evidence: RepoSummaryEvidence
  ): Promise<RepoSummaryEvidence> {
    const owner = this.currentContext.owner ?? this.preferences.owner;
    const repo = this.currentContext.repo ?? this.preferences.repo;
    if (!owner || !repo) {
      return evidence;
    }
    const coords: RepoCoordinates = {
      provider: this.currentContext.provider ?? this.preferences.defaultCodeHost ?? "github",
      owner,
      repo,
      branch: this.currentContext.branch ?? this.preferences.branch
    };
    const repoId = repoIdFromCoordinates(coords);
    const candidatePaths = [
      this.currentContext.file?.trim(),
      ...(evidence.entryFiles?.map((file) => file.path) ?? []),
      ...(evidence.manifest?.entryPoints ?? []),
      "README.md",
      "readme.md",
      "package.json",
      "fastify.js",
      "src/index.ts"
    ].filter((path): path is string => Boolean(path?.trim()))
      .filter((path, index, list) => list.indexOf(path) === index);

    const activeFile = this.currentContext.file?.trim();
    let bestDependents = evidence.dependencyGraph?.directDependents ?? [];
    let bestEntry = evidence.dependencyGraph?.entryFile;
    let source = evidence.dependencyGraph?.source;
    let activeFileDependents: string[] | undefined;
    let activeFileSource: string | undefined;

    const dependentResults = await Promise.all(
      candidatePaths.slice(0, 6).map(async (path) => {
        try {
          const result = await this.options.indexBackend.dependents(repoId, path);
          return { path, result };
        } catch {
          return undefined;
        }
      })
    );
    for (const entry of dependentResults) {
      if (!entry) {
        continue;
      }
      const { path, result } = entry;
      if (activeFile && path === activeFile) {
        activeFileDependents = result.dependents;
        activeFileSource = result.source;
      }
      if (result.dependents.length > bestDependents.length) {
        bestDependents = result.dependents;
        bestEntry = path;
        source = result.source;
      }
    }

    if (activeFile && activeFileDependents) {
      bestDependents = activeFileDependents;
      bestEntry = activeFile;
      source = activeFileSource ?? source;
    }

    if (bestDependents.length === 0 && !evidence.dependencyGraph?.edgeCount) {
      return evidence;
    }

    return {
      ...evidence,
      dependencyGraph: {
        ...evidence.dependencyGraph,
        entryFile: bestEntry ?? evidence.dependencyGraph?.entryFile,
        directDependents: bestDependents,
        source: source ?? evidence.dependencyGraph?.source,
        indexedFileCount: evidence.manifest?.fileCount ?? evidence.dependencyGraph?.indexedFileCount
      }
    };
  }

  private activeEvidenceCodeHost(): import("./types").CodeHostProviderPreference {
    return (
      this.currentContext.provider ??
      this.preferences.defaultCodeHost ??
      "github"
    );
  }

  private async postRepoSummaryEvidenceFromBundle(): Promise<void> {
    let evidence = repoSummaryFromBundle(this.lastContextBundle);
    if (!evidence) {
      return;
    }
    evidence = await this.enrichRepoSummaryGraphEvidence(evidence);
    const artifactId = this.beginEvidenceArtifact();
    const payload = {
      artifactId,
      evidence,
      owner: this.currentContext.owner ?? this.preferences.owner ?? "unknown",
      repo: this.currentContext.repo ?? this.preferences.repo ?? "unknown",
      branch: this.currentContext.branch ?? this.preferences.branch,
      codeHost: this.activeEvidenceCodeHost()
    };
    this.recordEvidenceArtifact("repo-summary", artifactId, payload);
    this.post({ type: "repo-summary:card", payload });
  }

  private postBlastRadiusEvidenceFromBundle(): void {
    const file = this.currentContext.file?.trim();
    if (!file) {
      return;
    }
    const evidence = blastRadiusFromBundle(this.lastContextBundle) ?? { file };
    const artifactId = this.beginEvidenceArtifact();
    const payload = {
      artifactId,
      evidence,
      file,
      codeHost: this.activeEvidenceCodeHost()
    };
    this.recordEvidenceArtifact("blast-radius", artifactId, payload);
    this.post({ type: "blast-radius:card", payload });
  }

  private postKnowledgeGapsEvidenceFromBundle(): void {
    const evidence = knowledgeGapsFromBundle(this.lastContextBundle);
    const confluence = confluenceSearchFromBundle(this.lastContextBundle);
    const jira = jiraSearchFromBundle(this.lastContextBundle);
    const slack = slackSearchFromBundle(this.lastContextBundle);
    const notion = notionSearchFromBundle(this.lastContextBundle);
    const googleDocs = googleDocsSearchFromBundle(this.lastContextBundle);
    const teams = teamsSearchFromBundle(this.lastContextBundle);
    if (!evidence && !confluence && !jira && !slack && !notion && !googleDocs && !teams) {
      return;
    }
    const artifactId = this.beginEvidenceArtifact();
    const payload = {
      artifactId,
      evidence: evidence ?? { file: this.currentContext.file },
      confluence,
      jira,
      slack,
      notion,
      googleDocs,
      teams,
      file: this.currentContext.file,
      codeHost: this.activeEvidenceCodeHost()
    };
    this.recordEvidenceArtifact("knowledge-gaps", artifactId, payload);
    this.post({ type: "knowledge-gaps:card", payload });
  }

  private postIntegrationEvidenceFromBundle(provider: IntegrationChatProvider): void {
    const evidence = integrationSearchFromBundle(this.lastContextBundle, provider);
    if (!evidence) {
      return;
    }
    // Don't post empty Sources chrome for "not configured" stubs (card body returns null).
    if (!isIntegrationConnectedForSources(evidence)) {
      return;
    }
    const artifactId = this.beginEvidenceArtifact();
    const payload = { artifactId, provider, evidence };
    this.recordEvidenceArtifact("integration", artifactId, payload);
    this.post({ type: "integration:card", payload });
  }

  private postOwnershipCardFromBundle(): void {
    const report = this.ownershipReportFromBundle();
    if (!report) {
      return;
    }
    if (!report.provider) {
      report.provider = this.activeEvidenceCodeHost();
    }
    const artifactId = this.beginEvidenceArtifact();
    const payload = {
      artifactId,
      report,
      slackSearch: slackSearchFromBundle(this.lastContextBundle),
      codeHost: report.provider ?? this.activeEvidenceCodeHost()
    };
    this.recordEvidenceArtifact("ownership", artifactId, payload);
    this.post({ type: "ownership:card", payload });
  }

  private ownershipReportFromBundle(): OwnershipReport | undefined {
    const entry = this.lastContextBundle.find((result) => result.type === "ownership");
    return (entry?.data as { report?: OwnershipReport } | undefined)?.report;
  }

  private repoSummaryFromBundle(): Record<string, unknown> | undefined {
    const entry = this.lastContextBundle.find((result) => result.type === "file_metadata");
    const data = entry?.data;
    if (!data || typeof data !== "object") {
      return undefined;
    }
    const record = data as Record<string, unknown>;
    if (record.entryFiles || record.treeOverview || record.manifest) {
      return record;
    }
    return undefined;
  }

  private async postDecisionTimelineFromBundle(): Promise<void> {
    const timeline = this.enrichedDecisionTimelineFromBundle();
    if (!timeline) {
      const entry = this.lastContextBundle.find((result) => result.type === "decision_history");
      this.postIntentFeedback({
        status: "error",
        intent: UserIntent.QUICK_ACTION_CLICKED,
        actionId: "trace-decision",
        title: "Could not trace this code",
        message: entry?.error ?? entry?.message ?? "Open a project file in this repo and try again."
      });
      return;
    }

    await this.enrichTimelineSourcePreviewsBestEffort(timeline);

    const artifactId = this.beginEvidenceArtifact();
    if (!timeline.provider) {
      timeline.provider = this.activeEvidenceCodeHost();
    }
    const payload = { artifactId, timeline, codeHost: timeline.provider };
    this.recordEvidenceArtifact("decision", artifactId, payload);
    this.post({ type: "decision:timeline", payload });
  }

  /**
   * AI short overviews for Sources expands (fail-open, soft-budget capped).
   * UI never dumps full bodies even when this skips.
   */
  private async enrichTimelineSourcePreviewsBestEffort(timeline: DecisionTimeline): Promise<void> {
    const remainingMs = remainingContextGatherBudgetMs(this.chatTurnStartedAt || Date.now());
    if (remainingMs < 400) {
      return;
    }
    const timeoutMs = Math.min(EVIDENCE_PREVIEW_TIMEOUT_MS, Math.max(400, remainingMs));
    const complete: EvidencePreviewCompleteFn = async (params) => {
      let full = "";
      await this.options.api.streamChat(
        {
          message: params.message,
          context: {},
          history: [],
          model: params.model,
          provider: params.provider,
          useCase: "evidence_preview",
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          enableThinking: false
        },
        (chunk) => {
          full += chunk;
        },
        this.preferences.apiBaseUrl,
        params.signal
      );
      return full;
    };
    try {
      await enrichDecisionTimelineSourcePreviews(timeline, complete, { timeoutMs });
    } catch {
      // Fail open — deterministic previews in the webview.
    }
  }

  private lineRangeFromContext(context: RepoContext): { start: number; end: number } | undefined {
    if (!context.selectedLines || context.selectedLines.length !== 2) {
      return undefined;
    }
    return { start: context.selectedLines[0], end: context.selectedLines[1] };
  }

  private selectedCodeSnippet(maxLength = 4000): string | undefined {
    const editor =
      pickLocalEditorForContext(this.currentContext.file) ??
      pickEditorForContext(this.currentContext.file) ??
      vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      return editor.document.getText(editor.selection).slice(0, maxLength);
    }
    const lines = this.currentContext.selectedLines;
    if (!lines || lines.length !== 2) {
      return undefined;
    }
    const wanted = this.currentContext.file?.trim();
    const fromPending = this.pendingChatLocalFiles?.files.find((file) =>
      wanted ? pathsReferToSameFile(file.path, wanted) : true
    );
    if (fromPending?.content) {
      const sliced = selectionTextFromContent(fromPending.content, lines, maxLength);
      return sliced || undefined;
    }
    return undefined;
  }

  private decisionTimelineFromBundle(): DecisionTimeline | undefined {
    const entry = this.lastContextBundle.find((result) => result.type === "decision_history");
    return (entry?.data as { timeline?: DecisionTimeline } | undefined)?.timeline;
  }

  private enrichedDecisionTimelineFromBundle(): DecisionTimeline | undefined {
    const timeline = this.decisionTimelineFromBundle();
    if (!timeline) {
      return undefined;
    }
    const activeFile = this.currentContext.file?.trim();
    if (
      activeFile &&
      timeline.file?.trim() &&
      !pathsReferToSameFile(activeFile, timeline.file)
    ) {
      // Stale decision_history for a different path must not drive synthesis.
      return undefined;
    }
    const lineRange = timeline.lineRange ?? this.lineRangeFromContext(this.currentContext);
    const codeSnippet = timeline.codeSnippet ?? this.selectedCodeSnippet();
    const withContext = {
      ...timeline,
      lineRange,
      codeSnippet
    };
    const seeds = buildTraceDecisionSearchSeeds(
      withContext,
      this.currentContext.file ?? timeline.file,
      codeSnippet
    );
    return mergeTraceDecisionIntegrationEvidence(withContext, this.lastContextBundle, seeds);
  }

  private async continueChatAfterContext(
    content: string,
    quickAction?: string,
    attachments?: ChatImageAttachment[],
    options?: {
      sourceHint?: string;
      integrationProvider?: IntegrationChatProvider;
      fetchIntegrations?: IntegrationChatProvider[];
      intentPlan?: ChatIntentPlan;
      mentions?: ChatFileMention[];
      composerMode?: ComposerMode;
      turn?: ChatTurn;
      /** Imperative task sentence for synthesis prompts; falls back to full content. */
      taskContent?: string;
      /** Specific ask after a slash command / custom prompt template. */
      userFocus?: string;
    }
  ): Promise<void> {
    const turn =
      options?.turn ??
      this.threadRuns.begin({
        threadId: this.activeThreadId(),
        context: { ...this.currentContext },
        history: [...this.chatHistory],
        artifacts: [...this.threadArtifacts],
        sessionCostUsd: this.sessionCostUsd,
        modelMessage: content,
        quickAction,
        pendingMentions: options?.mentions,
        codeEditIntent: options?.composerMode === "edit"
      });
    const turnContext = turn.context;
    // Sticky [blast-radius] in history must not override tools-only / integration turns.
    const suppressInheritedQuickAction =
      Boolean(options?.fetchIntegrations?.length) ||
      Boolean(options?.integrationProvider) ||
      options?.intentPlan?.mode === "plain" ||
      options?.intentPlan?.mode === "tools-only";
    const effectiveQuickAction = suppressInheritedQuickAction
      ? (quickAction as import("../webview/types").QuickActionId | undefined)
      : resolveEffectiveQuickAction(quickAction, turn.history);
    // No artificial minimum — first tokens stream as soon as the LLM produces them,
    // for plain chat, /edit, and quick actions alike.
    const minResponseVisibleMs = 0;
    const sourceHint = options?.sourceHint;
    const integrationProvider = options?.integrationProvider;
    const chatUseCase = resolveChatUseCase(
      effectiveQuickAction,
      integrationProvider,
      options?.composerMode
    );
    const runtimeModel = resolveRuntimeModelForUseCase(chatUseCase, {
      devMode: this.preferences.devMode,
      llmProvider: this.preferences.llmProvider,
      model: this.preferences.model
    });
    const cacheKey = JSON.stringify({
      content,
      attachments,
      sourceHint,
      integrationProvider,
      context: turnContext,
      model: runtimeModel.model,
      provider: runtimeModel.provider,
      useCase: chatUseCase
    });
    // Never replay cached chat answers — stale cache returned hallucinations when file attach failed.
    const skipResponseCache = true;
    const signal = turn.streamAbort.signal;
    const isCancelled = () => !this.threadRuns.isStreamActive(turn);

    if (this.preferences.useCachedResponses && !skipResponseCache) {
      const cached = this.readCache(cacheKey);
      if (cached) {
        await delayUntilMinResponseVisible(turn.startedAt, Date.now(), minResponseVisibleMs);
        if (isCancelled()) {
          return;
        }
        this.clearIntentFeedback(turn.threadId);
        this.finishTurnAssistantMessage(turn, cached as ChatMessage);
        return;
      }
    }

    let full = "";

    if (!quickAction) {
      const synthesisMessages = this.withSelectionFocusActivity(
        appendThinkingProcessingTerms(
          [],
          `synthesis-${turn.streamGeneration}-${Date.now()}`,
          8
        ),
        turnContext
      );
      this.postIntentFeedbackForThread(turn.threadId, {
        status: "loading",
        intent: UserIntent.MANUAL_CHAT_SUBMIT,
        title: "Preparing answer",
        message: synthesisMessages[0],
        activityMessages: synthesisMessages
      });
    } else {
      const synthesisMessages = this.withSelectionFocusActivity(
        appendThinkingProcessingTerms(
          [],
          `synthesis-${quickAction}-${turn.streamGeneration}-${Date.now()}`,
          8
        ),
        turnContext
      );
      this.postIntentFeedbackForThread(turn.threadId, {
        status: "loading",
        intent: UserIntent.QUICK_ACTION_CLICKED,
        actionId: quickAction,
        title: "Preparing answer",
        message: synthesisMessages[0],
        activityMessages: synthesisMessages
      });
    }

    try {
      const mentionRefs = this.quickActionMentionRefs(options?.mentions);
      const activeRepoId = buildRepoId(this.preferences, turnContext);
      const allMentionsOutOfScope = allMentionsOutOfScopeForActiveRepo(mentionRefs, activeRepoId);

      const skipLocalAttach = shouldSkipOpenFileAttach({
        quickAction: effectiveQuickAction,
        hasIntegrationProvider: Boolean(integrationProvider),
        allMentionsOutOfScope,
        context: turnContext
      });
      const localPayload = skipLocalAttach
        ? undefined
        : await abortablePromise(this.resolveChatLocalFiles(), signal);
      if (
        options?.composerMode === "edit" &&
        !allMentionsOutOfScope &&
        !(options.mentions?.length) &&
        !localPayload?.files.length
      ) {
        this.postForThread(turn.threadId, {
          type: "chat:error",
          payload: { message: EDIT_UNREADABLE_FILE_ERROR, threadId: turn.threadId }
        });
        this.threadRuns.markError(turn);
        this.pushThreadsList();
        this.clearIntentFeedback(turn.threadId);
        return;
      }
      if (localPayload?.files.length) {
        this.withTurnSessionMirrors(turn, () => this.injectLocalFilesIntoBundle(localPayload));
      }

      let contextBundle: ContextFetchResult[] = [...turn.contextBundle];
      if (localPayload?.files.length && !contextBundle.some((entry) => contextResultHasLocalFiles(entry))) {
        contextBundle = [
          {
            requestId: `local-${Date.now()}`,
            type: "chat_context",
            data: attachLocalFilesToData({}, localPayload),
            fetchedAt: new Date()
          },
          ...contextBundle
        ];
        turn.contextBundle = contextBundle;
      }

      const { decisionTimeline, ownershipReport } = this.withTurnSessionMirrors(turn, () => ({
        decisionTimeline: this.enrichedDecisionTimelineFromBundle(),
        ownershipReport: this.ownershipReportFromBundle()
      }));
      if (effectiveQuickAction === "trace-decision" && decisionTimeline) {
        turn.lastTraceTimeline = decisionTimeline;
        if (this.isViewingThread(turn.threadId)) {
          this.lastTraceDecisionTimeline = decisionTimeline;
        }
      }
      const repoSummary = repoSummaryFromBundle(contextBundle);
      const blastRadiusEvidence = blastRadiusFromBundle(contextBundle);
      const knowledgeGapsEvidence = knowledgeGapsFromBundle(contextBundle);
      const confluenceEvidence = confluenceSearchFromBundle(contextBundle);
      const jiraEvidence = jiraSearchFromBundle(contextBundle);
      const slackEvidence = slackSearchFromBundle(contextBundle);
      const notionEvidence = notionSearchFromBundle(contextBundle);
      const googleDocsEvidence = googleDocsSearchFromBundle(contextBundle);
      const teamsEvidence = teamsSearchFromBundle(contextBundle);
      const integrationEvidence = integrationProvider
        ? integrationSearchFromBundle(contextBundle, integrationProvider)
        : undefined;

      if (effectiveQuickAction === "understand-repo") {
        const summaryRecord = repoSummary as Record<string, unknown> | undefined;
        if (!hasRepoSummaryEvidence(summaryRecord)) {
          const responseContent = understandRepoEmptyEvidenceMessage({
            owner: turnContext.owner,
            repo: turnContext.repo,
            branch: turnContext.branch
          });
          await delayUntilMinResponseVisible(turn.startedAt);
          if (isCancelled()) {
            return;
          }
          this.clearIntentFeedback(turn.threadId);
          const warning =
            "Coop could not attach repository evidence for this turn — no architecture summary was generated.";
          turn.context = { ...turn.context, contextWarning: warning };
          if (this.isViewingThread(turn.threadId)) {
            this.currentContext = { ...this.currentContext, contextWarning: warning };
            this.postContext();
          }
          const finalMessage: ChatMessage = {
            role: "assistant",
            content: responseContent,
            timestamp: Date.now()
          };
          this.finishTurnAssistantMessage(turn, finalMessage);
          return;
        }
        if (!hasUnderstandRepoEntryBodies(summaryRecord)) {
          const tree = summaryRecord?.treeOverview as
            | { topLevelDirs?: string[]; topLevelFiles?: string[] }
            | undefined;
          const inventory = summaryRecord?.repoInventory as { fileCount?: number } | undefined;
          const responseContent = understandRepoMissingEntryBodiesMessage({
            owner: turnContext.owner,
            repo: turnContext.repo,
            branch: turnContext.branch,
            hasInventory: typeof inventory?.fileCount === "number" && inventory.fileCount > 0,
            hasTree: Boolean(
              tree &&
                ((tree.topLevelDirs?.length ?? 0) > 0 || (tree.topLevelFiles?.length ?? 0) > 0)
            )
          });
          await delayUntilMinResponseVisible(turn.startedAt);
          if (isCancelled()) {
            return;
          }
          this.clearIntentFeedback(turn.threadId);
          const warning =
            "Coop attached inventory/tree but no file bodies — no architecture summary was generated.";
          turn.context = { ...turn.context, contextWarning: warning };
          if (this.isViewingThread(turn.threadId)) {
            this.currentContext = { ...this.currentContext, contextWarning: warning };
            this.postContext();
          }
          const finalMessage: ChatMessage = {
            role: "assistant",
            content: responseContent,
            timestamp: Date.now()
          };
          this.finishTurnAssistantMessage(turn, finalMessage);
          return;
        }
      }

      if (
        !effectiveQuickAction &&
        !integrationProvider &&
        allMentionsOutOfScope &&
        plainChatRefersToAttachedFile(content)
      ) {
        const outOfScopePaths = resolveOutOfScopeMentionLabels("integration", mentionRefs, {
          activeRepoId,
          owner: turnContext.owner ?? this.preferences.owner,
          repo: turnContext.repo ?? this.preferences.repo,
          contextBundle
        });
        const targetLabel =
          turnContext.owner && turnContext.repo
            ? `${turnContext.owner}/${turnContext.repo}`
            : "this repository";
        const responseContent = buildOutOfScopeMentionOnlyResponse({ outOfScopePaths, targetLabel });
        await delayUntilMinResponseVisible(turn.startedAt);
        if (isCancelled()) {
          return;
        }
        this.clearIntentFeedback(turn.threadId);
        const finalMessage: ChatMessage = {
          role: "assistant",
          content: responseContent,
          timestamp: Date.now()
        };
        this.finishTurnAssistantMessage(turn, finalMessage);
        return;
      }

    const lastUserBubble = [...turn.history].reverse().find((entry) => entry.role === "user")?.content;
    // Synthesis builders receive the compact task sentence; the no-synthesis fallback
    // below keeps the full `content` so DIRECTIVE/context/confidence lines still reach the model.
    const taskContent = options?.taskContent ?? content;
    const userFocus = options?.userFocus?.trim() || undefined;

    // /edit must emit File:+patch — never A8/A10/A11 Summary / status narratives.
    const bypassAdvisoryGrounding = shouldBypassAdvisoryGroundingForEdit(options?.composerMode);

    // A11: jobs + email templates / reminders — follow job→handler→packages/email paths.
    // Distinct from A10 existing-capability (add-feature tickets without email/template signals).
    let emailTemplateMessage: string | undefined;
    if (
      !bypassAdvisoryGrounding &&
      !effectiveQuickAction &&
      !integrationProvider &&
      isEmailTemplateTicketAsk(taskContent)
    ) {
      emailTemplateMessage = await this.buildEmailTemplateChatPrompt({
        ask: taskContent,
        turn,
        turnContext,
        localFiles: localPayload?.files,
        signal
      });
      contextBundle = [...turn.contextBundle];
    }

    // A10: ticket-style “add feature X” with starter file open — detect existing symbols first.
    // Skip when A11 already claimed the turn. Soft gather: open-file only (no extra search).
    let existingCapabilityMessage: string | undefined;
    let existingCapabilityEvidence: ExistingCapabilityEvidence | undefined;
    if (
      !bypassAdvisoryGrounding &&
      !emailTemplateMessage &&
      !effectiveQuickAction &&
      !integrationProvider &&
      isFeatureAddAsk(taskContent)
    ) {
      const capabilityPrompt = this.buildExistingCapabilityChatPrompt({
        ask: taskContent,
        turn,
        turnContext,
        localFiles: localPayload?.files
      });
      existingCapabilityMessage = capabilityPrompt?.message;
      existingCapabilityEvidence = capabilityPrompt?.evidence;
    }

    // A8: stuck-status / status-transition asks — shape write-path evidence from the open file
    // (and follow job triggers within the soft gather budget) before generic/incident prompts.
    // Skip when A11/A10 already claimed the turn.
    let statusTransitionMessage: string | undefined;
    let statusTransitionEvidence: StatusTransitionEvidence | undefined;
    if (
      !bypassAdvisoryGrounding &&
      !emailTemplateMessage &&
      !existingCapabilityMessage &&
      !effectiveQuickAction &&
      !integrationProvider &&
      isStatusTransitionAsk(taskContent)
    ) {
      const statusPrompt = await this.buildStatusTransitionChatPrompt({
        ask: taskContent,
        turn,
        turnContext,
        localFiles: localPayload?.files,
        signal
      });
      statusTransitionMessage = statusPrompt?.message;
      statusTransitionEvidence = statusPrompt?.evidence;
      // Job-follow may have attached seal/handler snippets onto the turn bundle.
      contextBundle = [...turn.contextBundle];
    }

    let llmMessage =
        emailTemplateMessage
          ? emailTemplateMessage
          : existingCapabilityMessage
          ? existingCapabilityMessage
          : statusTransitionMessage
          ? statusTransitionMessage
          : effectiveQuickAction === "trace-decision" && decisionTimeline
          ? buildDecisionSynthesisUserPrompt({
              timeline: decisionTimeline,
              file: turnContext.file ?? decisionTimeline.file,
              owner: turnContext.owner ?? this.preferences.owner,
              repo: turnContext.repo ?? this.preferences.repo,
              lineRange: decisionTimeline.lineRange,
              codeSnippet: decisionTimeline.codeSnippet,
              userQuestion: taskContent,
              userFocus,
              userBubble: lastUserBubble,
              mentionedFiles: mentionRefs,
              activeRepoId,
              isFollowUp: !quickAction && effectiveQuickAction === "trace-decision"
            })
          : effectiveQuickAction === "find-owner" && ownershipReport
            ? buildOwnershipSynthesisUserPrompt({
                report: ownershipReport,
                file: turnContext.file ?? ownershipReport.path,
                slackSearch: slackEvidence,
                userQuestion: taskContent,
                userFocus,
                mentionedFiles: mentionRefs,
                activeRepoId
              })
            : effectiveQuickAction === "understand-repo" && repoSummary
              ? buildRepoSummarySynthesisUserPrompt({
                  owner: turnContext.owner ?? this.preferences.owner ?? "unknown",
                  repo: turnContext.repo ?? this.preferences.repo ?? "unknown",
                  branch: turnContext.branch ?? this.preferences.branch,
                  activeFile: turnContext.file,
                  summary: repoSummary,
                  userQuestion: taskContent,
                  userFocus,
                  mentionedFiles: mentionRefs,
                  activeRepoId
                })
              : effectiveQuickAction === "blast-radius" && blastRadiusEvidence
                ? buildBlastRadiusSynthesisUserPrompt({
                    evidence: blastRadiusEvidence,
                    file: turnContext.file ?? blastRadiusEvidence.file ?? "unknown",
                    owner: turnContext.owner ?? this.preferences.owner,
                    repo: turnContext.repo ?? this.preferences.repo,
                    userQuestion: taskContent,
                    userFocus,
                    mentionedFiles: mentionRefs,
                    activeRepoId
                  })
                : effectiveQuickAction === "knowledge-gaps"
                  ? buildKnowledgeGapsSynthesisUserPrompt({
                      evidence: knowledgeGapsEvidence ?? { file: turnContext.file },
                      confluence: confluenceEvidence,
                      jira: jiraEvidence,
                      slack: slackEvidence,
                      notion: notionEvidence,
                      googleDocs: googleDocsEvidence,
                      teams: teamsEvidence,
                      file: turnContext.file,
                      owner: turnContext.owner ?? this.preferences.owner,
                      repo: turnContext.repo ?? this.preferences.repo,
                      userQuestion: taskContent,
                      userFocus,
                      mentionedFiles: mentionRefs,
                      activeRepoId
                    })
                  : integrationProvider && integrationEvidence
                    ? buildIntegrationSynthesisUserPrompt({
                        provider: integrationProvider,
                        evidence: integrationEvidence,
                        owner: turnContext.owner,
                        repo: turnContext.repo,
                        file: turnContext.file,
                        userQuestion: taskContent,
                        userFocus,
                        mentionedFiles: mentionRefs,
                        activeRepoId
                      })
                    : !effectiveQuickAction &&
                        !integrationProvider &&
                        (options?.fetchIntegrations?.length ?? 0) >= 1
                      ? buildMultiToolPlainChatUserPrompt({
                          userQuestion: taskContent,
                          owner: turnContext.owner ?? this.preferences.owner,
                          repo: turnContext.repo ?? this.preferences.repo,
                          file: turnContext.file,
                          tools: options!.fetchIntegrations!,
                          integrations: {
                            jira: jiraEvidence,
                            slack: slackEvidence,
                            teams: teamsEvidence,
                            confluence: confluenceEvidence,
                            notion: notionEvidence,
                            "google-docs": googleDocsEvidence
                          },
                          connected: {
                            jira: this.isIntegrationConnected("jira"),
                            slack: this.isIntegrationConnected("slack"),
                            teams: this.isIntegrationConnected("teams"),
                            confluence: this.isIntegrationConnected("confluence"),
                            notion: this.isIntegrationConnected("notion"),
                            "google-docs": this.isIntegrationConnected("google-docs")
                          },
                          statusLine: options?.intentPlan
                            ? buildIntentPlanStatusLine(options.intentPlan)
                            : undefined
                        })
                    : !effectiveQuickAction &&
                        !integrationProvider &&
                        isIncidentShapedQuery(taskContent)
                      ? buildIncidentReconstructionUserPrompt({
                          userQuestion: taskContent,
                          owner: turnContext.owner ?? this.preferences.owner,
                          repo: turnContext.repo ?? this.preferences.repo,
                          file: turnContext.file,
                          integrations: incidentIntegrationsFromBundle(contextBundle, {
                            jiraConnected: this.isIntegrationConnected("jira"),
                            slackConnected: this.isIntegrationConnected("slack")
                          })
                        })
                    : sourceHint
                      ? `${sourceHint}\n\n${content}`
                      : content;

      const trustPreamble =
        options?.intentPlan && !effectiveQuickAction
          ? buildIntentPlanTrustPreamble(options.intentPlan)
          : undefined;
      if (trustPreamble) {
        // Prepend plan disclosure for the model (Sources / activity already show status).
        llmMessage = `${trustPreamble}\n\n${llmMessage}`;
      }

      const useContextBundle =
        Boolean(effectiveQuickAction) ||
        Boolean(integrationProvider) ||
        contextBundleHasIntegrationSearch(contextBundle) ||
        contextBundleHasRepoFactEvidence(contextBundle) ||
        contextBundle.some(
          (entry) =>
            entry.type === "file_metadata" ||
            entry.type === "ownership" ||
            entry.type === "dependencies" ||
            entry.type === "decision_history" ||
            entry.type === "knowledge_gaps"
        );

      const scopeAction: MentionScopeQuickAction | undefined =
        effectiveQuickAction ??
        (integrationProvider
          ? "integration"
          : mentionsHaveOutOfScopeForActiveRepo(mentionRefs, activeRepoId)
            ? "integration"
            : undefined);
      let mentionsToResolve = options?.mentions ?? [];
      if (scopeAction && mentionRefs.length) {
        const inScopeKeys = new Set(
          partitionMentionsForQuickAction(scopeAction, mentionRefs, {
            activeRepoId,
            owner: turnContext.owner ?? this.preferences.owner,
            repo: turnContext.repo ?? this.preferences.repo,
            repoSummary: effectiveQuickAction === "understand-repo" ? repoSummary : undefined
          }).inRepo.map((mention) => mentionAttachmentKey(mention))
        );
        mentionsToResolve = filterMentionsByInScopeKeys(mentionsToResolve, inScopeKeys);
      }

      const mentionFiles =
        mentionsToResolve.length > 0
          ? await abortablePromise(this.resolveMentionFiles(mentionsToResolve), signal)
          : [];
      let apiMessage =
        mentionFiles.length > 0
          ? formatChatMessageWithMentionFiles({
              message: llmMessage,
              files: mentionFiles,
              owner: turnContext.owner,
              repo: turnContext.repo,
              branch: turnContext.branch
            })
            : useContextBundle || !localPayload?.files.length
            ? buildUserMessageWithContext(llmMessage, {
                owner: turnContext.owner,
                repo: turnContext.repo,
                branch: turnContext.branch,
                file:
                  effectiveQuickAction === "understand-repo" || integrationProvider
                    ? undefined
                    : allMentionsOutOfScope
                      ? undefined
                      : turnContext.file,
                selectedLines: turnContext.selectedLines,
                selectionText: this.selectedCodeSnippet(4000),
                languageId: turnContext.languageId,
                contextBundle
              })
            : formatChatMessageWithLocalFiles({
                message: llmMessage,
                files: localPayload.files,
                file: turnContext.file,
                selectedLines: turnContext.selectedLines,
                selectionText: this.selectedCodeSnippet(4000),
                owner: turnContext.owner,
                repo: turnContext.repo,
                branch: turnContext.branch
              });
      const projectInstructionsBlock =
        effectiveQuickAction === "understand-repo" ? undefined : this.buildProjectInstructionsBlock();
      if (projectInstructionsBlock) {
        apiMessage = `${projectInstructionsBlock}\n\n${apiMessage}`;
      }

      const entryFileCount = contextBundle
        .flatMap((entry) => {
          const data = entry.data as { entryFiles?: unknown[] } | undefined;
          return data?.entryFiles ?? [];
        })
        .length;
      const jiraSearch = contextBundle
        .map((entry) => (entry.data as { jiraSearch?: { issues?: unknown[]; error?: string } } | undefined)?.jiraSearch)
        .find(Boolean);
      const confluenceSearch = contextBundle
        .map(
          (entry) =>
            (entry.data as { confluenceSearch?: { pages?: unknown[]; error?: string } } | undefined)?.confluenceSearch
        )
        .find(Boolean);
      this.logContextDebug(
        effectiveQuickAction === "understand-repo"
          ? entryFileCount > 0
            ? `Understand Repo: ${entryFileCount} entry file(s) in context bundle`
            : `Understand Repo: no entry files in bundle (check GitHub connection)`
          : integrationProvider === "jira" || jiraSearch
            ? jiraSearch?.error
              ? `Jira search failed: ${jiraSearch.error}`
              : `Jira: ${jiraSearch?.issues?.length ?? 0} issue(s) in context bundle`
            : integrationProvider === "confluence" || confluenceSearch || effectiveQuickAction === "knowledge-gaps"
              ? confluenceSearch?.error
                ? `Confluence search failed: ${confluenceSearch.error}`
                : `Confluence: ${confluenceSearch?.pages?.length ?? 0} page(s) in context bundle`
              : localPayload?.files.length
                ? `Attached ${localPayload.files[0]?.content.length ?? 0} chars from ${localPayload.activeFile}`
                : `No file content attached (file=${turnContext.file ?? "none"}, openTabs=${collectOpenEditorPaths().join(", ") || "none"})`
      );

      if (
        shouldWarnOpenFileAttachFailure({
          quickAction: effectiveQuickAction,
          hasIntegrationProvider: Boolean(integrationProvider),
          hasAttachedFiles: Boolean(localPayload?.files.length),
          openEditorTabCount: collectOpenEditorPaths().length,
          intendedFile: turnContext.file
        })
      ) {
        const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).join("; ");
        const tabs = collectOpenEditorFileRefs()
          .map((ref) => `${ref.relativePath}@${ref.absolutePath}`)
          .join("; ");
        this.logContextDebug(`Attach failed. workspaceRoots=${roots || "none"} tabs=${tabs || "none"}`);
        const remoteTab = turnContext.fileSource === "remote";
        const warning = remoteTab
          ? "CoopAI could not read the open remote file tab. Keep the file open in the editor and try again."
          : vscode.workspace.workspaceFolders?.length
            ? "CoopAI could not read open file content. Keep the file tab open and reload the window."
            : "CoopAI could not read open file content. Open the repo folder (File → Open Folder) or open the workspace file .vscode/extension-dev.code-workspace, then reload.";
        turn.context = { ...turn.context, contextWarning: warning };
        if (this.isViewingThread(turn.threadId)) {
          this.currentContext = { ...this.currentContext, contextWarning: warning };
          this.postContext();
        }
      } else if (
        (effectiveQuickAction === "understand-repo" && entryFileCount > 0 && turnContext.contextWarning) ||
        (turnContext.contextWarning &&
          /could not read (the )?open (remote )?file/i.test(turnContext.contextWarning))
      ) {
        turn.context = { ...turn.context, contextWarning: undefined };
        if (this.isViewingThread(turn.threadId)) {
          this.currentContext = { ...this.currentContext, contextWarning: undefined };
          this.postContext();
        }
      }

      const priorHistory = turn.history.slice(0, -1);
      let clearedIntentForOutput = false;
      const outputGate = createChatOutputGate({
        startedAt: turn.startedAt,
        minVisibleMs: minResponseVisibleMs,
        isCancelled,
        onChunk: (chunk) => {
          // First token = answer started — clear any leftover disposer and loading state.
          if (!clearedIntentForOutput) {
            clearedIntentForOutput = true;
            clearResponseDeadlineForSynthesis(turn.clearResponseDeadline);
            turn.clearResponseDeadline = () => undefined;
            this.clearIntentFeedback(turn.threadId);
          }
          full += chunk;
          this.threadRuns.appendPartial(turn, chunk);
          this.postForThread(turn.threadId, {
            type: "chat:delta",
            payload: { chunk, threadId: turn.threadId }
          });
        }
      });

      const quotaBlocked = await abortablePromise(this.blockIfFreeQuotaExhausted(), signal);
      if (quotaBlocked) {
        return;
      }

      // Synthesis handoff: soft gather guideline is done — start the model and finish the answer.
      clearResponseDeadlineForSynthesis(turn.clearResponseDeadline);
      turn.clearResponseDeadline = () => undefined;

      const result = await this.options.api.streamChat(
        {
          message: apiMessage,
          context: {
            owner: turnContext.owner,
            repo: turnContext.repo,
            branch: turnContext.branch,
            file: effectiveQuickAction === "understand-repo" ? turnContext.file : undefined
          },
          history: priorHistory,
          attachments: attachments?.length ? attachments : undefined,
          mentions: options?.mentions,
          model: runtimeModel.model,
          provider: runtimeModel.provider,
          useCase: chatUseCase,
          temperature: this.preferences.temperature,
          maxTokens: this.preferences.maxTokens,
          enableThinking: true
        },
        (chunk) => {
          outputGate.push(chunk);
        },
        this.preferences.apiBaseUrl,
        signal,
        (thinkingChunk) => {
          // Thinking is live display only — do not fold into answer text or history.
          this.postForThread(turn.threadId, {
            type: "chat:thinking-delta",
            payload: { chunk: thinkingChunk, threadId: turn.threadId }
          });
        }
      );

      await outputGate.waitUntilOpen();

      if (isCancelled()) {
        return;
      }

      await delayUntilMinResponseVisible(turn.startedAt, Date.now(), minResponseVisibleMs);
      if (isCancelled()) {
        return;
      }

      const enrichedContent = enrichChatResponseForAction({
        quickAction: effectiveQuickAction,
        integrationProvider,
        content: full,
        contextBundle,
        activeFile: turnContext.file,
        mentions: mentionRefs,
        activeRepoId,
        owner: turnContext.owner ?? this.preferences.owner,
        repo: turnContext.repo ?? this.preferences.repo,
        userQuestion: lastUserBubble,
        fallbackTimeline: resolveTraceFallbackTimeline(
          turn.lastTraceTimeline ?? this.lastTraceDecisionTimeline,
          turnContext.file
        ),
        isTraceFollowUp: !quickAction && effectiveQuickAction === "trace-decision",
        incidentReconstruction:
          !effectiveQuickAction && !integrationProvider && isIncidentShapedQuery(taskContent)
            ? {
                jiraConnected: this.isIntegrationConnected("jira"),
                slackConnected: this.isIntegrationConnected("slack")
              }
            : undefined,
        existingCapability: existingCapabilityEvidence,
        statusTransition: statusTransitionEvidence
      });
      const finalMessage: ChatMessage = {
        ...result.message,
        content: enrichedContent,
        ...(turn.pendingEvidenceArtifactId
          ? { relatedArtifactId: turn.pendingEvidenceArtifactId }
          : {})
      };
      turn.pendingEvidenceArtifactId = undefined;
      if (this.isViewingThread(turn.threadId)) {
        this.pendingEvidenceArtifactId = undefined;
      }
      this.clearIntentFeedback(turn.threadId);
      if (this.isViewingThread(turn.threadId)) {
        if (options?.composerMode === "edit") {
          // Publish the Patch card before chat:complete so the webview never paints raw fences first.
          await handlePatchComplete(finalMessage.content, {
            messageTimestamp: finalMessage.timestamp,
            publish: (state) => this.postPatchUpdate(state)
          });
        } else if (chatUseCase === "chat") {
          // Plain chat may emit File:/SEARCH-REPLACE when recommending inserts — elevate to Apply.
          await handlePatchComplete(finalMessage.content, {
            messageTimestamp: finalMessage.timestamp,
            publish: (state) => this.postPatchUpdate(state),
            ignoreParseFailure: true
          });
        }
      }
      if (result.usage) {
        turn.sessionCostUsd += result.usage.estimatedCostUsd;
      }
      this.finishTurnAssistantMessage(turn, finalMessage);
      if (localPayload?.files.length) {
        this.writeCache(cacheKey, finalMessage);
      }

      if (result.usage) {
        this.postForThread(turn.threadId, {
          type: "chat:usage",
          payload: {
            ...result.usage,
            sessionCostUsd: turn.sessionCostUsd
          }
        });
        if (this.isViewingThread(turn.threadId)) {
          this.sessionCostUsd = turn.sessionCostUsd;
          this.persistActiveThread();
        } else {
          this.persistTurnThread(turn);
        }
      }

      await this.notifyQuotaExceededIfNeeded();
    } catch (error) {
      if (isCancelled()) {
        return;
      }
      this.threadRuns.markError(turn);
      this.pushThreadsList();
      if (error instanceof ChatQuotaExceededError) {
        this.postForThread(turn.threadId, {
          type: "chat:quota-exceeded",
          payload: {
            resetsAt: error.resetsAt ?? new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
            upgradeUrl: buildQuotaExceededUpgradeUrl(this.preferences.adminPortalUrl),
            timezone: this.preferences.timezone,
            retryAfterMs: error.retryAfterMs
          }
        });
        return;
      }
      const message = formatUserFacingNetworkError(error);
      this.postForThread(turn.threadId, {
        type: "chat:error",
        payload: { message, threadId: turn.threadId }
      });
    } finally {
      if (this.isViewingThread(turn.threadId)) {
        this.pendingChatLocalFiles = undefined;
        this.pendingCodeEditIntent = false;
      }
    }
  }

  private postQuotaExceeded(payload: {
    resetsAt: string;
    upgradeUrl: string;
    retryAfterMs?: number;
  }): void {
    this.post({
      type: "chat:quota-exceeded",
      payload: {
        resetsAt: payload.resetsAt,
        upgradeUrl: payload.upgradeUrl,
        timezone: this.preferences.timezone,
        retryAfterMs: payload.retryAfterMs
      }
    });
  }

  private async blockIfFreeQuotaExhausted(): Promise<boolean> {
    if (this.preferences.plan !== "free") {
      return false;
    }

    let quota = this.preferences.quotaCredits;
    try {
      const me = await this.options.api.fetchMe(this.preferences.apiBaseUrl);
      if (me.plan) {
        this.preferences = { ...this.preferences, plan: me.plan };
      }
      if (me.plan !== "free") {
        return false;
      }
      if (me.quota) {
        quota = me.quota;
        this.preferences = { ...this.preferences, quotaCredits: me.quota };
      }
    } catch {
      // Fall back to cached quota snapshot.
    }

    if (!isFreeQuotaExhausted(quota)) {
      return false;
    }

    this.clearIntentFeedback();
    this.postQuotaExceeded({
      resetsAt: quota?.resetsAt ?? new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      upgradeUrl: buildQuotaExceededUpgradeUrl(this.preferences.adminPortalUrl),
      retryAfterMs: quota?.retryAfterMs
    });
    return true;
  }

  private async notifyQuotaExceededIfNeeded(): Promise<void> {
    if (this.preferences.plan !== "free") {
      return;
    }
    try {
      await this.refreshPreferences();
    } catch {
      // Best-effort — still show notice from stale quota if available.
    }
    const quota = this.preferences.quotaCredits;
    if (!quota || !isFreeQuotaExhausted(quota)) {
      return;
    }
    this.postQuotaExceeded({
      resetsAt: quota.resetsAt ?? "",
      upgradeUrl: buildQuotaExceededUpgradeUrl(this.preferences.adminPortalUrl),
      retryAfterMs: quota.retryAfterMs
    });
  }

  private withTurnSessionMirrors<T>(turn: ChatTurn | undefined, fn: () => T): T {
    if (!turn) {
      return fn();
    }
    const previousBundle = this.lastContextBundle;
    const previousJob = this.lastJobResult;
    const previousEvidenceId = this.pendingEvidenceArtifactId;
    const previousTrace = this.lastTraceDecisionTimeline;
    this.lastContextBundle = turn.contextBundle;
    this.lastJobResult = turn.jobResult;
    this.pendingEvidenceArtifactId = turn.pendingEvidenceArtifactId;
    this.lastTraceDecisionTimeline = turn.lastTraceTimeline;

    const commitAndRestore = () => {
      turn.contextBundle = this.lastContextBundle;
      turn.jobResult = this.lastJobResult;
      turn.pendingEvidenceArtifactId = this.pendingEvidenceArtifactId;
      turn.lastTraceTimeline = this.lastTraceDecisionTimeline;
      if (!this.isViewingThread(turn.threadId)) {
        this.lastContextBundle = previousBundle;
        this.lastJobResult = previousJob;
        this.pendingEvidenceArtifactId = previousEvidenceId;
        this.lastTraceDecisionTimeline = previousTrace;
      }
    };

    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        return Promise.resolve(result).then(
          (value) => {
            commitAndRestore();
            return value;
          },
          (error) => {
            commitAndRestore();
            throw error;
          }
        ) as T;
      }
      commitAndRestore();
      return result;
    } catch (error) {
      commitAndRestore();
      throw error;
    }
  }

  private async runAsyncQuickAction(
    quickAction: string,
    _message: string,
    turn: ChatTurn
  ): Promise<boolean> {
    const jobType = jobTypeForQuickAction(quickAction);
    if (!jobType) {
      return false;
    }

    if (quickAction === "knowledge-gaps") {
      turn.jobResult = undefined;
      if (this.isViewingThread(turn.threadId)) {
        this.lastJobResult = undefined;
      }
    }

    const repoId = buildRepoId(this.preferences, turn.context);
    this.jobClient.setBaseUrl(resolveCoopBaseUrl().baseUrl);
    this.postQuickActionJobActivity(
      quickAction,
      {
        jobId: "pending",
        status: "queued",
        message: activeJobMessageForAction(quickAction),
        progress: 5
      },
      turn.threadId
    );

    try {
      const submit = await this.jobClient.submitJob({
        type: jobType,
        priority: "normal",
        params: {
          repoId,
          file: turn.context.file,
          branch: turn.context.branch ?? this.preferences.branch,
          owner: turn.context.owner ?? this.preferences.owner,
          repo: turn.context.repo ?? this.preferences.repo
        },
        userId: vscode.env.machineId
      });

      turn.jobId = submit.jobId;

      if (submit.cached) {
        this.postQuickActionJobActivity(
          quickAction,
          {
            jobId: submit.jobId,
            status: "running",
            message: preparingAnswerMessageForAction(quickAction),
            progress: 80
          },
          turn.threadId
        );
        const resultPayload = await this.jobClient.getJobResult(submit.jobId);
        const result = (resultPayload.result ?? resultPayload) as Record<string, unknown>;
        turn.jobResult = result;
        if (this.isViewingThread(turn.threadId)) {
          this.lastJobResult = result;
        }
        return true;
      }

      this.postQuickActionJobActivity(
        quickAction,
        {
          jobId: submit.jobId,
          status: "queued",
          message: `Queued (est. ${submit.estimatedWaitTime ?? "a few minutes"})…`,
          progress: 10,
          estimatedWaitTime: submit.estimatedWaitTime
        },
        turn.threadId
      );

      const resultPayload = await this.jobClient.pollUntilComplete(
        submit.jobId,
        (event) => {
          if (!this.threadRuns.isJobActive(turn)) {
            throw new Error("Job aborted");
          }
          const terminal = event.status === "completed" || event.status === "partial";
          this.postQuickActionJobActivity(
            quickAction,
            {
              jobId: event.jobId,
              status: terminal ? "running" : event.status,
              message: terminal ? preparingAnswerMessageForAction(quickAction) : event.message,
              progress: terminal ? Math.max(event.progress, 90) : event.progress,
              estimatedTimeRemaining: event.etaMs ? formatWaitTime(event.etaMs) : undefined
            },
            turn.threadId
          );
        },
        {
          timeoutMs: remainingContextGatherBudgetMs(turn.startedAt),
          signal: turn.streamAbort.signal
        }
      );

      const result = (resultPayload.result ?? resultPayload) as Record<string, unknown>;
      turn.jobResult = result;
      if (this.isViewingThread(turn.threadId)) {
        this.lastJobResult = result;
      }
      return true;
    } catch (error) {
      if (!this.threadRuns.isJobActive(turn)) {
        return false;
      }
      this.postQuickActionJobActivity(
        quickAction,
        {
          jobId: turn.jobId ?? "unknown",
          status: "running",
          message: preparingAnswerMessageForAction(quickAction),
          progress: 75
        },
        turn.threadId
      );
      if (quickAction === "knowledge-gaps") {
        turn.jobResult = undefined;
      }
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
        deliverable: "standalone",
        showViewResults: false,
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

  private postJobProgress(payload: JobProgressPayload, threadId?: string): void {
    this.postForThread(threadId ?? this.activeThreadId(), { type: "job:progress", payload });
  }

  private postQuickActionJobActivity(
    quickAction: string,
    patch: Partial<JobProgressPayload> & Pick<JobProgressPayload, "jobId" | "progress">,
    threadId?: string
  ): void {
    const targetThreadId = threadId ?? this.activeThreadId();
    const turn = this.threadRuns.get(targetThreadId);
    // After Stop the turn is gone — never re-seed loading/thinking UI from a late poll tick.
    if (!turn || turn.status !== "running") {
      return;
    }

    const deliverable = deliverableForQuickAction(quickAction);
    const status = patch.status ?? "running";
    this.postJobProgress(
      {
        title: jobTitleForAction(quickAction),
        deliverable,
        showViewResults: deliverable === "standalone" && this.preferences.devMode,
        ...patch,
        status: deliverable === "chat" ? displayStatusForChatDeliverable(status) : status
      },
      targetThreadId
    );

    // Blast Radius / Knowledge Gaps can wait on a job for a long time. Keep the
    // Copilot-style timeline alive — merge job lines with tool lines (Slack/Jira/…),
    // never replace a rich checklist with a generic seed.
    if (deliverable === "chat") {
      const line = (patch.message || activeJobMessageForAction(quickAction)).trim();
      if (line) {
        const key = `${targetThreadId}:${quickAction}`;
        const prior =
          this.chatDeliverableNarrative.get(key) ??
          this.lastActivityMessagesByThread.get(targetThreadId) ??
          seedChatDeliverableNarrative(quickAction);
        const next = prior.includes(line) ? prior : [...prior, line];
        this.chatDeliverableNarrative.set(key, next);
        this.postIntentFeedbackForThread(targetThreadId, {
          status: "loading",
          actionId: quickAction,
          title: jobTitleForAction(quickAction),
          message: line,
          activityMessages: next
        });
      }
    }
  }

  private async applyBlastRadiusJobResultToBundle(
    quickAction: string | undefined,
    turn?: ChatTurn
  ): Promise<void> {
    this.withTurnSessionMirrors(turn, () => {
      if (quickAction !== "blast-radius" || !this.lastJobResult) {
        return;
      }
      const result = this.lastJobResult as Record<string, unknown>;
      const targetFile = (turn?.context ?? this.currentContext).file?.trim();
      const jobScan = {
        source: "dependency-graph-job",
        edgeCount: Number(result.edgeCount ?? 0),
        lastIndexedAt: String(result.lastIndexedAt ?? ""),
        dependentsSample: Array.isArray(result.dependentsSample) ? result.dependentsSample : []
      };
      const index = this.lastContextBundle.findIndex((entry) => entry.type === "dependencies");
      if (index >= 0) {
        const existing = this.lastContextBundle[index];
        const data =
          typeof existing.data === "object" && existing.data !== null
            ? { ...(existing.data as Record<string, unknown>) }
            : {};
        this.lastContextBundle[index] = {
          ...existing,
          data: {
            ...data,
            ...(targetFile ? { file: targetFile } : {}),
            jobScan,
            // Merge job scan meta — never wipe verified import-parse/scip/zoekt provenance.
            graphMeta: {
              ...(typeof data.graphMeta === "object" && data.graphMeta !== null
                ? (data.graphMeta as Record<string, unknown>)
                : {}),
              edgeCount: jobScan.edgeCount,
              lastIndexedAt: jobScan.lastIndexedAt
            }
          }
        };
        return;
      }
      this.lastContextBundle.push({
        requestId: `blast-radius-${Date.now()}`,
        type: "dependencies",
        data: { ...(targetFile ? { file: targetFile } : {}), jobScan },
        fetchedAt: new Date()
      });
    });

    // Prefer verified import/symbol callers over unfiltered remote job samples.
    await this.reconcileBlastDependentsWithVerifiedSearch(turn);
  }

  /**
   * Always run import/symbol search after the dependency job. Prefer verified
   * hits; never leave unfiltered remote edges as "production callers."
   */
  private async reconcileBlastDependentsWithVerifiedSearch(turn?: ChatTurn): Promise<void> {
    const ctx = turn?.context ?? this.currentContext;
    const targetFile = ctx.file?.trim();
    if (!targetFile) {
      return;
    }

    const repoId = buildRepoId(this.preferences, ctx);
    if (!repoId) {
      return;
    }

    const askText = (turn?.modelMessage ?? "").trim();
    const remainingMs = remainingContextGatherBudgetMs(
      turn?.startedAt ?? this.chatTurnStartedAt ?? Date.now()
    );
    const maxPatterns = remainingMs <= 0 ? 4 : remainingMs < 4_000 ? 6 : 12;
    const askSymbols = extractBlastSearchSymbols(askText, targetFile);
    let exportSymbols: string[] = [];
    try {
      const workspace = this.indexedRepoWorkspace();
      const target: RepoTarget = {
        repoId,
        owner: ctx.owner ?? this.preferences.owner,
        repo: ctx.repo ?? this.preferences.repo,
        branch: ctx.branch ?? this.preferences.branch,
        provider: ctx.provider ?? this.preferences.defaultCodeHost
      };
      const evidence = await workspace.readFile(target, targetFile);
      if (evidence?.content?.trim()) {
        exportSymbols = extractExportNamesFromSource(evidence.content);
      }
    } catch {
      // Soft gather — continue with path-suffix patterns only.
    }
    const symbols = [...new Set([...exportSymbols, ...askSymbols])];

    // Zero-Clone: durable remote graph first, then Zoekt/SCIP search.
    // Never scan open folders — that fakes a local-repo Blast success.
    let fallback: Awaited<ReturnType<typeof searchDependentsFallback>> = {
      dependents: [],
      source: "remote",
      warnings: []
    };
    try {
      const apiDeps = await this.options.indexBackend.dependents(repoId, targetFile);
      if (
        apiDeps.dependents.length > 0 &&
        isTrustedBlastGraphSource(apiDeps.source)
      ) {
        fallback = {
          dependents: apiDeps.dependents.map((path) => ({
            path,
            depth: 1,
            source: apiDeps.source as "import-parse" | "scip" | "zoekt" | "workspace"
          })),
          source: apiDeps.source as "import-parse" | "scip" | "zoekt" | "workspace",
          warnings: [
            `Dependents from durable ${apiDeps.source} graph — ${apiDeps.dependents.length} direct caller(s).`
          ]
        };
      }
    } catch {
      // Soft gather — continue with remote search.
    }

    if (fallback.dependents.length === 0) {
      try {
        fallback = await searchDependentsFallback(this.options.indexBackend, repoId, targetFile, {
          maxPatterns,
          symbols,
          remoteOnly: true
        });
      } catch {
        return;
      }
    } else {
      // Enrich durable callers with remote search hits; keep durable provenance.
      try {
        const search = await searchDependentsFallback(this.options.indexBackend, repoId, targetFile, {
          maxPatterns,
          symbols,
          remoteOnly: true
        });
        fallback.warnings.push(...search.warnings);
        if (search.dependents.length > 0 && search.source !== "workspace") {
          const seen = new Set(fallback.dependents.map((entry) => entry.path));
          for (const entry of search.dependents) {
            if (!seen.has(entry.path)) {
              seen.add(entry.path);
              fallback.dependents.push({
                ...entry,
                source: fallback.source
              });
            }
          }
        }
      } catch {
        // Soft gather — durable edges alone are enough.
      }
    }

    this.withTurnSessionMirrors(turn, () => {
      const index = this.lastContextBundle.findIndex((entry) => entry.type === "dependencies");
      if (index < 0) {
        return;
      }
      const existing = this.lastContextBundle[index];
      const data =
        typeof existing.data === "object" && existing.data !== null
          ? { ...(existing.data as Record<string, unknown>) }
          : {};
      // Keep only job edges that already target this file (filter applied in
      // blastRadiusFromBundle). Search hits replace everything when present.
      const jobScan = asRecord(data.jobScan);
      const filteredJob = filterJobDependentsForFile(
        Array.isArray(jobScan.dependentsSample)
          ? (jobScan.dependentsSample as Array<{ from?: string; to?: string }>)
          : undefined,
        targetFile
      );
      if (filteredJob.length && !Array.isArray(data.directDependents)) {
        data.directDependents = filteredJob;
      } else if (filteredJob.length && Array.isArray(data.directDependents)) {
        // Drop any prior unfiltered list; re-seed with file-targeted edges only.
        data.directDependents = filteredJob;
      }

      this.lastContextBundle[index] = {
        ...existing,
        data: mergeSearchDependentsFallbackIntoDependenciesData(data, fallback, {
          keepFilteredJobDependentsIfSearchEmpty: filteredJob.length > 0
        })
      };
    });
  }

  private applyKnowledgeGapJobResultToBundle(
    quickAction: string | undefined,
    turn?: ChatTurn
  ): void {
    this.withTurnSessionMirrors(turn, () => {
      if (quickAction !== "knowledge-gaps" || !this.lastJobResult) {
        return;
      }
      const result = this.lastJobResult as Record<string, unknown>;
      const gaps = Array.isArray(result.gaps) ? result.gaps : [];
      const jobScan = {
        source: "knowledge-gap-job",
        cached: Boolean(result.cached),
        foundGaps: typeof result.foundGaps === "number" ? result.foundGaps : gaps.length,
        highPriority: Number(result.highPriority ?? 0),
        mediumPriority: Number(result.mediumPriority ?? 0),
        lowPriority: Number(result.lowPriority ?? 0),
        gaps: gaps.slice(0, 50)
      };
      this.mergeKnowledgeGapScanIntoBundle(jobScan);
    });
  }

  /**
   * A11 hot path: follow open job definition → handlers → email template paths
   * within the soft gather budget, then shape the synthesis prompt.
   */
  private async buildEmailTemplateChatPrompt(options: {
    ask: string;
    turn: ChatTurn;
    turnContext: RepoContext;
    localFiles?: Array<{ path: string; content: string }>;
    signal: AbortSignal;
  }): Promise<string | undefined> {
    const openPath =
      options.turnContext.file?.trim() ||
      options.localFiles?.[0]?.path?.trim() ||
      undefined;
    const fromBundle = options.turn.contextBundle.flatMap((entry) =>
      localFilesFromContextData(entry.data)
    );
    const openContent =
      (openPath
        ? options.localFiles?.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      options.localFiles?.[0]?.content ??
      (openPath
        ? fromBundle.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      fromBundle[0]?.content;
    if (!openPath || !openContent?.trim()) {
      return undefined;
    }

    const budgetMs = remainingContextGatherBudgetMs(options.turn.startedAt || Date.now());
    const repoId = buildRepoId(this.preferences, options.turnContext);
    const workspace = this.indexedRepoWorkspace();
    const target: RepoTarget = {
      repoId,
      owner: options.turnContext.owner ?? this.preferences.owner,
      repo: options.turnContext.repo ?? this.preferences.repo,
      branch: options.turnContext.branch ?? this.preferences.branch,
      provider: options.turnContext.provider ?? this.preferences.defaultCodeHost
    };

    const followedFiles: FollowedJobFile[] = [];
    const loadedPaths = new Set<string>([openPath.replace(/\\/g, "/")]);
    const treePaths: string[] = [];

    const tryReadFollow = async (path: string, reason: string): Promise<void> => {
      const clean = path.replace(/^\/+/, "").replace(/\\/g, "/");
      if (!clean || loadedPaths.has(clean) || pathsReferToSameFile(clean, openPath)) {
        return;
      }
      if (remainingContextGatherBudgetMs(options.turn.startedAt || Date.now()) <= 0) {
        return;
      }
      try {
        const file = await abortablePromise(workspace.readFile(target, clean), options.signal);
        if (!file?.content?.trim()) {
          return;
        }
        loadedPaths.add(clean);
        followedFiles.push({ path: file.path || clean, content: file.content, reason });
      } catch (error) {
        if (options.signal.aborted) {
          throw error;
        }
      }
    };

    // 1) Follow relative / convention handler imports from the open job definition.
    for (const candidate of extractHandlerFollowCandidates(openPath, openContent).slice(0, 4)) {
      await tryReadFollow(candidate, "handler import from open job definition");
    }

    // 2) Follow triggered job ids → sibling handler files.
    const triggered = [
      ...extractTriggeredJobNames(openContent),
      ...followedFiles.flatMap((f) => extractTriggeredJobNames(f.content))
    ];
    for (const jobName of [...new Set(triggered)].slice(0, 4)) {
      for (const candidate of handlerPathsForTriggeredJob(openPath, jobName).slice(0, 4)) {
        await tryReadFollow(candidate, `triggered job \`${jobName}\``);
      }
    }

    // 3) List Use-repo email template directories (one-level) within remaining budget.
    if (remainingContextGatherBudgetMs(options.turn.startedAt || Date.now()) > 0) {
      for (const dir of ["packages/email/templates", "packages/email/template-components"]) {
        try {
          const entries = await abortablePromise(
            Promise.race([
              workspace.listDirectory(target, dir),
              new Promise<undefined>((resolve) => {
                setTimeout(() => resolve(undefined), Math.min(budgetMs, 2500));
              })
            ]),
            options.signal
          );
          for (const entry of entries ?? []) {
            if (entry.type === "file") {
              treePaths.push(`${dir}/${entry.name}`);
            }
          }
        } catch (error) {
          if (options.signal.aborted) {
            throw error;
          }
        }
      }
    }

    // 4) Soft index search for reminder/email template files.
    const gatherQuery = emailTemplateGatherQuery({
      openFilePath: openPath,
      openFileContent: openContent,
      ask: options.ask,
      followedFiles
    });
    const searchBudget = remainingContextGatherBudgetMs(options.turn.startedAt || Date.now());
    if (gatherQuery && searchBudget > 0 && repoId) {
      try {
        const provider =
          options.turnContext.provider === "gitlab" ||
          options.turnContext.provider === "bitbucket" ||
          options.turnContext.provider === "github"
            ? options.turnContext.provider
            : this.preferences.defaultCodeHost;
        const focusSearch = await abortablePromise(
          Promise.race([
            searchRepoForFocusQuery({
              repoId,
              query: gatherQuery,
              indexBackend: this.options.indexBackend,
              api: this.options.api,
              apiBaseUrl: this.preferences.apiBaseUrl,
              branch: options.turnContext.branch ?? this.preferences.branch,
              owner: options.turnContext.owner ?? this.preferences.owner,
              repo: options.turnContext.repo ?? this.preferences.repo,
              provider,
              maxFiles: 4
            }),
            new Promise<undefined>((resolve) => {
              setTimeout(() => resolve(undefined), searchBudget);
            })
          ]),
          options.signal
        );
        if (focusSearch?.files.length) {
          for (const file of focusSearch.files) {
            treePaths.push(file.path);
            if (
              !pathsReferToSameFile(file.path, openPath) &&
              !loadedPaths.has(file.path.replace(/\\/g, "/")) &&
              /\.handler\.[cm]?[jt]sx?$/i.test(file.path)
            ) {
              loadedPaths.add(file.path.replace(/\\/g, "/"));
              followedFiles.push({
                path: file.path,
                content: file.content,
                reason: "index search for reminder/email handler"
              });
            }
          }
          const prior = options.turn.contextBundle;
          options.turn.contextBundle = [
            mergeRepoSemanticContext(
              {
                requestId: `email-template-${Date.now()}`,
                type: "chat_context",
                data: {},
                fetchedAt: new Date()
              },
              focusSearch
            ),
            ...prior
          ];
        }
      } catch (error) {
        if (options.signal.aborted) {
          throw error;
        }
      }
    }

    // Prefer tree matches so even without handler bodies we name concrete templates.
    const treeHits = matchEmailTemplatesInTree(treePaths, options.ask);
    for (const hit of treeHits) {
      if (!treePaths.includes(hit.path)) {
        treePaths.push(hit.path);
      }
    }

    const resolution = resolveEmailTemplateCandidates({
      openFilePath: openPath,
      openFileContent: openContent,
      followedFiles,
      treePaths,
      ask: options.ask
    });

    return buildEmailTemplateSynthesisUserPrompt({
      ask: options.ask,
      resolution
    });
  }

  /**
   * A10 hot path: ticket-style add-feature asks — scan the open starter file for
   * the asked symbol and shape extend vs add-new synthesis. Soft gather: no
   * extra search beyond already-attached open-file bytes.
   */
  private buildExistingCapabilityChatPrompt(options: {
    ask: string;
    turn: ChatTurn;
    turnContext: RepoContext;
    localFiles?: Array<{ path: string; content: string }>;
  }): { message: string; evidence: ExistingCapabilityEvidence } | undefined {
    const openPath =
      options.turnContext.file?.trim() ||
      options.localFiles?.[0]?.path?.trim() ||
      undefined;
    const fromBundle = options.turn.contextBundle.flatMap((entry) =>
      localFilesFromContextData(entry.data)
    );
    const openContent =
      (openPath
        ? options.localFiles?.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      options.localFiles?.[0]?.content ??
      (openPath
        ? fromBundle.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      fromBundle[0]?.content;
    if (!openPath || !openContent?.trim()) {
      return undefined;
    }

    const evidence = extractExistingCapabilityEvidence({
      filePath: openPath,
      fileContent: openContent,
      ask: options.ask
    });
    if (!evidence) {
      return undefined;
    }

    return {
      evidence,
      message: buildExistingCapabilitySynthesisUserPrompt({
        ask: options.ask,
        evidence
      })
    };
  }

  /**
   * A8 hot path: extract status-transition evidence from the open file, follow
   * job triggers within the soft gather budget, and shape the synthesis prompt.
   */
  private async buildStatusTransitionChatPrompt(options: {
    ask: string;
    turn: ChatTurn;
    turnContext: RepoContext;
    localFiles?: Array<{ path: string; content: string }>;
    signal: AbortSignal;
  }): Promise<{ message: string; evidence: StatusTransitionEvidence } | undefined> {
    const openPath =
      options.turnContext.file?.trim() ||
      options.localFiles?.[0]?.path?.trim() ||
      undefined;
    const fromBundle = options.turn.contextBundle.flatMap((entry) =>
      localFilesFromContextData(entry.data)
    );
    const openContent =
      (openPath
        ? options.localFiles?.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      options.localFiles?.[0]?.content ??
      (openPath
        ? fromBundle.find((file) => pathsReferToSameFile(file.path, openPath))?.content
        : undefined) ??
      fromBundle[0]?.content;
    if (!openPath || !openContent?.trim()) {
      return undefined;
    }

    let followedFiles: FollowedStatusFile[] = [];
    const preliminary = extractStatusTransitionEvidence({
      filePath: openPath,
      fileContent: openContent,
      ask: options.ask
    });
    const gatherQuery = statusTransitionGatherQuery(preliminary);
    const budgetMs = remainingContextGatherBudgetMs(options.turn.startedAt || Date.now());
    const repoId = buildRepoId(this.preferences, options.turnContext);

    if (gatherQuery && budgetMs > 0 && repoId) {
      try {
        const provider =
          options.turnContext.provider === "gitlab" ||
          options.turnContext.provider === "bitbucket" ||
          options.turnContext.provider === "github"
            ? options.turnContext.provider
            : this.preferences.defaultCodeHost;
        const focusSearch = await abortablePromise(
          Promise.race([
            searchRepoForFocusQuery({
              repoId,
              query: gatherQuery,
              indexBackend: this.options.indexBackend,
              api: this.options.api,
              apiBaseUrl: this.preferences.apiBaseUrl,
              branch: options.turnContext.branch ?? this.preferences.branch,
              owner: options.turnContext.owner ?? this.preferences.owner,
              repo: options.turnContext.repo ?? this.preferences.repo,
              provider,
              maxFiles: 3
            }),
            new Promise<undefined>((resolve) => {
              setTimeout(() => resolve(undefined), budgetMs);
            })
          ]),
          options.signal
        );
        if (focusSearch?.files.length) {
          followedFiles = focusSearch.files
            .filter((file) => !pathsReferToSameFile(file.path, openPath))
            .map((file) => ({ path: file.path, content: file.content }));
          // Attach followed job/handler bodies so citations can name COMPLETED writers.
          const prior = options.turn.contextBundle;
          options.turn.contextBundle = [
            mergeRepoSemanticContext(
              {
                requestId: `status-transition-${Date.now()}`,
                type: "chat_context",
                data: {},
                fetchedAt: new Date()
              },
              focusSearch
            ),
            ...prior
          ];
        }
      } catch (error) {
        if (options.signal.aborted) {
          throw error;
        }
        // Soft-fail follow-up search — still synthesize from the open file.
      }
    }

    const evidence = extractStatusTransitionEvidence({
      filePath: openPath,
      fileContent: openContent,
      ask: options.ask,
      followedFiles
    });

    return {
      message: buildStatusTransitionSynthesisUserPrompt({
        ask: options.ask,
        evidence
      }),
      evidence
    };
  }

  private enrichKnowledgeGapsBundle(quickAction: string | undefined, turn?: ChatTurn): void {
    if (quickAction !== "knowledge-gaps") {
      return;
    }
    this.withTurnSessionMirrors(turn, () => {
      this.applyKnowledgeGapJobResultToBundle(quickAction);
      if (!this.knowledgeGapScanInBundle()) {
        this.applyHeuristicKnowledgeGapScan();
      } else {
        // Job scan may be empty (foundGaps: 0) while focus topics still lack evidence —
        // merge focus stubs so Strong evidence + Confluence cannot hide a zero-gap card.
        this.mergeFocusTopicStubsIntoExistingScan();
      }
    });
  }

  /** When a job/heuristic scan already exists, still attach uncovered focus-topic stubs. */
  private mergeFocusTopicStubsIntoExistingScan(): void {
    const evidence = knowledgeGapsFromBundle(this.lastContextBundle);
    if (!evidence) {
      return;
    }
    const userFocus =
      knowledgeGapsGatherQuery(evidence.userFocus) ??
      knowledgeGapsGatherQuery(
        typeof evidence.focusSearchQuery === "string" ? evidence.focusSearchQuery : undefined
      );
    const scope = resolveKnowledgeGapsAuditScope({
      file: this.currentContext.file?.trim(),
      userFocus,
      focusHitPaths: evidence.focusSearchPaths
    });
    if (!scope.focusPrimary) {
      return;
    }
    const stubs = knowledgeGapsFocusTopicGapStubs({
      userFocus,
      focusHitPaths: evidence.focusSearchPaths
    });
    if (stubs.length === 0) {
      return;
    }
    const index = this.lastContextBundle.findIndex((entry) => entry.type === "knowledge_gaps");
    if (index < 0) {
      return;
    }
    const existing = this.lastContextBundle[index];
    const data =
      typeof existing.data === "object" && existing.data !== null
        ? { ...(existing.data as Record<string, unknown>) }
        : {};
    const priorScan =
      data.jobScan && typeof data.jobScan === "object"
        ? (data.jobScan as Record<string, unknown>)
        : undefined;
    const merged = mergeKnowledgeGapsFocusStubsIntoScan(priorScan, stubs);
    if (!merged) {
      return;
    }
    this.mergeKnowledgeGapScanIntoBundle(merged);
  }

  private knowledgeGapScanInBundle(): boolean {
    return this.lastContextBundle.some((entry) => {
      if (entry.type !== "knowledge_gaps") {
        return false;
      }
      return Boolean(asRecord(entry.data).jobScan);
    });
  }

  private applyHeuristicKnowledgeGapScan(): void {
    const file = this.currentContext.file?.trim();
    const confluence = confluenceSearchFromBundle(this.lastContextBundle);
    const notion = notionSearchFromBundle(this.lastContextBundle);
    const googleDocs = googleDocsSearchFromBundle(this.lastContextBundle);
    const evidence = knowledgeGapsFromBundle(this.lastContextBundle) ?? (file ? { file } : undefined);
    if (!evidence) {
      return;
    }

    const userFocus =
      knowledgeGapsGatherQuery(evidence.userFocus) ??
      knowledgeGapsGatherQuery(
        typeof evidence.focusSearchQuery === "string" ? evidence.focusSearchQuery : undefined
      );
    const scope = resolveKnowledgeGapsAuditScope({
      file,
      userFocus,
      focusHitPaths: evidence.focusSearchPaths
    });

    const gaps: Array<Record<string, unknown>> = [];
    // When focus is primary and the open file is unrelated, skip file-only ownership
    // stubs that would steal the Summary headline.
    const fileForOwnershipGaps = scope.focusPrimary
      ? scope.relatedOpenFile
      : file ?? evidence.file;
    const target = fileForOwnershipGaps ?? evidence.file;

    if (fileForOwnershipGaps && !evidence.ownershipReport?.scores?.length) {
      gaps.push({
        file: fileForOwnershipGaps,
        type: "missing_owner",
        priority: "high",
        message: "No ownership scores attached for this path"
      });
    }
    if (
      fileForOwnershipGaps &&
      !evidence.dependencyGraph?.directDependents?.length &&
      !evidence.dependencyGraph?.edgeCount
    ) {
      gaps.push({
        file: fileForOwnershipGaps,
        type: "impact_unknown",
        priority: "medium",
        message: "No indexed dependency graph for impact context"
      });
    }
    if (confluence && !confluence.error && !confluence.pages?.length) {
      gaps.push({
        file: target,
        type: "missing_docs",
        priority: "medium",
        message: "No Confluence pages matched repo scope"
      });
    }
    if (notion && !notion.error && !notion.pages?.length) {
      gaps.push({
        file: target,
        type: "missing_docs",
        priority: "medium",
        message: "No Notion pages matched repo scope"
      });
    }
    if (googleDocs && !googleDocs.error && !googleDocs.documents?.length) {
      gaps.push({
        file: target,
        type: "missing_docs",
        priority: "medium",
        message: "No Google Docs matched repo scope"
      });
    }

    if (scope.focusPrimary) {
      for (const stub of knowledgeGapsFocusTopicGapStubs({
        userFocus,
        focusHitPaths: evidence.focusSearchPaths
      })) {
        gaps.push(stub);
      }
    }

    const jobScan: Record<string, unknown> = {
      source: "live-heuristic",
      cached: false,
      foundGaps: gaps.length,
      highPriority: gaps.filter((gap) => gap.priority === "high").length,
      mediumPriority: gaps.filter((gap) => gap.priority === "medium").length,
      lowPriority: gaps.filter((gap) => gap.priority === "low").length,
      gaps
    };
    this.mergeKnowledgeGapScanIntoBundle(jobScan);
  }

  private mergeKnowledgeGapScanIntoBundle(jobScan: Record<string, unknown>): void {
    const index = this.lastContextBundle.findIndex((entry) => entry.type === "knowledge_gaps");
    if (index >= 0) {
      const existing = this.lastContextBundle[index];
      const data =
        typeof existing.data === "object" && existing.data !== null
          ? { ...(existing.data as Record<string, unknown>) }
          : {};
      this.lastContextBundle[index] = {
        ...existing,
        data: { ...data, jobScan }
      };
      return;
    }
    this.lastContextBundle.push({
      requestId: `knowledge-gaps-${Date.now()}`,
      type: "knowledge_gaps",
      data: {
        file: this.currentContext.file,
        jobScan
      },
      fetchedAt: new Date()
    });
  }

  private postRepoExplorer(
    message: Extract<WebviewOutbound, { type: "repo:tree" } | { type: "repo:search-results" }>,
    audience: "chat" | "settings" | "both" = "both"
  ): void {
    if (audience === "chat" || audience === "both") {
      this.postToChat(message);
    }
    if (audience === "settings" || audience === "both") {
      this.postToSettings(message);
    }
  }

  private async handleRepoListRepos(source: "chat" | "settings"): Promise<void> {
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    const audience = source === "settings" ? "settings" : "chat";
    this.postRepoExplorer(
      {
        type: "repo:tree",
        payload: { path: "", items: [], loading: true, provider, scope: "repos" }
      },
      audience
    );
    try {
      let entries: Array<{ provider: typeof provider; owner: string; repo: string; branch?: string }> = [];
      let emptyHint: "workspace" | "workspace_admin" | "workspace_admin_self" | undefined;
      let listLabel: "workspace" | undefined;

      if (source === "chat" && (await this.options.api.hasToken())) {
        const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
        if (workspace.repos.length === 0) {
          if (workspace.adminControlled === true || this.preferences.adminControlledRepos) {
            emptyHint =
              this.preferences.canInstallIntegrations === true
                ? "workspace_admin_self"
                : "workspace_admin";
          } else {
            emptyHint = "workspace";
          }
        } else {
          listLabel = "workspace";
          entries = workspace.repos.map((entry) => {
            const providerToken = entry.repoId.includes(":") ? entry.repoId.split(":")[0] : "github";
            const repoProvider =
              providerToken === "gitlab" || providerToken === "bitbucket" ? providerToken : "github";
            return {
              provider: repoProvider,
              owner: entry.owner,
              repo: entry.name,
              branch: entry.defaultBranch?.trim() || undefined
            };
          });
        }
      } else if (
        (provider === "github" || provider === "gitlab" || provider === "bitbucket") &&
        (await this.options.api.hasToken())
      ) {
        try {
          const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
          if (workspace.repos.length > 0) {
            entries = workspace.repos
              .map((entry) => {
                const providerToken = entry.repoId.includes(":") ? entry.repoId.split(":")[0] : provider;
                const repoProvider =
                  providerToken === "gitlab" || providerToken === "bitbucket" || providerToken === "github"
                    ? providerToken
                    : provider;
                if (repoProvider !== provider) {
                  return undefined;
                }
                return {
                  provider: repoProvider,
                  owner: entry.owner,
                  repo: entry.name,
                  branch: entry.defaultBranch?.trim() || undefined
                };
              })
              .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
          }
        } catch {
          // Fall through to catalog list for settings flows.
        }
        if (entries.length === 0) {
          const remote = await this.options.api.listCodeHostOrgRepos(this.preferences.apiBaseUrl, provider);
          entries = remote.map((entry) => ({
            provider,
            owner: entry.owner,
            repo: entry.name,
            branch: entry.defaultBranch
          }));
        }
      }

      if (entries.length === 0 && source !== "chat") {
        const repos = await this.options.codeHostRouter.listExplorerRepositories({
          provider: this.currentContext.provider,
          owner: this.currentContext.owner,
          repo: this.currentContext.repo,
          branch: this.currentContext.branch
        });
        entries = repos.map((entry) => ({
          provider: entry.provider ?? provider,
          owner: entry.owner,
          repo: entry.repo,
          branch: entry.branch
        }));
      }

      const items = entries.map((entry) => ({
        path: `${entry.provider}:${entry.owner}/${entry.repo}`,
        name: `${entry.owner}/${entry.repo}`,
        type: "repo" as const
      }));
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: {
            path: "",
            items,
            provider,
            scope: "repos",
            emptyHint,
            listLabel
          }
        },
        audience
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load repositories.";
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: { path: "", items: [], error: message, provider, scope: "repos" }
        },
        audience
      );
    }
  }

  private workspaceRepoIdFromContext(context: RepoContext): string | undefined {
    if (!context.owner || !context.repo) {
      return undefined;
    }
    const provider = context.provider ?? this.preferences.defaultCodeHost;
    return `${provider}:${context.owner}/${context.repo}`;
  }

  private async isCurrentRepoInWorkspace(): Promise<boolean> {
    const repoId = this.workspaceRepoIdFromContext(this.currentContext);
    if (!repoId) {
      return false;
    }
    if (this.preferences.workspaceRepoIds?.includes(repoId)) {
      return true;
    }
    if (!(await this.options.api.hasToken())) {
      return false;
    }
    try {
      const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
      return workspace.repos.some((entry) => entry.repoId === repoId);
    } catch {
      return this.preferences.workspaceRepoIds?.includes(repoId) ?? false;
    }
  }

  private async handleGithubReposList(query?: string, requestId?: string): Promise<void> {
    const payload = { requestId, repos: [] as import("./types").GithubRepoOption[], loading: true };
    this.postGithubReposListResult(payload);
    try {
      const repos = await this.options.api.listGithubOrgRepos(this.preferences.apiBaseUrl, {
        query: query?.trim() || undefined
      });
      this.postGithubReposListResult({
        requestId,
        repos,
        loading: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load GitHub repositories.";
      this.postGithubReposListResult({
        requestId,
        repos: [],
        loading: false,
        error: message
      });
    }
  }

  private postGithubReposListResult(payload: {
    requestId?: string;
    repos: import("./types").GithubRepoOption[];
    loading?: boolean;
    error?: string;
  }): void {
    const message = { type: "github:repos:list-result" as const, payload };
    this.post(message);
    this.postToSettings(message);
  }

  private postWorkspaceReposState(payload: {
    repos: import("./types").GithubRepoOption[];
    selectedRepoIds: string[];
    selectedCount: number;
    limit: number | null;
    canAddMore: boolean;
    primaryRepoId?: string;
    error?: string;
    loading?: boolean;
    saving?: boolean;
  }): void {
    const message = { type: "workspace:repos:state" as const, payload };
    this.post(message);
    this.postToSettings(message);
  }

  private async handleWorkspaceReposLoad(): Promise<void> {
    this.postWorkspaceReposState({
      repos: [],
      selectedRepoIds: [],
      selectedCount: 0,
      limit: this.preferences.workspaceRepoLimit ?? null,
      canAddMore: true,
      loading: true
    });
    try {
      const [catalog, workspace] = await Promise.all([
        this.options.api.listCatalogOrgRepos(this.preferences.apiBaseUrl),
        this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl)
      ]);
      const selectedRepoIds = workspace.repos.map((repo) => repo.repoId);
      this.postWorkspaceReposState({
        repos: catalog,
        selectedRepoIds,
        selectedCount: workspace.selectedCount,
        limit: workspace.limit,
        canAddMore: workspace.canAddMore,
        primaryRepoId: workspace.primaryRepoId,
        loading: false,
        saving: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load workspace repos.";
      this.postWorkspaceReposState({
        repos: [],
        selectedRepoIds: [],
        selectedCount: 0,
        limit: this.preferences.workspaceRepoLimit ?? null,
        canAddMore: false,
        error: message,
        loading: false
      });
    }
  }

  private async handleWorkspaceReposSave(repoIds: string[]): Promise<void> {
    this.postWorkspaceReposState({
      repos: [],
      selectedRepoIds: repoIds,
      selectedCount: repoIds.length,
      limit: this.preferences.workspaceRepoLimit ?? null,
      canAddMore: false,
      saving: true,
      loading: true
    });
    try {
      const workspace = await this.options.api.getBackendClient().setWorkspaceRepos(
        this.preferences.apiBaseUrl,
        repoIds
      );
      const primary = workspace.repos[0];
      if (primary) {
        const providerToken = primary.repoId.includes(":")
          ? primary.repoId.split(":")[0]
          : "github";
        const provider =
          providerToken === "gitlab" || providerToken === "bitbucket" ? providerToken : "github";
        const primaryBranch = primary.defaultBranch?.trim();
        this.setRepoContext({
          provider,
          owner: primary.owner,
          repo: primary.name,
          branch: primaryBranch || undefined
        });
        await updateConfiguration({
          owner: primary.owner,
          repo: primary.name,
          ...(primaryBranch ? { branch: primaryBranch } : {})
        });
      }
      await this.refreshAllSessionsPreferences();
      await this.handleWorkspaceReposLoad();
      await this.handleRepoListRepos("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save workspace repos.";
      this.postWorkspaceReposState({
        repos: [],
        selectedRepoIds: repoIds,
        selectedCount: repoIds.length,
        limit: this.preferences.workspaceRepoLimit ?? null,
        canAddMore: false,
        error: message,
        loading: false,
        saving: false
      });
    }
  }

  private async handleRepoSelect(payload: {
    provider: RepoContext["provider"];
    owner: string;
    repo: string;
    branch?: string;
  }): Promise<void> {
    const repoId = `${payload.provider ?? this.preferences.defaultCodeHost}:${payload.owner}/${payload.repo}`;
    // Stamp context before any await so a concurrent repo:list (browse) sees the
    // newly selected repo instead of loading the previous one's tree.
    this.setRepoContext(payload);
    let branch = payload.branch?.trim() || undefined;
    if (await this.options.api.hasToken()) {
      try {
        const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
        const inWorkspace = workspace.repos.some(
          (entry) =>
            entry.repoId === repoId || entry.repoId.toLowerCase() === repoId.toLowerCase()
        );
        if (!inWorkspace) {
          await this.handleRepoListRepos("chat");
          return;
        }
        // Indexed branch beats catalog/settings main (e.g. plane → preview).
        if (!branch) {
          branch = await this.resolveIndexedBranchForTarget(repoId, {
            repoId,
            owner: payload.owner,
            repo: payload.repo,
            provider: payload.provider
          });
        }
        if (!branch) {
          const entry = workspace.repos.find(
            (item) => item.repoId === repoId || item.repoId.toLowerCase() === repoId.toLowerCase()
          );
          branch = entry?.defaultBranch?.trim() || undefined;
        }
      } catch {
        // Continue — file tree may still work if workspace endpoint is temporarily unavailable.
      }
    }
    if (!branch) {
      try {
        const remote = await this.options.codeHostRouter.getRepository({
          provider: payload.provider ?? this.preferences.defaultCodeHost,
          owner: payload.owner,
          repo: payload.repo
        });
        branch = remote.defaultBranch?.trim() || undefined;
      } catch {
        /* leave undefined */
      }
    }
    if (branch && branch !== this.currentContext.branch) {
      this.setRepoContext({ ...payload, branch });
    }
  }

  private async handleRepoSearch(query: string, source: "chat" | "settings"): Promise<void> {
    const audience = source === "settings" ? "settings" : "chat";
    const trimmed = query.trim();
    this.postRepoExplorer(
      {
        type: "repo:search-results",
        payload: { query: trimmed, items: [], loading: true }
      },
      audience
    );
    if (!trimmed) {
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: "", items: [] }
        },
        audience
      );
      return;
    }
    if (!this.currentContext.owner || !this.currentContext.repo) {
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items: [], error: "Select a repository to search files." }
        },
        audience
      );
      return;
    }
    if (audience === "chat" && !(await this.isCurrentRepoInWorkspace())) {
      await this.handleRepoListRepos("chat");
      return;
    }
    try {
      const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
      const hits = await this.options.codeHostRouter.searchRepositoryFiles(trimmed, {
        provider,
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        branch: this.currentContext.branch
      });
      const items = hits.map((hit) => ({
        path: hit.path,
        name: hit.name,
        type: "file" as const
      }));
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items }
        },
        audience
      );
    } catch (error) {
      const message = formatRemoteFileSearchError(error);
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items: [], error: message }
        },
        audience
      );
    }
  }

  private async resolveBranchForCurrentRepo(): Promise<string | undefined> {
    const owner = this.currentContext.owner?.trim();
    const repo = this.currentContext.repo?.trim();
    if (!owner || !repo) {
      return undefined;
    }
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    const repoId = `${provider}:${owner}/${repo}`;

    // Indexed branch first — never trust Settings/workspace main for non-main defaults.
    if (await this.options.api.hasToken()) {
      try {
        const indexed = await this.resolveIndexedBranchForTarget(repoId, {
          repoId,
          owner,
          repo,
          provider,
          branch: this.currentContext.branch
        });
        if (indexed) {
          return indexed;
        }
      } catch {
        /* fall through */
      }
      try {
        const workspace = await this.options.api.getWorkspaceRepos(this.preferences.apiBaseUrl);
        const entry = workspace.repos.find(
          (item) => item.repoId === repoId || item.repoId.toLowerCase() === repoId.toLowerCase()
        );
        const workspaceBranch = entry?.defaultBranch?.trim();
        if (workspaceBranch) {
          return workspaceBranch;
        }
      } catch {
        // Fall through to settings-scoped branch.
      }
    }

    try {
      const remote = await this.options.codeHostRouter.getRepository({
        provider,
        owner,
        repo
      });
      if (remote.defaultBranch?.trim()) {
        return remote.defaultBranch.trim();
      }
    } catch {
      /* fall through */
    }

    const sameAsSettings = owner === this.preferences.owner && repo === this.preferences.repo;
    if (sameAsSettings) {
      return this.currentContext.branch?.trim() || this.preferences.branch?.trim() || undefined;
    }
    return this.currentContext.branch?.trim() || undefined;
  }

  private async handleRepoList(path: string, source: "chat" | "settings"): Promise<void> {
    const audience = source === "settings" ? "settings" : "chat";
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    if (audience === "chat" && !(await this.isCurrentRepoInWorkspace())) {
      await this.handleRepoListRepos("chat");
      return;
    }
    this.postRepoExplorer(
      {
        type: "repo:tree",
        payload: { path, items: [], loading: true, provider, scope: "files" }
      },
      audience
    );
    try {
      const branch = await this.resolveBranchForCurrentRepo();
      const tree = await this.options.codeHostRouter.getRepositoryTree(path, {
        provider,
        owner: this.currentContext.owner,
        repo: this.currentContext.repo,
        branch
      });
      if (
        tree.branch?.trim() &&
        tree.branch !== this.currentContext.branch &&
        this.currentContext.owner &&
        this.currentContext.repo
      ) {
        this.setRepoContext({
          provider,
          owner: this.currentContext.owner,
          repo: this.currentContext.repo,
          branch: tree.branch
        });
      }
      const items = tree.entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        updatedAt: entry.lastModified
      }));
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: { path: tree.path, items, provider, scope: "files" }
        },
        audience
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load remote tree.";
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: { path, items: [], error: message, provider, scope: "files" }
        },
        audience
      );
    }
  }

  private async handleEphemeralRepoList(
    path: string,
    payload: Extract<WebviewInbound, { type: "repo:list" }>["payload"],
    source: "chat" | "settings"
  ): Promise<void> {
    const audience = source === "settings" ? "settings" : "chat";
    const provider = payload.provider ?? this.preferences.defaultCodeHost;
    const owner = payload.owner?.trim();
    const repo = payload.repo?.trim();
    if (!owner || !repo) {
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: {
            path,
            items: [],
            error: "Select a repository to browse files.",
            provider,
            scope: "files"
          }
        },
        audience
      );
      return;
    }
    this.postRepoExplorer(
      {
        type: "repo:tree",
        payload: { path, items: [], loading: true, provider, scope: "files" }
      },
      audience
    );
    try {
      const tree = await this.options.codeHostRouter.getRepositoryTree(path, {
        provider,
        owner,
        repo,
        branch: payload.branch
      });
      const items = tree.entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        updatedAt: entry.lastModified
      }));
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: { path: tree.path, items, provider, scope: "files" }
        },
        audience
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load remote tree.";
      this.postRepoExplorer(
        {
          type: "repo:tree",
          payload: { path, items: [], error: message, provider, scope: "files" }
        },
        audience
      );
    }
  }

  private async handleEphemeralRepoSearch(
    payload: Extract<WebviewInbound, { type: "repo:search" }>["payload"],
    source: "chat" | "settings"
  ): Promise<void> {
    const audience = source === "settings" ? "settings" : "chat";
    const trimmed = payload.query.trim();
    this.postRepoExplorer(
      {
        type: "repo:search-results",
        payload: { query: trimmed, items: [], loading: true }
      },
      audience
    );
    if (!trimmed) {
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: "", items: [] }
        },
        audience
      );
      return;
    }
    const owner = payload.owner?.trim();
    const repo = payload.repo?.trim();
    if (!owner || !repo) {
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items: [], error: "Select a repository to search files." }
        },
        audience
      );
      return;
    }
    try {
      const provider = payload.provider ?? this.preferences.defaultCodeHost;
      const hits = await this.options.codeHostRouter.searchRepositoryFiles(trimmed, {
        provider,
        owner,
        repo,
        branch: payload.branch
      });
      const items = hits.map((hit) => ({
        path: hit.path,
        name: hit.name,
        type: "file" as const
      }));
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items }
        },
        audience
      );
    } catch (error) {
      const message = formatRemoteFileSearchError(error);
      this.postRepoExplorer(
        {
          type: "repo:search-results",
          payload: { query: trimmed, items: [], error: message }
        },
        audience
      );
    }
  }

  private applyDefaultRepoToContext(): void {
    if (this.currentContext.owner?.trim() && this.currentContext.repo?.trim()) {
      this.currentContext = normalizeRepoContext(this.currentContext);
      return;
    }
    if (this.preferences.owner?.trim() && this.preferences.repo?.trim()) {
      // Seed owner/repo from settings only — do NOT stamp scope:"repo".
      // Explicit repo scope is reserved for explorer "Use repo" and must not
      // block active-editor file promotion for Downloads / Cmd+O tabs.
      this.currentContext = mergeRepoContext(this.currentContext, {
        provider: this.preferences.defaultCodeHost,
        owner: this.preferences.owner,
        repo: this.preferences.repo,
        branch: this.preferences.branch
      });
    }
  }

  private syncDescription(): void {
    const scope = inferContextScope(this.currentContext);
    const description =
      scope === "file" && this.currentContext.file
        ? this.currentContext.file
        : this.currentContext.owner && this.currentContext.repo
          ? `${this.currentContext.owner}/${this.currentContext.repo}`
          : "No active context";
    this.options.onDescriptionChange?.(description);
  }

  private postContext(): void {
    this.currentContext = this.withRemoteProvenance(this.currentContext);
    this.currentContext = normalizeRepoContext(this.currentContext);
    this.currentContext = {
      ...this.currentContext,
      projectInstructions: this.resolveProjectInstructionsContext()
    };
    this.syncDescription();
    const repoId = buildRepoId(this.preferences, this.currentContext);
    this.options.lightningStatusBar.setCurrentRepo(repoId);
    void this.options.lightningStatusBar.refresh();
    this.post({ type: "context:update", payload: this.currentContext });
    void this.pushLightningState();
  }

  /** Snap active editor file/selection into context immediately before chat send. */
  private snapEditorContextBeforeSend(options?: {
    allowLocalFileForEdit?: boolean;
    preferRemoteForEdit?: boolean;
  }): void {
    const allowLocalFileForEdit = options?.allowLocalFileForEdit === true;
    const chatPrefs = { ...this.preferences, includeActiveFile: true, includeSelection: true };
    const preference = resolveEditEditorSnapPreference({
      composerMode:
        options?.preferRemoteForEdit === true || allowLocalFileForEdit ? "edit" : undefined,
      remoteProvenance: this.isWorkingOnRemoteProvenance()
    });
    // Remote provenance / /edit: prefer remote VFS tabs — never invent from local Coop-AI disk.
    const preferredPath = this.currentContext.file;
    const editor =
      preference === "remote-only"
        ? pickRemoteEditorForContext(preferredPath)
        : preference === "remote-then-local"
          ? pickRemoteEditorForContext(preferredPath) ??
            pickLocalEditorForContext(preferredPath) ??
            pickEditorForContext(preferredPath)
          : pickLocalEditorForContext(preferredPath) ?? pickEditorForContext(preferredPath);
    if (!editor) {
      return;
    }
    this.currentContext = mergeRepoContext(
      this.currentContext,
      repoContextFromEditor(editor, chatPrefs, this.currentContext)
    );
    this.currentContext = this.withRemoteProvenance(this.currentContext);
    if (
      this.currentContext.file &&
      resolveLocalAbsolutePath(this.currentContext.file) &&
      this.currentContext.fileSource !== "external" &&
      this.currentContext.fileSource !== "remote"
    ) {
      this.currentContext.fileSource = "workspace";
      this.currentContext.contextWarning = undefined;
    }
    this.postContext();
  }

  /** Synchronous capture at send time — async editor/focus state is unreliable after webview click. */
  private loadLocalFilesSyncForChat(options?: {
    /** /edit: attach the full active file so multi-hunk refactors can see call sites. */
    fullFile?: boolean;
  }): LocalFileContextPayload | undefined {
    const fullFile = options?.fullFile === true || this.pendingCodeEditIntent;
    const lines =
      fullFile || !this.currentContext.selectedLines
        ? undefined
        : { start: this.currentContext.selectedLines[0], end: this.currentContext.selectedLines[1] };

    // Explicit outside-repo uploads (Cmd+O) — not a Use-repo clone scan.
    if (this.currentContext.fileSource === "external" || looksLikeAbsoluteDiskPath(this.currentContext.file)) {
      const fromExternal = readExternalOpenFileForChat({
        selectedLines: fullFile ? undefined : this.currentContext.selectedLines,
        fullFile,
        preferredPath: this.currentContext.file
      });
      if (fromExternal?.files.length) {
        this.currentContext = {
          ...this.currentContext,
          file: fromExternal.activeFile,
          fileSource: "external",
          scope: "file"
        };
        return fromExternal;
      }
    }

    // Explicit Use-repo with no in-repo file chip: never invent Gaps/chat evidence from a
    // leftover Coop-AI (or other) editor tab in the Extension Host.
    if (!fullFile && shouldSkipLocalEditorAttachForRepoScope(this.currentContext)) {
      return undefined;
    }

    // Zero-Clone: sync attach is remote URI tabs only. Disk/workspace removed;
    // async resolveChatLocalFiles fetches from the code host when needed.
    return this.loadRemoteFilesSyncForChat(lines);
  }

  /** Attach content from an open remote URI tab only (no local clone / disk). */
  private loadRemoteFilesSyncForChat(
    lines?: { start: number; end: number }
  ): LocalFileContextPayload | undefined {
    const wanted = this.currentContext.file?.trim()
      ? normalizeRelativePath(this.currentContext.file)
      : undefined;
    const remoteEditor = pickRemoteEditorForContext(wanted);
    if (remoteEditor) {
      const resolved = resolveEditorFile(remoteEditor);
      const relativePath = resolved.file?.trim()
        ? normalizeRelativePath(resolved.file)
        : wanted ?? "remote-file";
      const sliced = sliceFileContent(remoteEditor.document.getText(), lines);
      if (sliced.content.trim()) {
        this.currentContext = {
          ...this.currentContext,
          file: relativePath,
          fileSource: "remote",
          scope: "file",
          contextWarning: undefined
        };
        return {
          source: "remote-codehost",
          activeFile: relativePath,
          files: [
            {
              path: relativePath,
              content: sliced.content,
              encoding: "utf8",
              ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
            }
          ],
          fallbackLevel: "partial"
        };
      }
    }

    for (const ref of collectOpenEditorFileRefs()) {
      if (!isRemoteTabAbsolutePath(ref.absolutePath)) {
        continue;
      }
      if (wanted && !pathsReferToSameFile(ref.relativePath, wanted)) {
        continue;
      }
      const visibleEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === ref.absolutePath
      );
      if (visibleEditor?.document.getText().trim()) {
        const relativePath = normalizeRelativePath(ref.relativePath);
        const sliced = sliceFileContent(visibleEditor.document.getText(), lines);
        this.currentContext = {
          ...this.currentContext,
          file: relativePath,
          fileSource: "remote",
          scope: "file",
          contextWarning: undefined
        };
        return {
          source: "remote-codehost",
          activeFile: relativePath,
          files: [
            {
              path: relativePath,
              content: sliced.content,
              encoding: "utf8",
              ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
            }
          ],
          fallbackLevel: "partial"
        };
      }
    }

    return undefined;
  }

  private pendingChatLocalFilesMatchesContext(): boolean {
    if (!this.pendingChatLocalFiles?.files.length) {
      return false;
    }
    const wanted = this.currentContext.file?.trim();
    if (!wanted) {
      return true;
    }
    return pathsReferToSameFile(this.pendingChatLocalFiles.activeFile, wanted);
  }

  private async resolveChatLocalFiles(): Promise<LocalFileContextPayload | undefined> {
    if (
      !this.pendingCodeEditIntent &&
      shouldSkipLocalEditorAttachForRepoScope(this.currentContext)
    ) {
      return undefined;
    }

    if (this.pendingChatLocalFilesMatchesContext()) {
      return this.pendingChatLocalFiles;
    }

    // Outside-workspace buffer already captured at send time, or still open.
    if (this.currentContext.fileSource === "external" || looksLikeAbsoluteDiskPath(this.currentContext.file)) {
      if (this.pendingChatLocalFiles?.files.length) {
        return this.pendingChatLocalFiles;
      }
      const fromExternal = readExternalOpenFileForChat({
        selectedLines: this.pendingCodeEditIntent ? undefined : this.currentContext.selectedLines,
        fullFile: this.pendingCodeEditIntent,
        preferredPath: this.currentContext.file
      });
      if (fromExternal?.files.length) {
        this.currentContext = {
          ...this.currentContext,
          file: fromExternal.activeFile,
          fileSource: "external",
          scope: "file"
        };
        return fromExternal;
      }
      return undefined;
    }

    // Zero-Clone: remote URI tabs or codehost / indexed fetch only — never local clone/disk.
    const lines = this.pendingCodeEditIntent
      ? undefined
      : this.currentContext.selectedLines
        ? { start: this.currentContext.selectedLines[0], end: this.currentContext.selectedLines[1] }
        : undefined;
    const fromRemoteTabs = await readOpenTabFilesForChat({
      file: this.currentContext.file,
      selectedLines: this.pendingCodeEditIntent ? undefined : this.currentContext.selectedLines,
      remoteOnly: true
    });
    if (fromRemoteTabs?.files.length) {
      this.currentContext = {
        ...this.currentContext,
        file: fromRemoteTabs.activeFile,
        fileSource: "remote",
        scope: "file",
        contextWarning: undefined
      };
      return { ...fromRemoteTabs, source: "remote-codehost" };
    }
    const syncRemote = this.loadRemoteFilesSyncForChat(lines);
    if (syncRemote?.files.length) {
      return syncRemote;
    }
    return this.fetchRemoteFileForChatAttach(lines);
  }

  /** Fetch active remote file content — same stack as Understand Repo / Remote browse. */
  private async fetchRemoteFileForChatAttach(
    lines?: { start: number; end: number }
  ): Promise<LocalFileContextPayload | undefined> {
    const filePath = this.currentContext.file?.trim();
    const owner = this.currentContext.owner?.trim();
    const repo = this.currentContext.repo?.trim();
    if (!filePath || !owner || !repo || isOsAbsoluteDiskPath(filePath)) {
      return undefined;
    }
    const relativePath = normalizeRelativePath(filePath);
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    const branch = this.currentContext.branch;
    const repoId = buildRepoId(this.preferences, { owner, repo, provider });
    if (!repoId) {
      return undefined;
    }

    const text = await readRepoFileForContext(
      {
        api: this.options.api,
        apiBaseUrl: this.preferences.apiBaseUrl,
        codeHostRouter: this.options.codeHostRouter
      },
      {
        repoId,
        owner,
        repo,
        branch,
        provider,
        path: relativePath,
        lines
      }
    );

    if (!text?.trim()) {
      return undefined;
    }
    const sliced = sliceFileContent(text, lines);
    this.currentContext = {
      ...this.currentContext,
      file: relativePath,
      fileSource: "remote",
      scope: "file",
      contextWarning: undefined
    };
    return {
      source: "remote-codehost",
      activeFile: relativePath,
      files: [
        {
          path: relativePath,
          content: sliced.content,
          encoding: "utf8",
          ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
        }
      ],
      fallbackLevel: "partial"
    };
  }

  private logContextDebug(message: string): void {
    if (!this.contextDebugChannel) {
      this.contextDebugChannel = vscode.window.createOutputChannel("CoopAI Context");
    }
    // Append only — never reveal the Output panel (that steals focus on every chat turn).
    this.contextDebugChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private injectLocalFilesIntoBundle(local: LocalFileContextPayload): void {
    const chatIndex = this.lastContextBundle.findIndex((entry) => entry.type === "chat_context");
    if (chatIndex >= 0) {
      const entry = this.lastContextBundle[chatIndex];
      const data =
        typeof entry.data === "object" && entry.data !== null
          ? (entry.data as Record<string, unknown>)
          : {};
      this.lastContextBundle[chatIndex] = {
        ...entry,
        data: attachLocalFilesToData(data, local)
      };
      return;
    }

    this.lastContextBundle.push({
      requestId: `chat-local:${Date.now()}`,
      type: "chat_context",
      data: attachLocalFilesToData({ context: this.currentContext }, local),
      fetchedAt: new Date()
    });
  }

  public openLightningPanel(): void {
    void vscode.env.openExternal(vscode.Uri.parse(PRICING_PAGE_URL));
  }

  private async pushLightningState(): Promise<void> {
    const state = await this.options.lightningStatusBar.buildState();
    this.post({ type: "lightning:state", payload: state });
    this.postToSettings({ type: "lightning:state", payload: state });
  }

  private async syncGithubCredentialToCloud(token: string): Promise<void> {
    if (readLightningBackend() !== "cloud" || !isCoopDevMode()) {
      return;
    }
    if (!(await this.options.api.hasToken())) {
      return;
    }
    try {
      await this.options.api.syncGithubCredentialToCloud(this.preferences.apiBaseUrl, token);
    } catch {
      // Non-fatal — local token still saved.
    }
  }

  private async handleInstallGithubApp(): Promise<void> {
    if (!(await this.options.api.hasToken())) {
      void vscode.window.showErrorMessage("Sign in to Coop before installing the GitHub App.");
      return;
    }
    if (this.preferences.canInstallIntegrations === false) {
      void vscode.window.showErrorMessage(
        "Only your organization admin can install the GitHub App. Ask IT to connect GitHub."
      );
      return;
    }
    try {
      const url = await this.options.api.getGithubAppInstallUrl(this.preferences.apiBaseUrl);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      void vscode.window.showInformationMessage(
        "Complete GitHub App installation in your browser, then return here."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open GitHub App install URL.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleSignInPassword(email: string, password: string): Promise<void> {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      void vscode.window.showErrorMessage("Enter your email and password.");
      return;
    }
    try {
      const session = await this.options.api.loginWithPassword(
        this.preferences.apiBaseUrl,
        trimmedEmail,
        password
      );
      await this.options.api.storeSession(session.accessToken, session.refreshToken);
      await this.refreshAllSessionsPreferences();
      void vscode.window.showInformationMessage("Signed in to Coop.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sign in.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleSignInGoogle(): Promise<void> {
    const redirectUri = vscode.Uri.parse("vscode://coop-ai.coop-ai/auth/callback").toString();
    try {
      const url = this.options.api.startGoogleAuthUrl(this.preferences.apiBaseUrl, redirectUri);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      void vscode.window.showInformationMessage("Complete sign-in in your browser, then return to VS Code.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start Google sign-in.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleForgotPassword(email: string): Promise<void> {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      void vscode.window.showErrorMessage("Enter your email address.");
      return;
    }
    try {
      const result = await this.options.api.forgotPassword(this.preferences.apiBaseUrl, trimmedEmail);
      void vscode.window.showInformationMessage(
        result.message ?? "If an account exists for that email, we sent a reset link."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send password reset email.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleSignInSso(orgName?: string): Promise<void> {
    let org = orgName?.trim();
    if (!org) {
      org = (
        await vscode.window.showInputBox({
          prompt: "Organization name for SSO",
          placeHolder: "Acme Engineering",
          ignoreFocusOut: true
        })
      )?.trim();
    }
    if (!org) {
      return;
    }
    const redirectUri = vscode.Uri.parse("vscode://coop-ai.coop-ai/auth/callback").toString();
    try {
      const url = await this.options.api.startPublicSamlLogin(this.preferences.apiBaseUrl, {
        org,
        redirect: redirectUri
      });
      await vscode.env.openExternal(vscode.Uri.parse(url));
      void vscode.window.showInformationMessage(
        "Complete sign-in in your browser. VS Code will finish automatically when you return."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start SSO sign-in.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleInstallGitlabApp(): Promise<void> {
    if (!(await this.options.api.hasToken())) {
      void vscode.window.showErrorMessage("Add your Coop API key before authorizing GitLab.");
      return;
    }
    try {
      const url = await this.options.api.getGitlabAppInstallUrl(this.preferences.apiBaseUrl);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      void vscode.window.showInformationMessage(
        "Complete GitLab authorization in your browser, then return here."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open GitLab authorize URL.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleInstallBitbucketApp(): Promise<void> {
    if (!(await this.options.api.hasToken())) {
      void vscode.window.showErrorMessage("Add your Coop API key before authorizing Bitbucket.");
      return;
    }
    try {
      const url = await this.options.api.getBitbucketAppInstallUrl(this.preferences.apiBaseUrl);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      void vscode.window.showInformationMessage(
        "Complete Bitbucket authorization in your browser, then return here."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open Bitbucket authorize URL.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private adminIntegrationsUrl(): string {
    const adminBase = (this.preferences.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(
      /\/$/,
      ""
    );
    return `${adminBase}/integrations`;
  }

  /** Chat tools are authorized in the admin portal — not via OAuth launched from the extension. */
  private async handleOpenAdminIntegrations(toolLabel: string): Promise<void> {
    try {
      await vscode.env.openExternal(vscode.Uri.parse(this.adminIntegrationsUrl()));
      void vscode.window.showInformationMessage(
        `Connect or manage ${toolLabel} in the Coop admin portal, then return here and click Refresh status.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not open the Coop admin portal.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleInstallSlackApp(): Promise<void> {
    await this.handleOpenAdminIntegrations("Slack");
  }

  private async handleInstallAtlassianApp(): Promise<void> {
    await this.handleOpenAdminIntegrations("Atlassian (Jira / Confluence)");
  }

  private async handleInstallNotionApp(): Promise<void> {
    await this.handleOpenAdminIntegrations("Notion");
  }

  private async handleInstallGoogleDocsApp(): Promise<void> {
    await this.handleOpenAdminIntegrations("Google Docs");
  }

  private async handleInstallTeamsApp(): Promise<void> {
    await this.handleOpenAdminIntegrations("Microsoft Teams");
  }

  private async handleLightningEnableRepo(repoId: string): Promise<void> {
    const [owner, repo] = parseRepoIdParts(repoId);
    const provider = this.currentContext.provider ?? this.preferences.defaultCodeHost;
    try {
      await this.options.indexBackend.enableRepo({
        repoId,
        owner,
        repo,
        branch: this.currentContext.branch ?? this.preferences.branch,
        provider
      });
      void vscode.window.showInformationMessage(`Lightning Mode enabled for ${owner}/${repo}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enable Lightning Mode.";
      void vscode.window.showErrorMessage(message);
    }
    await this.pushLightningState();
    void this.options.lightningStatusBar.refresh();
  }

  private async handleLightningRefreshRepo(repoId: string): Promise<void> {
    const status = await this.options.indexBackend.getRepoStatus(repoId);
    const [owner, repo] = parseRepoIdParts(repoId);
    try {
      await this.options.indexBackend.refreshRepo({
        repoId,
        owner,
        repo,
        branch: status?.localPath ? this.currentContext.branch ?? this.preferences.branch : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lightning re-index failed.";
      void vscode.window.showErrorMessage(message);
    }
    await this.pushLightningState();
    void this.options.lightningStatusBar.refresh();
  }

  private clearIntentFeedback(threadId?: string): void {
    const id = threadId ?? this.activeThreadId();
    for (const key of [...this.chatDeliverableNarrative.keys()]) {
      if (key.startsWith(`${id}:`)) {
        this.chatDeliverableNarrative.delete(key);
      }
    }
    this.lastActivityMessagesByThread.delete(id);
    this.postForThread(id, {
      type: "intent:feedback",
      payload: { status: "complete", title: "" }
    });
  }

  private postIntentFeedback(payload: IntentFeedbackState): void {
    this.postIntentFeedbackForThread(this.activeThreadId(), payload);
  }

  private postIntentFeedbackForThread(threadId: string, payload: IntentFeedbackState): void {
    if (payload.activityMessages?.length) {
      this.lastActivityMessagesByThread.set(threadId, payload.activityMessages);
    }
    this.postForThread(threadId, { type: "intent:feedback", payload });
  }

  private async healthForQuickAction(action: QuickActionFeatureId): Promise<IntegrationHealth[]> {
    const { required, optional } = providersForFeature(action);
    const health = await Promise.all(
      [...required, ...optional].map((provider) => this.options.healthMonitor.updateHealth(provider))
    );
    return this.applyOrgCodeHostHealthOverrides(health);
  }

  /** Align quick-action health with Settings → Tools (org GitHub App / OAuth). */
  private applyOrgCodeHostHealthOverrides(health: IntegrationHealth[]): IntegrationHealth[] {
    if (readLightningBackend() !== "cloud") {
      return health;
    }
    const provider = this.preferences.defaultCodeHost ?? "github";
    const orgConnected =
      provider === "github"
        ? this.preferences.hasGitHubAppInstalled
        : provider === "gitlab"
          ? this.preferences.hasGitLabAppInstalled
          : this.preferences.hasBitbucketAppInstalled;
    if (!orgConnected) {
      return health;
    }
    return health.map((entry) =>
      entry.provider === provider && entry.status === "offline"
        ? {
            ...entry,
            status: "healthy",
            error: undefined,
            errorRate: 0,
            recoveryStrategy: "retry"
          }
        : entry
    );
  }

  private async handleDegradationRefresh(payload?: { feature?: string; retrace?: boolean }): Promise<void> {
    this.contextFetchCache.clear();
    await this.options.degradationCache.clear();
    this.options.codeHostRouter.clearClientCache();
    await this.options.codeHostRouter.clearDataCache();

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const next = repoContextFromEditor(editor, this.preferences, this.currentContext);
      const file =
        next.fileSource === "external" || looksLikeAbsoluteDiskPath(next.file)
          ? next.file?.replace(/\\/g, "/")
          : next.file
            ? toRepositoryRelativePath(next.file)
            : next.file;
      this.currentContext = mergeRepoContext(this.currentContext, {
        ...next,
        file
      });
      this.postContext();
    } else if (this.currentContext.file) {
      const file =
        this.currentContext.fileSource === "external" ||
        looksLikeAbsoluteDiskPath(this.currentContext.file)
          ? this.currentContext.file.replace(/\\/g, "/")
          : toRepositoryRelativePath(this.currentContext.file);
      this.currentContext = {
        ...this.currentContext,
        file
      };
      this.postContext();
    }


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
      await this.runIntentFetch(event, { quiet: true });
      await this.postDecisionTimelineFromBundle();
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
    // Soft gather latency is silent — never post engineer jargon about budgets.
    if (isSoftGatherLatencyMessage(payload.message) || isSoftGatherLatencyMessage(payload.title)) {
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
    // Soft gather is an internal latency tradeoff — never show engineer jargon banners.
    if (
      isSoftGatherLatencyMessage(result.message) ||
      isSoftGatherLatencyMessage(result.error)
    ) {
      return;
    }
    const hasLocal = contextResultHasLocalFiles(result);
    if (hasLocal && !result.error) {
      this.postDegradationNotification({
        id: `${request.id}:degradation`,
        severity: "warning",
        title: "Using local workspace",
        message: result.message ?? "GitHub offline — analyzing from files on disk.",
        feature: typeof request.params.quickAction === "string" ? request.params.quickAction : undefined,
        action: "refresh"
      });
      return;
    }
    const action = request.params.quickAction;
    this.postDegradationNotification({
      id: `${request.id}:degradation`,
      severity: result.error ? "critical" : "warning",
      title: result.error ? "Context unavailable" : "Using best-effort context",
      message: result.message ?? result.error ?? "Showing degraded context.",
      provider: this.inferOfflineProvider(
        typeof action === "string" ? (action as QuickActionFeatureId) : undefined,
        result.message ?? result.error
      ),
      feature: typeof action === "string" ? action : undefined,
      action: "refresh"
    });
  }

  private inferOfflineProvider(
    _quickAction: QuickActionFeatureId | undefined,
    message?: string
  ): IntegrationProvider | undefined {
    return providerFromDegradationMessage(message);
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

  private resolveProjectInstructionsContext() {
    return resolveProjectInstructionsState({
      activeFile: this.currentContext.file,
      workspaceRoots: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath),
      resolveAbsolutePath: resolveLocalAbsolutePath,
      attachedAgentsMdPath: getAttachedAgentsMdPath(this.options.extensionContext)
    });
  }

  /**
   * Phase D hook — silent system-prompt instructions (no chat banner).
   * Wave 1: local AGENTS.md loader only. Phase D will fetch via IndexedRepoWorkspace
   * when Use-repo is remote. Do not add Sources/activity chrome here (UX-G6).
   */
  private buildProjectInstructionsBlock(): string | undefined {
    const state = this.currentContext.projectInstructions;
    if (!readProjectInstructionsEnabled() || state?.status !== "loaded" || !state.gitRoot) {
      return undefined;
    }
    const loaded = loadProjectInstructionsCached({
      enabled: true,
      gitRoot: state.gitRoot,
      activeFile: this.currentContext.file,
      attachedAgentsMdPath: getAttachedAgentsMdPath(this.options.extensionContext)
    });
    return formatProjectInstructionsBlock(loaded);
  }

  private async attachAgentsMd(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Upload",
      filters: { Markdown: ["md"] },
      title: "Upload AGENTS.md"
    });
    if (!picked?.[0]) {
      return;
    }
    const fsPath = picked[0].fsPath;
    if (!fsPath.toLowerCase().endsWith(".md")) {
      void vscode.window.showWarningMessage("Choose a Markdown (.md) file.");
      return;
    }
    try {
      await setAttachedAgentsMdPath(this.options.extensionContext, fsPath);
      this.postContext();
      await this.pushSettingsState();
      void vscode.window.showInformationMessage(`Uploaded ${path.basename(fsPath)} for Coop chat.`);
    } catch (error) {
      console.error("[CoopAI] attachAgentsMd failed", error);
      void vscode.window.showErrorMessage("Could not upload AGENTS.md.");
    }
  }

  private async openAgentsMd(): Promise<void> {
    const attached = getAttachedAgentsMdPath(this.options.extensionContext);
    if (attached && fs.existsSync(attached)) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(attached));
      await vscode.window.showTextDocument(doc);
      return;
    }

    const gitRoot =
      this.currentContext.projectInstructions?.gitRoot ??
      this.resolveProjectInstructionsContext().gitRoot;
    if (!gitRoot) {
      void vscode.window.showWarningMessage("Attach AGENTS.md or open a git repository folder first.");
      return;
    }

    const target = path.join(gitRoot, AGENTS_MD_FILENAME);
    if (!fs.existsSync(target)) {
      void vscode.window.showWarningMessage(`No ${AGENTS_MD_FILENAME} found. Use Attach AGENTS.md to pick a file.`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc);
  }

  private async startFromAgentsMdTemplate(): Promise<void> {
    const gitRoot =
      this.currentContext.projectInstructions?.gitRoot ?? this.resolveProjectInstructionsContext().gitRoot;

    try {
      if (gitRoot) {
        const target = path.join(gitRoot, AGENTS_MD_FILENAME);
        if (fs.existsSync(target)) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
          await vscode.window.showTextDocument(doc);
          void vscode.window.showInformationMessage(`${AGENTS_MD_FILENAME} already exists — opened for editing.`);
        } else {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(AGENTS_MD_SKELETON, "utf8"));
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
          await vscode.window.showTextDocument(doc);
          void vscode.window.showInformationMessage(`Created ${AGENTS_MD_FILENAME} from template at the repo root.`);
        }
        this.postContext();
        await this.pushSettingsState();
        return;
      }

      const defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const picked = await vscode.window.showSaveDialog({
        defaultUri: defaultFolder
          ? vscode.Uri.file(path.join(defaultFolder.fsPath, AGENTS_MD_FILENAME))
          : undefined,
        filters: { Markdown: ["md"] },
        saveLabel: "Create AGENTS.md",
        title: "Save AGENTS.md template"
      });
      if (!picked) {
        return;
      }

      await vscode.workspace.fs.writeFile(picked, Buffer.from(AGENTS_MD_SKELETON, "utf8"));
      await setAttachedAgentsMdPath(this.options.extensionContext, picked.fsPath);
      const doc = await vscode.workspace.openTextDocument(picked);
      await vscode.window.showTextDocument(doc);
      void vscode.window.showInformationMessage(`Created ${path.basename(picked.fsPath)} from template.`);
      this.postContext();
      await this.pushSettingsState();
    } catch (error) {
      console.error("[CoopAI] startFromAgentsMdTemplate failed", error);
      void vscode.window.showErrorMessage("Could not create AGENTS.md from template.");
    }
  }

  private async pushSettingsState(): Promise<void> {
    const identityDirectory = this.preferences.isSignedIn
      ? await this.options.identityDirectoryStore.load(this.preferences.apiBaseUrl)
      : { ...EMPTY_IDENTITY_DIRECTORY };
    const payload: SettingsStatePayload = {
      ...this.preferences,
      identityDirectory,
      projectInstructions: this.resolveProjectInstructionsContext()
    };
    const message: WebviewOutbound = { type: "settings:state", payload };
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

  private async handleMentionSearch(pattern: string): Promise<void> {
    const query = pattern.trim();
    if (!query) {
      this.post({
        type: "mention:results",
        payload: { pattern: query, items: [] }
      });
      return;
    }

    this.post({
      type: "mention:results",
      payload: { pattern: query, items: [], loading: true }
    });

    try {
      const owner = this.currentContext.owner?.trim();
      const repo = this.currentContext.repo?.trim();
      const preferRepoId =
        owner && repo ? buildRepoId(this.preferences, this.currentContext) : undefined;
      const mentionMergeOptions = preferRepoId ? { preferRepoId } : undefined;

      const searchRepoIds = await this.resolveMentionSearchRepoIds();
      const repoScope = resolveMentionRepoScope(query, searchRepoIds);
      const defaultRepoId = buildRepoId(this.preferences, this.currentContext);
      const searchRepoId = repoScope?.repoId ?? defaultRepoId;
      const searchPattern = repoScope?.pathQuery ?? query;
      const searchScope = resolveSearchScope(this.preferences);

      if (repoScope && !repoScope.pathQuery) {
        const localPaths = await searchLocalWorkspaceFiles(query, MENTION_SEARCH_LIMIT);
        const localItems = localPathsToMentionResults(localPaths, mentionMergeOptions);
        const ranked = rankMentionSearchResults(
          dedupeHybridMentionResults(localItems, mentionMergeOptions),
          query,
          mentionMergeOptions
        ).slice(0, MENTION_SEARCH_LIMIT);
        this.post({
          type: "mention:results",
          payload: {
            pattern: query,
            items: ranked,
            hint:
              ranked.length === 0
                ? `Type a path after @${repoScope.matchedPrefix}/ — e.g. @${repoScope.matchedPrefix}/cmd/zoekt-webserver/main.go`
                : undefined
          }
        });
        return;
      }

      const localPaths = await searchLocalWorkspaceFiles(searchPattern, MENTION_SEARCH_LIMIT);
      let graphItems: MentionSearchResult[] = [];
      let graphError: string | undefined;
      try {
        const remote = (await this.options.api.graphSearch(
          this.preferences.apiBaseUrl,
          searchRepoId,
          searchPattern,
          {
            collectionId: repoScope ? undefined : searchScope.collectionId,
            scope: repoScope ? undefined : searchScope.scope,
            mention: true
          }
        )) as {
          data?: Array<{ repoId?: string; path?: string; sha?: string; score?: number }>;
        };
        graphItems = graphHitsToMentionResults(remote.data ?? [], searchRepoId, isNoisyMentionPath);
      } catch (error) {
        graphError = error instanceof Error ? error.message : "Indexed search failed.";
      }

      if (graphItems.length === 0 && !repoScope) {
        const fallbackItems = await this.searchMentionCodeHostFallback(searchRepoId, searchPattern);
        if (fallbackItems.length > 0) {
          graphItems = fallbackItems;
          graphError = undefined;
        }
      }

      const localItems = localPathsToMentionResults(localPaths, mentionMergeOptions);
      const ranked = mergeHybridMentionSearchResults(
        graphItems,
        localItems,
        searchPattern,
        mentionMergeOptions
      );
      const hasGraphHits = graphItems.length > 0;
      const hasLocalHits = localItems.length > 0;
      const emptyHint =
        ranked.length === 0
          ? "No files matched. Check Workspace → Search scope, GitHub connection, or open the repo folder locally."
          : undefined;

      this.post({
        type: "mention:results",
        payload: {
          pattern: query,
          items: ranked,
          hint: ranked.length === 0 ? emptyHint : undefined,
          error: ranked.length === 0 ? graphError : undefined
        }
      });
    } catch (error) {
      this.post({
        type: "mention:results",
        payload: {
          pattern: query,
          items: [],
          error: error instanceof Error ? error.message : "Search failed."
        }
      });
    }
  }

  /** Coop API + code-host search when the remote graph index returns no hits. */
  private async searchMentionCodeHostFallback(
    repoId: string,
    pattern: string
  ): Promise<MentionSearchResult[]> {
    const branch = this.currentContext.branch ?? this.preferences.branch;

    if (await this.options.api.hasToken()) {
      try {
        const hits = await this.options.api.fetchRepoSearchViaCloud(
          this.preferences.apiBaseUrl,
          repoId,
          pattern,
          branch,
          MENTION_SEARCH_LIMIT
        );
        if (hits.length > 0) {
          return hits.map((hit) => ({
            repoId,
            path: hit.path,
            source: "indexed" as const
          }));
        }
      } catch {
        // Fall through to direct code-host search.
      }
    }

    const [owner, repo] = parseRepoIdParts(repoId);
    if (!owner || !repo) {
      return [];
    }
    try {
      const hits = await this.options.codeHostRouter.searchRepositoryFiles(pattern, {
        provider: this.currentContext.provider ?? this.preferences.defaultCodeHost,
        owner,
        repo,
        branch
      });
      return hits.map((hit) => ({
        repoId,
        path: hit.path,
        source: "indexed" as const
      }));
    } catch {
      return [];
    }
  }

  private async resolveMentionSearchRepoIds(): Promise<string[]> {
    const scope = resolveSearchScope(this.preferences);
    if (scope.mode === "collection" && scope.collectionId) {
      const collections = await this.options.api.listCollections(this.preferences.apiBaseUrl);
      const collection = collections.find((entry) => entry.id === scope.collectionId);
      const repoIds = collection?.repoIds ?? [];
      if (repoIds.length > 0) {
        return repoIds;
      }
    }
    if (scope.mode === "indexed" || scope.mode === "org") {
      try {
        const workspaceIds = await this.options.api.listWorkspaceRepoIds(this.preferences.apiBaseUrl);
        if (workspaceIds.length > 0) {
          return workspaceIds;
        }
        const repos = await this.options.api.listOrgRepos(this.preferences.apiBaseUrl);
        const indexed = repos
          .filter((repo) => repo.lightningEnabled)
          .map((repo) => repo.repoId)
          .filter(Boolean);
        if (indexed.length > 0) {
          return indexed;
        }
      } catch {
        // Fall through to active repo.
      }
    }
    return [buildRepoId(this.preferences, this.currentContext)];
  }

  private async handleCollectionsListRequest(): Promise<void> {
    if (isFreePlan(this.preferences.plan)) {
      const empty = { type: "collections:list" as const, payload: { collections: [] as [] } };
      this.post(empty);
      this.postToSettings(empty);
      return;
    }
    try {
      const collections = await this.options.api.listCollections(this.preferences.apiBaseUrl);
      this.post({
        type: "collections:list",
        payload: { collections }
      });
      this.postToSettings({
        type: "collections:list",
        payload: { collections }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load collections.";
      this.post({
        type: "collections:list",
        payload: { collections: [], error: message }
      });
      this.postToSettings({
        type: "collections:list",
        payload: { collections: [], error: message }
      });
    }
  }

  private async resolveMentionFiles(
    mentions: ChatFileMention[]
  ): Promise<Array<{ repoId: string; path: string; content: string; lineRange?: [number, number] }>> {
    const resolved: Array<{
      repoId: string;
      path: string;
      content: string;
      lineRange?: [number, number];
    }> = [];

    for (const mention of mentions.slice(0, 3)) {
      let content = mention.snippet?.trim() ?? "";
      if (!content || !mention.lines) {
        const preferLocal =
          mention.source === "local" || mention.repoId === WORKSPACE_LOCAL_REPO_ID;
        if (preferLocal) {
          // Zero-Clone: keep snippet only — never hydrate from workspace disk.
          content = resolveMentionFileContent({
            prefer: "local",
            localContent: undefined,
            existingSnippet: mention.snippet
          });
        } else {
          // Indexed / remote @mention: codehost fetch only.
          let remoteContent: string | undefined;
          try {
            const file = await this.options.api
              .getBackendClient()
              .fetchRepoFile(
                this.preferences.apiBaseUrl,
                mention.repoId,
                mention.path,
                this.currentContext.branch ?? this.preferences.branch
              );
            remoteContent = file.content ?? "";
          } catch {
            remoteContent = undefined;
          }
          content = resolveMentionFileContent({
            prefer: "remote",
            remoteContent,
            existingSnippet: mention.snippet
          });
          if (!content.trim()) {
            continue;
          }
        }
      }

      if (mention.lines && mention.lines.length === 2) {
        const sliced = sliceFileLines(content, mention.lines[0], mention.lines[1]);
        resolved.push({
          repoId: mention.repoId,
          path: mention.path,
          content: sliced,
          lineRange: mention.lines
        });
      } else {
        resolved.push({
          repoId: mention.repoId,
          path: mention.path,
          content: content.slice(0, 12_000)
        });
      }
    }

    return resolved;
  }
}

function formatRemoteFileSearchError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Failed to search repository files.";
  if (raw.includes("422") || raw.includes("403")) {
    return (
      "GitHub code search is unavailable for this repository. Browse folders from the repo root " +
      "(Repos → your repo → src → server), or try a path search like src/server/githubAppApi."
    );
  }
  return raw;
}

function resolveSearchScope(preferences: UserPreferences): {
  mode: import("./types").SearchScopeMode;
  collectionId?: string;
  scope?: "indexed" | "org";
} {
  return resolveSearchScopeForPlan({
    plan: preferences.plan,
    searchScopeMode: preferences.searchScopeMode,
    searchCollectionId: preferences.searchCollectionId
  });
}

type MentionRepoScope = {
  repoId: string;
  pathQuery: string;
  matchedPrefix: string;
};

function resolveMentionRepoScope(pattern: string, repoIds: string[]): MentionRepoScope | undefined {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates = repoIds
    .flatMap((repoId) => {
      const [owner, repo] = parseRepoIdParts(repoId);
      const ownerRepo = `${owner}/${repo}`;
      return [
        { repoId, prefix: repoId },
        { repoId, prefix: ownerRepo },
        { repoId, prefix: repo }
      ];
    })
    .sort((left, right) => right.prefix.length - left.prefix.length);

  for (const candidate of candidates) {
    const lower = trimmed.toLowerCase();
    const prefixLower = candidate.prefix.toLowerCase();
    if (lower === prefixLower) {
      return { repoId: candidate.repoId, pathQuery: "", matchedPrefix: candidate.prefix };
    }
    if (lower.startsWith(`${prefixLower}/`)) {
      return {
        repoId: candidate.repoId,
        pathQuery: trimmed.slice(candidate.prefix.length + 1),
        matchedPrefix: candidate.prefix
      };
    }
  }

  return undefined;
}

function isNoisyMentionPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.startsWith("testdata/") ||
    normalized.includes("/testdata/") ||
    normalized.includes("/shards/") ||
    normalized.endsWith(".zoekt") ||
    normalized.endsWith(".pb") ||
    normalized.includes("/vendor/") ||
    normalized.includes("/node_modules/")
  );
}

function sliceFileLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start - 1, end).join("\n");
}

/** Preserve evidence types missing from a lighter follow-up fetch (e.g. decision_history). */
function mergeContextBundleResults(
  previous: ContextFetchResult[],
  incoming: ContextFetchResult[],
  activeFile?: string
): ContextFetchResult[] {
  const incomingTypes = new Set(incoming.map((entry) => entry.type));
  const preserved = previous.filter((entry) => {
    if (incomingTypes.has(entry.type)) {
      return false;
    }
    if (entry.type === "decision_history" && activeFile?.trim()) {
      const timeline = (entry.data as { timeline?: DecisionTimeline } | undefined)?.timeline;
      if (
        timeline?.file?.trim() &&
        !pathsReferToSameFile(timeline.file, activeFile)
      ) {
        return false;
      }
    }
    return true;
  });
  return [...incoming, ...preserved];
}

function resolveTraceFallbackTimeline(
  timeline: DecisionTimeline | undefined,
  activeFile: string | undefined
): DecisionTimeline | undefined {
  if (!timeline) {
    return undefined;
  }
  if (
    activeFile?.trim() &&
    timeline.file?.trim() &&
    !pathsReferToSameFile(timeline.file, activeFile)
  ) {
    return undefined;
  }
  return timeline;
}

function parseRepoIdParts(repoId: string): [string, string] {
  const slash = repoId.includes(":") ? repoId.split(":")[1] : repoId;
  const parts = (slash ?? repoId).split("/");
  return [parts[0] ?? "unknown", parts[1] ?? "repo"];
}

function integrationLabel(provider: IntegrationChatProvider): string {
  switch (provider) {
    case "slack":
      return "Slack";
    case "jira":
      return "Jira";
    case "teams":
      return "Microsoft Teams";
    case "confluence":
      return "Confluence";
    case "notion":
      return "Notion";
    case "google-docs":
      return "Google Docs";
    default:
      return provider;
  }
}

function seedChatDeliverableNarrative(actionId: string): string[] {
  switch (actionId) {
    case "blast-radius":
      return [
        "Analyzing dependencies…",
        "Mapping change impact…",
        "Scanning callers and dependents…",
        "Building dependency graph…"
      ];
    case "knowledge-gaps":
      return ["Scanning repository for knowledge gaps…", "Reviewing docs coverage…"];
    default:
      return ["Running background scan…"];
  }
}

function mergeActivityMessageLists(prior: string[], incoming: string[]): string[] {
  const seen = new Set(prior);
  const merged = [...prior];
  for (const message of incoming) {
    const trimmed = message.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

function dedupeActivityMessages(messages: string[]): string[] {
  return mergeActivityMessageLists([], messages);
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

function activeJobMessageForAction(actionId: string): string {
  switch (actionId) {
    case "knowledge-gaps":
      return "Scanning repository for knowledge gaps…";
    case "blast-radius":
      return "Building dependency graph…";
    default:
      return "Running background scan…";
  }
}

function preparingAnswerMessageForAction(actionId: string): string {
  switch (actionId) {
    case "knowledge-gaps":
      return "Scan complete — preparing answer…";
    case "blast-radius":
      return "Graph ready — preparing answer…";
    default:
      return "Preparing answer…";
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

function scoreFromReport(value: unknown): number | undefined {
  const report = (asRecord(value).report ?? value) as { scores?: Array<{ score?: number }> } | undefined;
  const primary = report?.scores?.[0];
  return primary?.score !== undefined ? primary.score / 100 : undefined;
}

function commitsFromReport(value: unknown): number | undefined {
  const report = (asRecord(value).report ?? value) as { scores?: Array<{ commitCount?: number }> } | undefined;
  return report?.scores?.[0]?.commitCount;
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

function providerFromDegradationMessage(message?: string): IntegrationProvider | undefined {
  if (!message) {
    return undefined;
  }
  const match = message.match(/\b(GitHub|GitLab|Bitbucket|Slack|Jira|Teams)\b/i);
  if (!match) {
    return undefined;
  }
  const normalized = match[1].toLowerCase();
  if (normalized === "teams") {
    return "teams";
  }
  return normalized as IntegrationProvider;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
