import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SettingsScreen } from "../chat/settingsScreens";
import { ContextScopeLabel } from "./components/ContextScopeLabel";
import { ChatActivityStrip } from "./components/ChatActivityStrip";
import { CoopNotice } from "./components/CoopNotice";
import { QuotaExceededNotice, type QuotaExceededNoticeState } from "./components/QuotaExceededNotice";
import { ChatComposer } from "./components/ChatComposer";
import { ChatStream, ChatMessage, type ChatInlineArtifact, renderInlineArtifact } from "./components/ChatStream";
import { ChatThinkingIndicator } from "./components/ChatThinkingIndicator";
import { ChatProse } from "./components/ChatProse";
import { CitationNavigationProvider } from "./components/CitationNavigationContext";
import { ChatLinkProvider } from "./components/ChatLinkContext";
import { EmptyState } from "./components/EmptyState";
import { AgentsMdStatusChip, ProjectInstructionsNotice } from "./components/ProjectInstructionsNotice";
import { shouldPromptForAgentsMd } from "./lib/agentsMdStatus";
import { ConflictResolution } from "./ConflictResolution";
import { PatchCard, shouldHidePatchMarkdownForMessage, shouldRenderPatchCardForMessage } from "./PatchCard";
import { DegradationNotification } from "./DegradationNotification";
import { IntentFeedback } from "./IntentFeedback";
import type { ChatHistoryPayload, GithubRepoOption, PatchCardState, PatchCardsUpdatePayload } from "../chat/types";
import { inlineArtifactsFromHistory } from "./restoreInlineArtifacts";
import { applyThemeMode } from "./theme";
import {
  buildThinkingMessageSequence,
  pickRotatingThinkingMessage,
  shouldShowThinkingIndicator,
  THINKING_ROTATION_STEP_MS
} from "./thinkingMessageRotation";
import { QuickActionId } from "./types";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import { PromptDetailOverlay } from "./components/PromptDetailOverlay";
import { PanelWidthEnforcer } from "./components/PanelWidthEnforcer";
import { ThreadHeaderSwitcher, type ThreadListItem } from "./components/ThreadHeaderSwitcher";
import { PromptLibraryPill } from "./components/PromptLibraryPill";
import type { PromptLibraryItem } from "./components/promptLibraryTypes";
import { RemoteExplorer, parseRepoNodePath } from "./RemoteExplorer";
import type { ExplorerSearchState, ExplorerTreeState } from "./components/RemoteExplorerTree";
import { ADMIN_PORTAL_URL } from "../config/publicUrls";
import { DecisionTimeline, type DecisionTimelinePayload } from "./DecisionTimeline";
import type { OwnershipCardPayload } from "./OwnershipCard";
import type { LightningModeState } from "../indexing/lightningTypes";
import type { EvidenceActionContext } from "./evidenceCardActionHandler";
import { SLASH_COMMANDS, slashCommandHistoryContent } from "../context/slashCommands";
import { ProUpgradeChip } from "./LightningModePanel";
import type { ChatFileMention, ChatImageAttachment, MentionSearchResult } from "../chat/types";
import { appendFileMention } from "./lib/fileMentionUtils";
import { inferActionIdFromTemplate } from "./lib/inferPromptActionId";
import { resolvePromptLibraryRun } from "../prompts/promptLibraryRun";
import { useLaunchTypewriter } from "./hooks/useLaunchTypewriter";
import { useDebouncedProse } from "./hooks/useDebouncedProse";
import { attachmentsFromDataTransfer, mergeAttachments } from "./attachmentUtils";
import type {
  ConflictActionId,
  ConflictResolutionState,
  DegradationNotificationPayload,
  IntentFeedbackState,
  JobProgressState,
  RepoContext
} from "./types";

type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

type RemoteTreeNode = {
  path: string;
  name: string;
  type: "file" | "dir" | "repo";
  size?: number;
  updatedAt?: string;
};

