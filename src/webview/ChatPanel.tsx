import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SettingsScreen } from "../chat/settingsScreens";
import { ActiveFileLabel } from "./components/ActiveFileLabel";
import { ChatActivityStrip } from "./components/ChatActivityStrip";
import { CoopNotice } from "./components/CoopNotice";
import { ChatComposer } from "./components/ChatComposer";
import { ChatStream, ChatMessage, type ChatInlineArtifact } from "./components/ChatStream";
import { ChatProse } from "./components/ChatProse";
import { ChatLinkProvider } from "./components/ChatLinkContext";
import { EmptyState } from "./components/EmptyState";
import { ConflictResolution } from "./ConflictResolution";
import { DegradationNotification } from "./DegradationNotification";
import { IntentFeedback } from "./IntentFeedback";
import { applyThemeMode } from "./theme";
import { QuickActionId } from "./types";
import { PromptLibraryModal } from "./components/PromptLibraryModal";
import { PanelWidthEnforcer } from "./components/PanelWidthEnforcer";
import { ThreadHeaderSwitcher, type ThreadListItem } from "./components/ThreadHeaderSwitcher";
import { PromptLibraryPill } from "./components/PromptLibraryPill";
import type { PromptLibraryItem } from "./components/promptLibraryTypes";
import { RemoteExplorer, parseRepoNodePath } from "./RemoteExplorer";
import { AutocompleteStatus, type AutocompleteBadgeStatus } from "./AutocompleteStatus";
import { DecisionTimeline, type DecisionTimelinePayload } from "./DecisionTimeline";
import type { OwnershipCardPayload } from "./OwnershipCard";
import type { LightningModeState } from "../indexing/lightningTypes";
import { LightningModePanel, LightningStatusBadge } from "./LightningModePanel";
import type { ChatImageAttachment } from "../chat/types";
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
  | { type: "chat:history"; payload: ChatMessage[] }
  | { type: "chat:delta"; payload: { chunk: string } }
  | { type: "chat:complete"; payload: { message: ChatMessage } }
  | { type: "chat:error"; payload: { message: string } }
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
  | { type: "degradation:notification"; payload: DegradationNotificationPayload }
  | { type: "trace:autoload"; payload: { message: string } }
  | {
      type: "command:confirm";
      payload: {
        title: string;
        message: string;
        run: { message: string; quickAction: string; attachments?: ChatImageAttachment[] };
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
  | {
      type: "autocomplete:status";
      payload: {
        status: AutocompleteBadgeStatus;
        message?: string;
        suggestionIndex?: number;
        suggestionCount?: number;
        latencyMs?: number;
        previewText?: string;
      };
    }
  | { type: "decision:timeline"; payload: { timeline: DecisionTimelinePayload } }
  | { type: "ownership:card"; payload: { report: OwnershipCardPayload } }
  | {
      type: "threads:list";
      payload: { activeId: string; activeTitle: string; threads: ThreadListItem[] };
    }
  | { type: "chat:thread-changed"; payload: { threadId: string; title: string } }
  | { type: "lightning:open" }
  | { type: "lightning:state"; payload: LightningModeState };

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
  contextWarning,
  onDismissContextWarning,
  intentFeedback,
  onDismissIntent,
  jobProgress,
  onDismissJob,
  onCancelJob,
  onViewJobResults,
  conflictCount,
  children
}: {
  error: string;
  onDismissError: () => void;
  contextWarning?: string;
  onDismissContextWarning?: () => void;
  intentFeedback?: IntentFeedbackState;
  onDismissIntent: () => void;
  jobProgress?: JobProgressState;
  onDismissJob: () => void;
  onCancelJob?: (jobId: string) => void;
  onViewJobResults?: (jobId: string) => void;
  conflictCount: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <footer className="chat-footer">
      <ChatActivityStrip
        error={error || undefined}
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
      />
      <div className="chat-footer-inner">{children}</div>
    </footer>
  );
}