type InboundMessage =
  | { type: "theme:update"; payload: { mode: "light" | "dark" | "high-contrast" } }
  | { type: "context:update"; payload: RepoContext }
  | { type: "chat:history"; payload: ChatHistoryPayload | ChatMessage[] }
  | { type: "chat:delta"; payload: { chunk: string; threadId?: string } }
  | { type: "chat:complete"; payload: { message: ChatMessage; threadId?: string } }
  | { type: "chat:error"; payload: { message: string; threadId?: string } }
  | { type: "chat:stream-resume"; payload: { threadId: string; partialText: string } }
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
  | {
      type: "repo:tree";
      payload: {
        path: string;
        items: RemoteTreeNode[];
        scope?: "repos" | "files";
        error?: string;
        stale?: boolean;
        provider?: "github" | "gitlab" | "bitbucket";
        loading?: boolean;
        emptyHint?: "workspace" | "workspace_admin";
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
  | { type: "patch:update"; payload: PatchCardsUpdatePayload | PatchCardState }
  | { type: "degradation:notification"; payload: DegradationNotificationPayload }
  | { type: "trace:autoload"; payload: { message: string } }
  | {
      type: "command:confirm";
      payload: {
        title: string;
        message: string;
        run: { message: string; quickAction: string; attachments?: ChatImageAttachment[]; historyContent?: string; mentions?: ChatFileMention[]; slashUserArgs?: string };
      };
    }
  | { type: "job:progress"; payload: JobProgressState }
  | { type: "job:complete"; payload: JobProgressState }
  | {
      type: "chat:usage";
      payload: {
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        provider: string;
        model: string;
        sessionCostUsd: number;
      };
    }
  | {
      type: "prompts:list";
      payload: {
        prompts: PromptLibraryItem[];
        pinnedIds: string[];
        hasWorkspace: boolean;
      };
    }
  | { type: "prompts:insert"; payload: { text: string; actionId?: string } }
  | { type: "decision:timeline"; payload: { artifactId?: string; timeline: DecisionTimelinePayload } }
  | {
      type: "ownership:card";
      payload: { artifactId?: string; report: OwnershipCardPayload; slackSearch?: import("../context/contextBundleEvidence").SlackSearchEvidence };
    }
  | {
      type: "repo-summary:card";
      payload: {
        artifactId?: string;
        evidence: import("../context/contextBundleEvidence").RepoSummaryEvidence;
        owner: string;
        repo: string;
        branch?: string;
      };
    }
  | {
      type: "blast-radius:card";
      payload: {
        artifactId?: string;
        evidence: import("../context/contextBundleEvidence").BlastRadiusEvidence;
        file: string;
      };
    }
  | {
      type: "knowledge-gaps:card";
      payload: {
        artifactId?: string;
        evidence: import("../context/contextBundleEvidence").KnowledgeGapsEvidence;
        confluence?: import("../context/contextBundleEvidence").ConfluenceSearchEvidence;
        jira?: import("../context/contextBundleEvidence").JiraSearchEvidence;
        slack?: import("../context/contextBundleEvidence").SlackSearchEvidence;
        notion?: import("../context/contextBundleEvidence").NotionSearchEvidence;
        googleDocs?: import("../context/contextBundleEvidence").GoogleDocsSearchEvidence;
        teams?: import("../context/contextBundleEvidence").TeamsSearchEvidence;
        file?: string;
      };
    }
  | {
      type: "integration:card";
      payload: {
        artifactId?: string;
        provider: import("../chat/types").IntegrationChatProvider;
        evidence: Record<string, unknown>;
      };
    }
  | {
      type: "threads:list";
      payload: { activeId: string; activeTitle: string; threads: ThreadListItem[] };
    }
  | { type: "chat:thread-changed"; payload: { threadId: string; title: string } }
  | { type: "lightning:open" }
  | { type: "lightning:state"; payload: LightningModeState }
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
      type: "mention:results";
      payload: {
        pattern: string;
        items: MentionSearchResult[];
        error?: string;
        loading?: boolean;
        hint?: string;
      };
    };

type ChatPanelProps = {
  vscode: VsCodeApi;
};

type PersistedWebviewState = {
  draftInput: string;
};

const INPUT_MAX = 12_000;

function ChatFooter({
  error,
  onDismissError,
  quotaNotice,
  onDismissQuotaNotice,
  contextWarning,
  onDismissContextWarning,
  intentFeedback,
  onDismissIntent,
  jobProgress,
  onDismissJob,
  onCancelJob,
  onViewJobResults,
  conflictCount,
  hideInlineActivity,
  inlineThinkingOptions,
  children
}: {
  error: string;
  onDismissError: () => void;
  quotaNotice?: QuotaExceededNoticeState;
  onDismissQuotaNotice?: () => void;
  contextWarning?: string;
  onDismissContextWarning?: () => void;
  intentFeedback?: IntentFeedbackState;
  onDismissIntent: () => void;
  jobProgress?: JobProgressState;
  onDismissJob: () => void;
  onCancelJob?: (jobId: string) => void;
  onViewJobResults?: (jobId: string) => void;
  conflictCount: number;
  hideInlineActivity?: boolean;
  inlineThinkingOptions?: { awaitingResponse?: boolean };
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <footer className="chat-footer">
      {quotaNotice && onDismissQuotaNotice ? (
        <QuotaExceededNotice notice={quotaNotice} onDismiss={onDismissQuotaNotice} />
      ) : null}
      <ChatActivityStrip
        error={quotaNotice ? undefined : error || undefined}
        onDismissError={onDismissError}
        contextWarning={contextWarning}
        onDismissContextWarning={onDismissContextWarning}
        intentFeedback={intentFeedback}
        onDismissIntent={onDismissIntent}
        jobProgress={jobProgress}
        onDismissJob={onDismissJob}
        onCancelJob={onCancelJob}
        onViewJobResults={onViewJobResults}
        conflictCount={conflictCount}
        hideInlineActivity={hideInlineActivity}
        inlineThinkingOptions={inlineThinkingOptions}
      />
      <div className="chat-footer-inner">{children}</div>
    </footer>
  );
}

export function ChatPanel({ vscode }: ChatPanelProps): React.ReactElement {
  const cached = (vscode.getState() as PersistedWebviewState | null) || null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<RepoContext>({});
  const [dismissedAgentsNoticeFor, setDismissedAgentsNoticeFor] = useState<string | undefined>();
  const [input, setInput] = useState(cached?.draftInput || "");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [mentions, setMentions] = useState<ChatFileMention[]>([]);
  const [mentionResults, setMentionResults] = useState<MentionSearchResult[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState("");
  const [mentionHint, setMentionHint] = useState("");
  const [error, setError] = useState("");
  const [quotaNotice, setQuotaNotice] = useState<QuotaExceededNoticeState | undefined>();
  const [streamingBuffer, setStreamingBuffer] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const explorerRepoRef = useRef<{
    provider: import("../chat/types").CodeHostProviderPreference;
    owner: string;
    repo: string;
  } | null>(null);
  const [treeState, setTreeState] = useState<ExplorerTreeState>({ path: "", items: [], scope: "files" });
  const [searchState, setSearchState] = useState<{
    query: string;
    items: RemoteTreeNode[];
    error?: string;
    loading?: boolean;
  }>({ query: "", items: [] });
  const [intentFeedback, setIntentFeedback] = useState<IntentFeedbackState | undefined>();
  const [jobProgress, setJobProgress] = useState<JobProgressState | undefined>();
  const [commandConfirm, setCommandConfirm] = useState<{
    title: string;
    message: string;
    run: { message: string; quickAction: string; attachments?: ChatImageAttachment[]; historyContent?: string; mentions?: ChatFileMention[]; slashUserArgs?: string };
  } | undefined>();
  const [conflictState, setConflictState] = useState<ConflictResolutionState | undefined>();
  const [patchCards, setPatchCards] = useState<PatchCardState[]>([]);
  const [suppressedPatchTimestamps, setSuppressedPatchTimestamps] = useState<number[]>([]);
  const [degradationNotification, setDegradationNotification] = useState<DegradationNotificationPayload | undefined>();
  const [usageLabel, setUsageLabel] = useState<string | undefined>();
  const [promptLibrary, setPromptLibrary] = useState<{
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  }>({ prompts: [], pinnedIds: [], hasWorkspace: false });
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [pendingPromptActionId, setPendingPromptActionId] = useState<QuickActionId | undefined>();
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savePromptDraft, setSavePromptDraft] = useState({ title: "", template: "" });
  const [inlineArtifacts, setInlineArtifacts] = useState<ChatInlineArtifact[]>([]);
  const [threadsState, setThreadsState] = useState<{
    activeId: string;
    activeTitle: string;
    threads: ThreadListItem[];
  } | null>(null);
  const threadsStateRef = useRef(threadsState);
  threadsStateRef.current = threadsState;
  const [lightningState, setLightningState] = useState<LightningModeState | null>(null);
  const [chatHistorySynced, setChatHistorySynced] = useState(false);
  const [launchIntroConsumed, setLaunchIntroConsumed] = useState(false);
  const [scrollEpoch, setScrollEpoch] = useState(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const debouncedStream = useDebouncedProse(streamingBuffer, 75);

  const resetEphemeralChatState = useCallback(() => {
    setStreamingBuffer("");
    setIsStreaming(false);
    setError("");
    setQuotaNotice(undefined);
    setUsageLabel(undefined);
    setIntentFeedback(undefined);
    setJobProgress(undefined);
    setCommandConfirm(undefined);
    setAttachmentError("");
  }, []);

  useEffect(() => {
    if (!quotaNotice?.resetsAt) {
      return;
    }
    const resetAtMs = new Date(quotaNotice.resetsAt).getTime();
    if (!Number.isFinite(resetAtMs)) {
      return;
    }
    const clearNotice = () => setQuotaNotice(undefined);
    if (resetAtMs <= Date.now()) {
      clearNotice();
      return;
    }
    const timeoutMs = Math.min(resetAtMs - Date.now(), 2_147_483_647);
    const timer = window.setTimeout(clearNotice, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [quotaNotice?.resetsAt]);

  const streamMessage = useMemo<ChatMessage | null>(() => {
    if (!debouncedStream) {
      return null;
    }
    return {
      role: "assistant",
      content: debouncedStream,
      timestamp: Date.now(),
      links: []
    };
  }, [debouncedStream]);

  const inlineThinkingOptions = useMemo(
    () => ({ awaitingResponse: isStreaming && !streamMessage }),
    [isStreaming, streamMessage]
  );

  const [thinkingRotationStep, setThinkingRotationStep] = useState(0);
  const thinkingSequence = useMemo(
    () => buildThinkingMessageSequence(intentFeedback, jobProgress, inlineThinkingOptions),
    [intentFeedback, jobProgress, inlineThinkingOptions]
  );
  const thinkingSequenceKey = thinkingSequence.join("\u0001");

  useEffect(() => {
    setThinkingRotationStep(0);
  }, [thinkingSequenceKey]);

  const thinkingMessage = useMemo(
    () => pickRotatingThinkingMessage(thinkingSequence, thinkingRotationStep),
    [thinkingSequence, thinkingRotationStep]
  );

  const visibleThinkingMessage = useMemo(
    () =>
      shouldShowThinkingIndicator(thinkingMessage, messages, streamMessage)
        ? thinkingMessage
        : undefined,
    [thinkingMessage, messages, streamMessage]
  );

  useEffect(() => {
    if (thinkingSequence.length <= 1 || !visibleThinkingMessage) {
      return;
    }
    const timer = window.setInterval(() => {
      setThinkingRotationStep((step) => step + 1);
    }, THINKING_ROTATION_STEP_MS);
    return () => window.clearInterval(timer);
  }, [thinkingSequence.length, thinkingSequenceKey, visibleThinkingMessage]);

  const isActiveChat = messages.length > 0 || Boolean(streamMessage) || isStreaming;
  const handleLaunchIntroComplete = useCallback(() => setLaunchIntroConsumed(true), []);
  const showLaunchIntro = chatHistorySynced && !isActiveChat && !launchIntroConsumed;
  const launchIntro = useLaunchTypewriter(showLaunchIntro, handleLaunchIntroComplete);
  const launchIntroDone = !chatHistorySynced || launchIntro.phase === "done";

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);

  const handleOpenFile = useCallback(
    (path: string, line?: number, options?: { preserveContext?: boolean }) => {
      post({
        type: "repo:open-file",
        payload: { path, line, preserveContext: options?.preserveContext ?? true }
      });
    },
    [post]
  );

  const handleOpenLink = useCallback(
    (url: string) => {
      post({ type: "link:open", payload: { url } });
    },
    [post]
  );

  const renderBody = useCallback(
    (content: string, relatedArtifactId?: string, messageTimestamp?: number) => {
      const card =
        messageTimestamp !== undefined
          ? patchCards.find((entry) => entry.messageTimestamp === messageTimestamp)
          : undefined;
      const showPatchCard =
        messageTimestamp !== undefined &&
        shouldRenderPatchCardForMessage(patchCards, messageTimestamp);
      const hidePatchFences =
        messageTimestamp !== undefined &&
        shouldHidePatchMarkdownForMessage(patchCards, messageTimestamp, suppressedPatchTimestamps);

      const elements: React.ReactElement[] = [];
      if (showPatchCard && card) {
        elements.push(
          <PatchCard
            key={`patch-${messageTimestamp}`}
            state={card}
            onApply={() =>
              post({ type: "patch:apply", payload: { messageTimestamp } })
            }
            onReject={() =>
              post({ type: "patch:reject", payload: { messageTimestamp } })
            }
            onUndo={() =>
              post({ type: "patch:undo", payload: { messageTimestamp } })
            }
            onOpenFile={(path) => post({ type: "patch:open-file", payload: { path } })}
          />
        );
      }
      elements.push(
        <ChatProse
          key="chat-prose"
          content={content}
          relatedArtifactId={relatedArtifactId}
          hidePatchFences={hidePatchFences}
        />
      );
      return elements;
    },
    [patchCards, post, suppressedPatchTimestamps]
  );

  const handleCopyEvidenceText = useCallback(
    (text: string, toast?: string) => {
      post({ type: "evidence:copy-text", payload: { text, toast } });
    },
    [post]
  );

  const handleComposerFollowup = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }
    setInput((current) => {
      const existing = current.trim();
      return existing ? `${existing}\n\n${prompt}` : prompt;
    });
  }, []);

  const handleEvidenceComposerFollowup = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt) {
        return;
      }
      setError("");
      setIsStreaming(true);
      setStreamingBuffer("");
      post({
        type: "chat:send",
        payload: { message: prompt }
      });
      setInput("");
      setAttachments([]);
      setMentions([]);
      setMentionResults([]);
      setMentionError("");
    },
    [post]
  );

  const handleEvidenceQuickAction = useCallback(
    (actionId: QuickActionId, targetPath?: string) => {
      const scopedPath = targetPath?.trim();
      const slashDef = SLASH_COMMANDS.find(
        (entry) => entry.target.kind === "action" && entry.target.actionId === actionId
      );
      const historyContent = slashDef
        ? slashCommandHistoryContent(slashDef, scopedPath ?? "")
        : scopedPath
          ? `/${actionId} ${scopedPath}`
          : `/${actionId}`;

      setError("");
      setIsStreaming(true);
      setStreamingBuffer("");
      post({
        type: "chat:send",
        payload: {
          message: "",
          quickAction: actionId,
          historyContent,
          targetFile: scopedPath
        }
      });
      setInput("");
      setAttachments([]);
      setMentions([]);
      setMentionResults([]);
      setMentionError("");
    },
    [post]
  );

  const evidenceActionContext = useMemo<EvidenceActionContext>(
    () => ({
      onOpenFile: handleOpenFile,
      onOpenLink: handleOpenLink,
      onComposerFollowup: handleEvidenceComposerFollowup,
      onQuickAction: handleEvidenceQuickAction,
      onOpenLightning: () => post({ type: "lightning:open" }),
      onCopyText: handleCopyEvidenceText,
      repoContext: {
        owner: context.owner,
        repo: context.repo,
        branch: context.branch,
        file: context.file
      }
    }),
    [
      context.branch,
      context.file,
      context.owner,
      context.repo,
      handleEvidenceComposerFollowup,
      handleEvidenceQuickAction,
      handleCopyEvidenceText,
      handleOpenFile,
      handleOpenLink
    ]
  );

  useEffect(() => {
    if (chatHistorySynced && isActiveChat) {
      setLaunchIntroConsumed(true);
    }
  }, [chatHistorySynced, isActiveChat]);

  const openSettings = useCallback(
    (screen?: SettingsScreen) => {
      post({ type: "ui:open-settings", payload: screen ? { screen } : undefined });
    },
    [post]
  );

  const openAdminPortal = useCallback(() => {
    handleOpenLink(ADMIN_PORTAL_URL);
  }, [handleOpenLink]);

  const requestTree = useCallback((path = "") => {
    post({ type: "repo:list", payload: { path, scope: "files" } });
  }, [post]);

  const requestRepos = useCallback(() => {
    post({ type: "repo:list", payload: { scope: "repos" } });
  }, [post]);

  const requestFileSearch = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setSearchState({ query: "", items: [] });
        return;
      }
      post({ type: "repo:search", payload: { query } });
    },
    [post]
  );

  useEffect(() => {
    const listener = (event: MessageEvent<InboundMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "theme:update":
          applyThemeMode(message.payload.mode);
          break;
        case "context:update":
          setContext(message.payload);
          if (message.payload.projectInstructions?.hasAgentsMd) {
            setDismissedAgentsNoticeFor(undefined);
          }
          break;
        case "chat:history": {
          const payload = message.payload;
          const historyMessages = Array.isArray(payload) ? payload : (payload.messages ?? []);
          const historyArtifacts = Array.isArray(payload)
            ? []
            : inlineArtifactsFromHistory(payload.artifacts);
          setMessages(historyMessages);
          setInlineArtifacts(historyArtifacts);
          setChatHistorySynced(true);
          // Do not clear isStreaming on mid-turn history echoes. Only clear when
          // the thread is emptied (new/clear chat without a stream-resume).
          if (historyMessages.length === 0) {
            setStreamingBuffer("");
            setIsStreaming(false);
            setInput("");
            setAttachments([]);
            resetEphemeralChatState();
            vscode.setState({ draftInput: "" } satisfies PersistedWebviewState);
          }
          break;
        }
        case "threads:list":
          setThreadsState(message.payload);
          break;
        case "chat:thread-changed":
          setThreadsState((prev) => {
            const next = prev
              ? {
                  ...prev,
                  activeId: message.payload.threadId,
                  activeTitle: message.payload.title
                }
              : prev;
            threadsStateRef.current = next;
            return next;
          });
          resetEphemeralChatState();
          setScrollEpoch((epoch) => epoch + 1);
          setInput("");
          setAttachments([]);
          setPendingPromptActionId(undefined);
          setIsStreaming(false);
          setStreamingBuffer("");
          setIntentFeedback(undefined);
          setJobProgress(undefined);
          setError("");
          vscode.setState({ draftInput: "" } satisfies PersistedWebviewState);
          break;
        case "lightning:state":
          setLightningState(message.payload);
          break;
        case "chat:stream-resume": {
          const activeId = threadsStateRef.current?.activeId;
          if (message.payload.threadId && activeId && message.payload.threadId !== activeId) {
            break;
          }
          setIntentFeedback(undefined);
          setIsStreaming(true);
          setStreamingBuffer(message.payload.partialText);
          break;
        }
        case "chat:delta": {
          const activeId = threadsStateRef.current?.activeId;
          if (message.payload.threadId && activeId && message.payload.threadId !== activeId) {
            break;
          }
          setIntentFeedback(undefined);
          setIsStreaming(true);
          setStreamingBuffer((prev) => prev + message.payload.chunk);
          break;
        }
        case "chat:complete": {
          const activeId = threadsStateRef.current?.activeId;
          if (message.payload.threadId && activeId && message.payload.threadId !== activeId) {
            break;
          }
          setMessages((prev) => [...prev, message.payload.message]);
          setIntentFeedback(undefined);
          setJobProgress((current) =>
            current?.deliverable === "standalone" ? current : undefined
          );
          setStreamingBuffer("");
          setIsStreaming(false);
          break;
        }
        case "chat:error": {
          const activeId = threadsStateRef.current?.activeId;
          if (message.payload.threadId && activeId && message.payload.threadId !== activeId) {
            break;
          }
          setIntentFeedback(undefined);
          setJobProgress((current) =>
            current?.deliverable === "standalone" ? current : undefined
          );
          setError(message.payload.message);
          setIsStreaming(false);
          setStreamingBuffer("");
          break;
        }
        case "chat:quota-exceeded":
          setIntentFeedback(undefined);
          setJobProgress((current) =>
            current?.deliverable === "standalone" ? current : undefined
          );
          setError("");
          setQuotaNotice({
            resetsAt: message.payload.resetsAt,
            upgradeUrl: message.payload.upgradeUrl,
            timezone: message.payload.timezone
          });
          setIsStreaming(false);
          setStreamingBuffer("");
          break;
        case "chat:quota-cleared":
          setQuotaNotice(undefined);
          break;
        case "repo:tree":
          setTreeState({
            path: message.payload.path,
            items: message.payload.items,
            scope: message.payload.scope ?? "files",
            error: message.payload.error,
            stale: message.payload.stale,
            provider: message.payload.provider,
            loading: message.payload.loading,
            emptyHint: message.payload.emptyHint,
            listLabel: message.payload.listLabel
          });
          break;
        case "repo:search-results":
          setSearchState({
            query: message.payload.query,
            items: message.payload.items,
            error: message.payload.error,
            loading: message.payload.loading
          });
          break;
        case "mention:results":
          setMentionLoading(Boolean(message.payload.loading));
          if (message.payload.loading) {
            setMentionError("");
            setMentionHint("");
            setMentionResults([]);
          } else {
            setMentionError(message.payload.error ?? "");
            setMentionHint(message.payload.hint ?? "");
            setMentionResults(message.payload.items);
          }
          break;
        case "intent:feedback":
          if (message.payload.status === "complete") {
            setIntentFeedback(undefined);
            break;
          }
          setIntentFeedback(message.payload);
          break;
        case "conflict:update":
          setConflictState(message.payload);
          break;
        case "patch:update": {
          const payload = message.payload;
          if (payload && typeof payload === "object" && "cards" in payload && Array.isArray(payload.cards)) {
            setPatchCards(payload.cards);
            if (Array.isArray(payload.suppressedMessageTimestamps)) {
              setSuppressedPatchTimestamps(payload.suppressedMessageTimestamps);
            } else {
              setSuppressedPatchTimestamps(
                payload.cards
                  .map((card) => card.messageTimestamp)
                  .filter((value): value is number => typeof value === "number")
              );
            }
          } else if (payload && typeof payload === "object" && "status" in payload) {
            // Legacy single-card payload
            const card = payload as PatchCardState;
            if (card.messageTimestamp !== undefined) {
              const timestamp = card.messageTimestamp;
              setPatchCards((current) => {
                const without = current.filter((entry) => entry.messageTimestamp !== timestamp);
                return shouldRenderPatchCardForMessage([card], timestamp)
                  ? [...without, card]
                  : without;
              });
            }
          }
          break;
        }
        case "degradation:notification":
          setDegradationNotification(message.payload);
          break;
        case "trace:autoload":
          setInput(message.payload.message);
          break;
        case "command:confirm":
          setIsStreaming(false);
          setStreamingBuffer("");
          setCommandConfirm(message.payload);
          break;
        case "decision:timeline":
          setIntentFeedback(undefined);
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `decision-${Date.now()}-${current.length}`,
              kind: "decision",
              timestamp: Date.now(),
              timeline: message.payload.timeline
            }
          ]);
          break;
        case "ownership:card":
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `ownership-${Date.now()}-${current.length}`,
              kind: "ownership",
              timestamp: Date.now(),
              report: message.payload.report,
              slackSearch: message.payload.slackSearch
            }
          ]);
          break;
        case "repo-summary:card":
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `repo-summary-${Date.now()}-${current.length}`,
              kind: "repo-summary",
              timestamp: Date.now(),
              evidence: message.payload.evidence,
              owner: message.payload.owner,
              repo: message.payload.repo,
              branch: message.payload.branch
            }
          ]);
          break;
        case "blast-radius:card":
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `blast-radius-${Date.now()}-${current.length}`,
              kind: "blast-radius",
              timestamp: Date.now(),
              evidence: message.payload.evidence,
              file: message.payload.file
            }
          ]);
          break;
        case "knowledge-gaps:card":
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `knowledge-gaps-${Date.now()}-${current.length}`,
              kind: "knowledge-gaps",
              timestamp: Date.now(),
              evidence: message.payload.evidence,
              confluence: message.payload.confluence,
              jira: message.payload.jira,
              slack: message.payload.slack,
              notion: message.payload.notion,
              googleDocs: message.payload.googleDocs,
              teams: message.payload.teams,
              file: message.payload.file
            }
          ]);
          break;
        case "integration:card":
          setInlineArtifacts((current) => [
            ...current,
            {
              id: message.payload.artifactId ?? `integration-${Date.now()}-${current.length}`,
              kind: "integration",
              timestamp: Date.now(),
              provider: message.payload.provider,
              evidence: message.payload.evidence as Record<string, unknown>
            }
          ]);
          break;
        case "job:progress":
          setJobProgress(message.payload);
          break;
        case "job:complete":
          if (message.payload.deliverable !== "chat") {
            setJobProgress(message.payload);
          }
          break;
        case "chat:usage":
          setUsageLabel(
            `~$${message.payload.estimatedCostUsd.toFixed(4)} (${message.payload.inputTokens}+${message.payload.outputTokens} tok) · session $${message.payload.sessionCostUsd.toFixed(4)}`
          );
          break;
        case "prompts:list":
          setPromptLibrary(message.payload);
          break;
        case "prompts:insert":
          setInput(message.payload.text);
          setPendingPromptActionId(message.payload.actionId as QuickActionId | undefined);
          setPromptMenuOpen(false);
          setPromptModalOpen(false);
          vscode.setState({ draftInput: message.payload.text } satisfies PersistedWebviewState);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
    post({ type: "webview-ready" });
    post({ type: "lightning:ready" });
    return () => window.removeEventListener("message", listener);
  }, [post]);

  useEffect(() => {
    vscode.setState({ draftInput: input } satisfies PersistedWebviewState);
  }, [input, vscode]);

  const submitPrompt = useCallback(
    (
      prompt: string,
      quickAction?: QuickActionId,
      pendingAttachments: ChatImageAttachment[] = attachments,
      pendingMentions: ChatFileMention[] = mentions,
      options?: { slashUserArgs?: string }
    ) => {
      const message = prompt.trim();
      if (!message && pendingAttachments.length === 0 && pendingMentions.length === 0 && !quickAction) {
        return;
      }
      if (message.length > INPUT_MAX) {
        setError(`Prompt exceeds ${INPUT_MAX} characters.`);
        return;
      }
      setError("");
      setAttachmentError("");
      setIsStreaming(true);
      setStreamingBuffer("");
      post({
        type: "chat:send",
        payload: {
          message,
          quickAction,
          slashUserArgs: options?.slashUserArgs,
          attachments: pendingAttachments.length ? pendingAttachments : undefined,
          mentions: pendingMentions.length ? pendingMentions.slice(0, 3) : undefined
        }
      });
      setInput("");
      setAttachments([]);
      setMentions([]);
      setMentionResults([]);
      setMentionError("");
      setPendingPromptActionId(undefined);
    },
    [attachments, mentions, post]
  );

  const handleMentionSearch = useCallback(
    (pattern: string) => {
      setMentionLoading(true);
      setMentionError("");
      post({ type: "mention:search", payload: { pattern } });
    },
    [post]
  );

  const handleSend = useCallback(() => {
    if (pendingPromptActionId) {
      const plan = resolvePromptLibraryRun(input, pendingPromptActionId);
      switch (plan.kind) {
        case "quick-action":
          submitPrompt("", plan.actionId, attachments, mentions, { slashUserArgs: plan.slashUserArgs });
          return;
        case "chat":
          submitPrompt(plan.message);
          return;
        case "slash":
          submitPrompt(input);
          return;
      }
    }
    submitPrompt(input);
  }, [attachments, input, mentions, pendingPromptActionId, submitPrompt]);

  const insertPromptLibraryEntry = useCallback(
    (id: string) => {
      post({
        type: "prompts:run",
        payload: {
          id,
          composerText: input.trim() || undefined
        }
      });
    },
    [input, post]
  );

  const handlePanelDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (isStreaming) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest(".coop-composer")) {
        return;
      }
      event.preventDefault();
      try {
        const incoming = await attachmentsFromDataTransfer(event.dataTransfer);
        if (!incoming.length) {
          return;
        }
        setAttachmentError("");
        setAttachments((current) => mergeAttachments(current, incoming, setAttachmentError));
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : "Could not attach file.");
      }
    },
    [isStreaming]
  );

  const handleQuickAction = useCallback(
    (actionId: QuickActionId, prompt: string) => {
      submitPrompt(prompt, actionId);
    },
    [submitPrompt]
  );

  const insertSlashCommand = useCallback(
    (command: string) => {
      launchIntro.skip();
      setLaunchIntroConsumed(true);
      setInput(`/${command} `);
    },
    [launchIntro]
  );

  const dismissJobProgress = useCallback(() => setJobProgress(undefined), []);
  const cancelJob = useCallback((jobId: string) => post({ type: "job:cancel", payload: { jobId } }), [post]);
  const viewJobResults = useCallback(
    (jobId: string) => post({ type: "job:view-results", payload: { jobId } }),
    [post]
  );

  const handleRunCommand = useCallback(() => {
    setCommandConfirm((pending) => {
      if (!pending) {
        return undefined;
      }
      setError("");
      setIsStreaming(true);
      setStreamingBuffer("");
      post({ type: "chat:send", payload: pending.run });
      return undefined;
    });
  }, [post]);

  const handleStopStreaming = useCallback(() => {
    post({ type: "chat:stream-cancel" });
    setIsStreaming(false);
    setStreamingBuffer("");
  }, [post]);

  const syncExplorerRepoFromContext = useCallback(() => {
    const owner = context.owner?.trim();
    const repo = context.repo?.trim();
    if (!owner || !repo) {
      explorerRepoRef.current = null;
      return;
    }
    explorerRepoRef.current = {
      provider: context.provider ?? "github",
      owner,
      repo
    };
  }, [context.owner, context.provider, context.repo]);

  const toggleExplorer = useCallback(() => {
    setIsExplorerOpen((prev) => {
      const next = !prev;
      if (next) {
        if (context.owner && context.repo) {
          syncExplorerRepoFromContext();
          requestTree("");
        } else {
          explorerRepoRef.current = null;
          requestRepos();
        }
      }
      return next;
    });
  }, [context.owner, context.repo, requestRepos, requestTree, syncExplorerRepoFromContext]);

  const openExplorer = useCallback(() => {
    setIsExplorerOpen(true);
    if (context.owner && context.repo) {
      syncExplorerRepoFromContext();
      requestTree("");
    } else {
      explorerRepoRef.current = null;
      requestRepos();
    }
  }, [context.owner, context.repo, requestRepos, requestTree, syncExplorerRepoFromContext]);

  const closeExplorer = useCallback(() => {
    explorerRepoRef.current = null;
    setIsExplorerOpen(false);
    setSearchState({ query: "", items: [] });
  }, []);

  const rememberExplorerRepo = useCallback((repoPath: string): boolean => {
    const parsed = parseRepoNodePath(repoPath);
    if (!parsed) {
      return false;
    }
    explorerRepoRef.current = parsed;
    return true;
  }, []);

  const postRepoSelect = useCallback(
    (repoPath: string) => {
      const parsed = parseRepoNodePath(repoPath);
      if (!parsed) {
        return false;
      }
      post({
        type: "repo:select",
        payload: {
          provider: parsed.provider,
          owner: parsed.owner,
          repo: parsed.repo
        }
      });
      return true;
    },
    [post]
  );

  const handleBrowseRepo = useCallback(
    (repoPath: string) => {
      if (!rememberExplorerRepo(repoPath) || !postRepoSelect(repoPath)) {
        return;
      }
      setSearchState({ query: "", items: [] });
      requestTree("");
    },
    [postRepoSelect, rememberExplorerRepo, requestTree]
  );

  const handleUseRepo = useCallback(
    (repoPath: string) => {
      if (!rememberExplorerRepo(repoPath) || !postRepoSelect(repoPath)) {
        return;
      }
      closeExplorer();
    },
    [closeExplorer, postRepoSelect, rememberExplorerRepo]
  );

  const addFileMention = useCallback((filePath: string, repoId: string) => {
    setMentions((current) =>
      appendFileMention(current, { repoId, path: filePath, source: "indexed" })
    );
  }, []);

  const handleSelectFileFromExplorer = useCallback(
    (filePath: string) => {
      const browse = explorerRepoRef.current;
      const provider = browse?.provider ?? context.provider ?? "github";
      const owner = (browse?.owner ?? context.owner)?.trim();
      const repo = (browse?.repo ?? context.repo)?.trim();
      if (owner && repo) {
        addFileMention(filePath, `${provider}:${owner}/${repo}`);
      }
      handleOpenFile(filePath, undefined, { preserveContext: false });
    },
    [addFileMention, context.owner, context.provider, context.repo, handleOpenFile]
  );

  const requestReposForExplorer = useCallback(() => {
    explorerRepoRef.current = null;
    requestRepos();
  }, [requestRepos]);

  const handleConflictAction = useCallback(
    (conflictId: string, action: ConflictActionId) => {
      post({ type: "conflict:action", payload: { conflictId, action } });
      if (action === "dismiss") {
        setConflictState((current) =>
          current
            ? {
                ...current,
                conflicts: current.conflicts.filter((conflict) => conflict.id !== conflictId)
              }
            : current
        );
      }
    },
    [post]
  );

  const conflictCount = conflictState?.conflicts.length ?? 0;
  const openPromptLibrary = useCallback(() => {
    setPromptMenuOpen(false);
    setPromptModalOpen(true);
  }, []);

  const composerInner = (
    <div className="relative">
      {isExplorerOpen ? (
        <RemoteExplorer
          open
          className="coop-explorer-shell--overlay absolute bottom-full left-0 right-0 z-30 mb-2 w-full"
          context={context}
          treeState={treeState}
          searchState={searchState}
          onClose={closeExplorer}
          onRefresh={(path) => requestTree(path)}
          onRefreshRepos={requestReposForExplorer}
          onBrowseRepos={requestReposForExplorer}
          onExpand={(path) => requestTree(path)}
          onSearch={requestFileSearch}
          onSelectFile={handleSelectFileFromExplorer}
          onBrowseRepo={handleBrowseRepo}
          onUseRepo={handleUseRepo}
          onOpenSettings={openSettings}
          onOpenAdminPortal={openAdminPortal}
        />
      ) : null}
      <ChatComposer
        value={input}
        maxLength={INPUT_MAX}
        isStreaming={isStreaming}
        submitDisabled={Boolean(quotaNotice)}
        variant={isActiveChat ? "chat" : "landing"}
        usageLabel={usageLabel}
        attachments={attachments}
        attachmentError={attachmentError}
        mentions={mentions}
        onMentionsChange={setMentions}
        onMentionSearch={handleMentionSearch}
        mentionResults={mentionResults}
        mentionLoading={mentionLoading}
        mentionError={mentionError}
        mentionHint={mentionHint}
        onChange={setInput}
        onAttachmentsChange={setAttachments}
        onAttachmentError={setAttachmentError}
        onSend={handleSend}
        onStop={handleStopStreaming}
        onToggleExplorer={toggleExplorer}
        launchIntroPhase={launchIntro.phase}
        launchIntroVisibleLength={launchIntro.visibleLength}
        launchIntroFlashIndex={launchIntro.flashIndex}
        onLaunchIntroSkip={launchIntro.skip}
      />
    </div>
  );

  const composerStack = (
    <>
      {shouldPromptForAgentsMd(context.projectInstructions) &&
      dismissedAgentsNoticeFor !== (context.projectInstructions?.gitRoot ?? "workspace") ? (
        <ProjectInstructionsNotice
          state={context.projectInstructions}
          onAttach={() => post({ type: "agents:attach" })}
          onStartFromTemplate={() => post({ type: "agents:start-from-template" })}
          onDismiss={() =>
            setDismissedAgentsNoticeFor(context.projectInstructions?.gitRoot ?? "workspace")
          }
          className="mb-2"
        />
      ) : null}
      {commandConfirm ? (
        <CoopNotice
          tone="info"
          title={commandConfirm.title}
          message={commandConfirm.message}
          className="mb-1"
          onDismiss={() => setCommandConfirm(undefined)}
          dismissLabel="Cancel"
        >
          <div className="mt-2">
            <button type="button" className="coop-settings-action-btn" onClick={handleRunCommand}>
              Run
            </button>
          </div>
        </CoopNotice>
      ) : null}
      <div className="relative mb-1 flex items-center gap-2">
        <PromptLibraryPill
          prompts={promptLibrary.prompts}
          pinnedIds={promptLibrary.pinnedIds}
          hasWorkspace={promptLibrary.hasWorkspace}
          disabled={isStreaming}
          open={promptMenuOpen}
          onOpenChange={setPromptMenuOpen}
          onRun={insertPromptLibraryEntry}
          onSeeAll={openPromptLibrary}
        />
        <AgentsMdStatusChip
          state={context.projectInstructions}
          disabled={isStreaming}
          onCreate={() => post({ type: "agents:start-from-template" })}
          onOpen={() => post({ type: "agents:open" })}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {promptLibrary.hasWorkspace && input.trim() && !isStreaming ? (
            <button
              type="button"
              className="coop-text-btn shrink-0"
              onClick={() => {
                setSavePromptDraft({ title: "", template: input.trim() });
                setSavePromptOpen(true);
              }}
            >
              Save to library
            </button>
          ) : null}
          {context.file || context.fileSource === "external" || (context.owner && context.repo) ? (
            <ContextScopeLabel
              context={context}
              onOpenExplorer={openExplorer}
              onOpenFile={
                context.file
                  ? () => {
                      if (context.file) {
                        handleOpenFile(context.file, undefined, { preserveContext: false });
                      }
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>
      {composerInner}
    </>
  );

  return (
    <div
      className="coop-panel coop-canvas-bg flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-[var(--coop-panel-foreground)]"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        void handlePanelDrop(event);
      }}
    >
      <CitationNavigationProvider>
      <ChatLinkProvider onOpenFile={handleOpenFile} onOpenLink={handleOpenLink}>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--coop-composer-border)] px-3 py-2">
        {threadsState ? (
          <ThreadHeaderSwitcher
            activeId={threadsState.activeId}
            activeTitle={threadsState.activeTitle}
            threads={threadsState.threads}
            onSelect={(threadId) => post({ type: "threads:switch", payload: { threadId } })}
            onNewThread={() => post({ type: "threads:new" })}
          />
        ) : null}
        {lightningState && !lightningState.canUseLightning ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ProUpgradeChip onClick={() => post({ type: "lightning:upgrade" })} />
          </div>
        ) : null}
      </div>
      <p className="coop-panel-narrow-notice" role="status">
        Widen the sidebar for the best experience.
      </p>
      {isActiveChat ? (
        <>
          <ChatStream
            messages={messages}
            artifacts={inlineArtifacts}
            streamingMessage={streamMessage}
            thinkingMessage={visibleThinkingMessage}
            endRef={messageEndRef}
            renderBody={renderBody}
            actionContext={evidenceActionContext}
            conflicts={conflictState?.conflicts}
            scrollEpoch={scrollEpoch}
          />
          <DegradationNotification
            compact
            notification={degradationNotification}
            onDismiss={() => setDegradationNotification(undefined)}
            onRefresh={(feature) => {
              post({ type: "degradation:refresh", payload: { feature } });
              setDegradationNotification(undefined);
            }}
            onOpenSettings={openSettings}
          />
          {conflictState?.conflicts.length ? (
            <div className="max-h-[35%] shrink-0 overflow-y-auto border-t border-[var(--coop-composer-border)] py-2">
              <ConflictResolution
                state={conflictState}
                onDismiss={(conflictId) => handleConflictAction(conflictId, "dismiss")}
                onAction={handleConflictAction}
              />
            </div>
          ) : null}
          <ChatFooter
            error={error}
            onDismissError={() => setError("")}
            quotaNotice={quotaNotice}
            onDismissQuotaNotice={() => setQuotaNotice(undefined)}
            contextWarning={context.contextWarning}
            onDismissContextWarning={() => post({ type: "context:dismiss-warning" })}
            intentFeedback={intentFeedback}
            onDismissIntent={() => setIntentFeedback(undefined)}
            jobProgress={jobProgress}
            onDismissJob={dismissJobProgress}
            onCancelJob={cancelJob}
            onViewJobResults={viewJobResults}
            conflictCount={conflictCount}
            hideInlineActivity
            inlineThinkingOptions={inlineThinkingOptions}
          >
            {composerStack}
          </ChatFooter>
        </>
      ) : (
        <>
          {error ? (
            <CoopNotice
              tone="error"
              message={error}
              onDismiss={() => setError("")}
              className="mx-3 mb-2"
            />
          ) : null}
          <DegradationNotification
            notification={degradationNotification}
            onDismiss={() => setDegradationNotification(undefined)}
            onRefresh={(feature) => {
              post({ type: "degradation:refresh", payload: { feature } });
              setDegradationNotification(undefined);
            }}
            onOpenSettings={openSettings}
          />
          {inlineArtifacts.length > 0 ? (
            <div className="no-scrollbar mx-3 mb-2 max-h-[45vh] shrink-0 space-y-2 overflow-y-auto">
              {inlineArtifacts.map((artifact) => (
                <div key={artifact.id}>
                  {renderInlineArtifact(
                    artifact,
                    () => setInlineArtifacts((current) => current.filter((entry) => entry.id !== artifact.id)),
                    evidenceActionContext,
                    conflictState?.conflicts
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {visibleThinkingMessage && !isActiveChat ? (
            <div className="mx-3 mb-2">
              <ChatThinkingIndicator message={visibleThinkingMessage} />
            </div>
          ) : null}
          <IntentFeedback
            state={intentFeedback}
            onDismiss={() => setIntentFeedback(undefined)}
            onRefreshContext={() => {
              setIntentFeedback({
                status: "loading",
                actionId: "trace-decision",
                title: "Refreshing trace",
                message: "Clearing cache and re-fetching from GitHub…",
                progress: 20
              });
              post({ type: "degradation:refresh", payload: { retrace: true } });
            }}
          />
          <ConflictResolution
            state={conflictState}
            onDismiss={(conflictId) => handleConflictAction(conflictId, "dismiss")}
            onAction={handleConflictAction}
          />
          <EmptyState
            context={context}
            disabled={isStreaming}
            onAction={handleQuickAction}
            onSlashCommand={insertSlashCommand}
            launchIntroDone={launchIntroDone}
            onAttachAgentsMd={() => post({ type: "agents:attach" })}
            onStartFromAgentsMdTemplate={() => post({ type: "agents:start-from-template" })}
          />
          <div className="relative z-20 shrink-0 pb-2">
            <p
              className={`coop-launch-sync-whisper px-3 pb-1${
                launchIntro.showSyncWhisper ? " coop-launch-sync-whisper--visible" : ""
              }`}
              aria-live="polite"
            >
              Syncing context…
            </p>
            <ChatActivityStrip
              contextWarning={context.contextWarning}
              jobProgress={jobProgress}
              onDismissJob={dismissJobProgress}
              onCancelJob={cancelJob}
              onViewJobResults={viewJobResults}
              intentFeedback={intentFeedback}
              onDismissIntent={() => setIntentFeedback(undefined)}
              hideInlineActivity={Boolean(visibleThinkingMessage)}
              inlineThinkingOptions={inlineThinkingOptions}
            />
            <div className="px-3">{composerStack}</div>
          </div>
        </>
      )}
      <PromptLibraryModal
        open={promptModalOpen}
        prompts={promptLibrary.prompts}
        pinnedIds={promptLibrary.pinnedIds}
        hasWorkspace={promptLibrary.hasWorkspace}
        onClose={() => setPromptModalOpen(false)}
        onRun={(id) => {
          insertPromptLibraryEntry(id);
        }}
        onCommit={(payload) =>
          post({
            type: "prompts:commit",
            payload: {
              prompts: payload.prompts.map((prompt) => ({
                id: prompt.id,
                title: prompt.title,
                template: prompt.template ?? "",
                actionId: prompt.actionId
              })),
              pinnedIds: payload.pinnedIds
            }
          })
        }
      />
      {savePromptOpen ? (
        <PromptDetailOverlay
          headerTitle="Save to library"
          draft={savePromptDraft}
          onChange={setSavePromptDraft}
          onDiscard={() => setSavePromptOpen(false)}
          onSave={() => {
            const title = savePromptDraft.title.trim();
            const template = savePromptDraft.template.trim();
            if (!title || !template) {
              return;
            }
            const actionId = inferActionIdFromTemplate(template);
            post({
              type: "prompts:save",
              payload: {
                title,
                template,
                ...(actionId ? { actionId } : {})
              }
            });
            setSavePromptOpen(false);
            setInput("");
          }}
        />
      ) : null}
      <PanelWidthEnforcer vscode={vscode} />
      </ChatLinkProvider>
      </CitationNavigationProvider>
    </div>
  );
}