export function ChatPanel({ vscode }: ChatPanelProps): React.ReactElement {
  const cached = (vscode.getState() as PersistedWebviewState | null) || null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<RepoContext>({});
  const [input, setInput] = useState(cached?.draftInput || "");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [error, setError] = useState("");
  const [streamingBuffer, setStreamingBuffer] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [treeState, setTreeState] = useState<{
    path: string;
    items: RemoteTreeNode[];
    scope?: "repos" | "files";
    error?: string;
    stale?: boolean;
    provider?: "github" | "gitlab" | "bitbucket";
    loading?: boolean;
  }>({ path: "", items: [], scope: "files" });
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
    run: { message: string; quickAction: string; attachments?: ChatImageAttachment[] };
  } | undefined>();
  const [conflictState, setConflictState] = useState<ConflictResolutionState | undefined>();
  const [degradationNotification, setDegradationNotification] = useState<DegradationNotificationPayload | undefined>();
  const [usageLabel, setUsageLabel] = useState<string | undefined>();
  const [promptLibrary, setPromptLibrary] = useState<{
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  }>({ prompts: [], pinnedIds: [], hasWorkspace: false });
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [autocompleteStatus, setAutocompleteStatus] = useState<AutocompleteBadgeStatus>("disabled");
  const [autocompleteMessage, setAutocompleteMessage] = useState<string | undefined>();
  const [inlineArtifacts, setInlineArtifacts] = useState<ChatInlineArtifact[]>([]);
  const [threadsState, setThreadsState] = useState<{
    activeId: string;
    activeTitle: string;
    threads: ThreadListItem[];
  } | null>(null);
  const [lightningState, setLightningState] = useState<LightningModeState | null>(null);
  const [lightningPanelOpen, setLightningPanelOpen] = useState(false);
  const [chatHistorySynced, setChatHistorySynced] = useState(false);
  const [launchIntroConsumed, setLaunchIntroConsumed] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const debouncedStream = useDebouncedProse(streamingBuffer, 75);

  const resetEphemeralChatState = useCallback(() => {
    setStreamingBuffer("");
    setIsStreaming(false);
    setError("");
    setInlineArtifacts([]);
    setUsageLabel(undefined);
    setIntentFeedback(undefined);
    setJobProgress(undefined);
    setCommandConfirm(undefined);
    setAttachmentError("");
  }, []);

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

  const isActiveChat = messages.length > 0 || Boolean(streamMessage) || isStreaming;
  const handleLaunchIntroComplete = useCallback(() => setLaunchIntroConsumed(true), []);
  const showLaunchIntro = chatHistorySynced && !isActiveChat && !launchIntroConsumed;
  const launchIntro = useLaunchTypewriter(showLaunchIntro, handleLaunchIntroComplete);
  const launchIntroDone = chatHistorySynced && launchIntro.phase === "done";

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);
  const handleOpenFile = useCallback(
    (path: string, line?: number) => {
      post({ type: "repo:open-file", payload: { path, line, focus: true } });
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
    (content: string) => [<ChatProse key="chat-prose" content={content} />],
    []
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
          break;
        case "chat:history":
          setMessages(message.payload);
          setChatHistorySynced(true);
          setStreamingBuffer("");
          setIsStreaming(false);
          if (message.payload.length === 0) {
            setInput("");
            setAttachments([]);
            resetEphemeralChatState();
            vscode.setState({ draftInput: "" } satisfies PersistedWebviewState);
          }
          break;
        case "threads:list":
          setThreadsState(message.payload);
          break;
        case "chat:thread-changed":
          resetEphemeralChatState();
          setInput("");
          setAttachments([]);
          vscode.setState({ draftInput: "" } satisfies PersistedWebviewState);
          break;
        case "lightning:open":
          setLightningPanelOpen(true);
          break;
        case "lightning:state":
          setLightningState(message.payload);
          break;
        case "chat:delta":
          setIsStreaming(true);
          setStreamingBuffer((prev) => prev + message.payload.chunk);
          break;
        case "chat:complete":
          setMessages((prev) => [...prev, message.payload.message]);
          setJobProgress((current) =>
            current?.deliverable === "standalone" ? current : undefined
          );
          setStreamingBuffer("");
          setIsStreaming(false);
          break;
        case "chat:error":
          setJobProgress((current) =>
            current?.deliverable === "standalone" ? current : undefined
          );
          setError(message.payload.message);
          setIsStreaming(false);
          setStreamingBuffer("");
          break;
        case "repo:tree":
          setTreeState({
            path: message.payload.path,
            items: message.payload.items,
            scope: message.payload.scope ?? "files",
            error: message.payload.error,
            stale: message.payload.stale,
            provider: message.payload.provider,
            loading: message.payload.loading
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
        case "intent:feedback":
          setIntentFeedback(message.payload);
          if (message.payload.status === "complete") {
            window.setTimeout(() => {
              setIntentFeedback((current) => current === message.payload ? undefined : current);
            }, 2500);
          }
          break;
        case "conflict:update":
          setConflictState(message.payload);
          break;
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
              id: `decision-${Date.now()}-${current.length}`,
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
              id: `ownership-${Date.now()}-${current.length}`,
              kind: "ownership",
              timestamp: Date.now(),
              report: message.payload.report
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
        case "autocomplete:status":
          setAutocompleteStatus(message.payload.status);
          setAutocompleteMessage(message.payload.message);
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
    if (isActiveChat) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, streamMessage, isActiveChat]);

  useEffect(() => {
    vscode.setState({ draftInput: input } satisfies PersistedWebviewState);
  }, [input, vscode]);

  const submitPrompt = useCallback(
    (prompt: string, quickAction?: QuickActionId, pendingAttachments: ChatImageAttachment[] = attachments) => {
      const message = prompt.trim();
      if (!message && pendingAttachments.length === 0) {
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
          attachments: pendingAttachments.length ? pendingAttachments : undefined
        }
      });
      setInput("");
      setAttachments([]);
    },
    [attachments, post]
  );

  const handleSend = useCallback(() => submitPrompt(input), [input, submitPrompt]);

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
        setAttachmentError(error instanceof Error ? error.message : "Could not attach image.");
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

  const toggleExplorer = useCallback(() => {
    setIsExplorerOpen((prev) => {
      const next = !prev;
      if (next) {
        if (isActiveChat) {
          requestRepos();
        } else if (context.owner && context.repo) {
          requestTree(treeState.path || "");
        } else {
          requestRepos();
        }
      }
      return next;
    });
  }, [context.owner, context.repo, isActiveChat, requestRepos, requestTree, treeState.path]);

  const handleSelectRepo = useCallback(
    (repoPath: string) => {
      const parsed = parseRepoNodePath(repoPath);
      if (!parsed) {
        return;
      }
      const payload = {
        provider: parsed.provider,
        owner: parsed.owner,
        repo: parsed.repo
      };
      const switchingRepo =
        parsed.owner !== context.owner ||
        parsed.repo !== context.repo ||
        parsed.provider !== (context.provider ?? treeState.provider);
      if (isActiveChat && switchingRepo) {
        post({ type: "repo:open-repo", payload });
        setIsExplorerOpen(false);
        return;
      }
      post({ type: "repo:select", payload });
    },
    [context.owner, context.repo, context.provider, isActiveChat, post, treeState.provider]
  );

  const handleCopyOwnershipDraft = useCallback(
    (text: string) => {
      post({ type: "ownership:copy-draft", payload: { text } });
    },
    [post]
  );

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
          onClose={() => {
            setIsExplorerOpen(false);
            setSearchState({ query: "", items: [] });
          }}
          onRefresh={(path) => requestTree(path)}
          onRefreshRepos={requestRepos}
          onBrowseRepos={requestRepos}
          onExpand={(path) => requestTree(path)}
          onSearch={requestFileSearch}
          onSelectFile={(path) => post({ type: "repo:open-file", payload: { path } })}
          onSelectRepo={handleSelectRepo}
          onOpenSettings={openSettings}
        />
      ) : null}
      <ChatComposer
        value={input}
        maxLength={INPUT_MAX}
        isStreaming={isStreaming}
        variant={isActiveChat ? "chat" : "landing"}
        usageLabel={usageLabel}
        attachments={attachments}
        attachmentError={attachmentError}
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
          onRun={(id) => post({ type: "prompts:run", payload: { id } })}
          onSeeAll={openPromptLibrary}
        />
        {context.file ? (
          <ActiveFileLabel
            filePath={context.file}
            onOpen={() => post({ type: "repo:open-file", payload: { path: context.file!, focus: true } })}
          />
        ) : null}
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
      <ChatLinkProvider onOpenFile={handleOpenFile} onOpenLink={handleOpenLink}>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--coop-composer-border)] px-3 py-2">
        {threadsState ? (
          <ThreadHeaderSwitcher
            activeId={threadsState.activeId}
            activeTitle={threadsState.activeTitle}
            threads={threadsState.threads}
            disabled={isStreaming}
            onSelect={(threadId) => post({ type: "threads:switch", payload: { threadId } })}
            onNewThread={() => post({ type: "threads:new" })}
          />
        ) : null}
        <div className={threadsState ? "ml-auto flex shrink-0 items-center gap-2" : "ml-auto flex w-full items-center justify-end gap-2"}>
          {lightningState ? (
            <LightningStatusBadge state={lightningState} onClick={() => setLightningPanelOpen(true)} />
          ) : null}
          <AutocompleteStatus
            status={autocompleteStatus}
            message={autocompleteMessage}
            onToggle={() => post({ type: "autocomplete:toggle" })}
          />
        </div>
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
            endRef={messageEndRef}
            renderBody={renderBody}
            onDismissArtifact={(id) =>
              setInlineArtifacts((current) => current.filter((artifact) => artifact.id !== id))
            }
            onCopyOwnershipDraft={handleCopyOwnershipDraft}
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
            contextWarning={context.contextWarning}
            onDismissContextWarning={() => post({ type: "context:dismiss-warning" })}
            intentFeedback={intentFeedback}
            onDismissIntent={() => setIntentFeedback(undefined)}
            jobProgress={jobProgress}
            onDismissJob={dismissJobProgress}
            onCancelJob={cancelJob}
            onViewJobResults={viewJobResults}
            conflictCount={conflictCount}
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
              {inlineArtifacts.map((artifact) =>
                artifact.kind === "decision" ? (
                  <DecisionTimeline
                    key={artifact.id}
                    timeline={artifact.timeline}
                    onDismiss={() =>
                      setInlineArtifacts((current) => current.filter((entry) => entry.id !== artifact.id))
                    }
                  />
                ) : null
              )}
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
          setPromptModalOpen(false);
          post({ type: "prompts:run", payload: { id } });
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
      {lightningState ? (
        <LightningModePanel
          state={lightningState}
          open={lightningPanelOpen}
          onClose={() => setLightningPanelOpen(false)}
          onEnableGlobal={() => post({ type: "lightning:enable-global" })}
          onDisableGlobal={() => post({ type: "lightning:disable-global" })}
          onEnableRepo={(repoId) => post({ type: "lightning:enable-repo", payload: { repoId } })}
          onDisableRepo={(repoId) => post({ type: "lightning:disable-repo", payload: { repoId } })}
          onRefreshRepo={(repoId) => post({ type: "lightning:refresh-repo", payload: { repoId } })}
          onUpgrade={() => post({ type: "lightning:upgrade" })}
        />
      ) : null}
      <PanelWidthEnforcer vscode={vscode} />
      </ChatLinkProvider>
    </div>
  );
}
