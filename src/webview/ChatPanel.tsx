import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "./components/ChatComposer";
import { ChatStream, ChatMessage } from "./components/ChatStream";
import { EmptyState } from "./components/EmptyState";
import { ConflictResolution } from "./ConflictResolution";
import { DegradationNotification } from "./DegradationNotification";
import { IntentFeedback } from "./IntentFeedback";
import { JobProgress } from "./JobProgress";
import { applyThemeMode } from "./theme";
import { QuickActionId } from "./types";
import { SavedPromptsMenu, type SavedPromptItem } from "./components/SavedPromptsMenu";
import { RemoteExplorer } from "./RemoteExplorer";
import { AutocompleteStatus, type AutocompleteBadgeStatus } from "./AutocompleteStatus";
import { InlineCompletion, type InlineCompletionUiState } from "./InlineCompletion";
import { DecisionTimeline, type DecisionTimelinePayload } from "./DecisionTimeline";
import type {
  ConflictActionId,
  ConflictResolutionState,
  DegradationFeatureStatusPayload,
  DegradationNotificationPayload,
  IntegrationHealthPayload,
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
  type: "file" | "dir";
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
        error?: string;
        stale?: boolean;
        provider?: "github" | "gitlab" | "bitbucket";
        loading?: boolean;
      };
    }
  | { type: "intent:feedback"; payload: IntentFeedbackState }
  | { type: "conflict:update"; payload: ConflictResolutionState }
  | { type: "degradation:health"; payload: IntegrationHealthPayload[] }
  | { type: "degradation:feature-status"; payload: Record<string, DegradationFeatureStatusPayload> }
  | { type: "degradation:notification"; payload: DegradationNotificationPayload }
  | { type: "trace:autoload"; payload: { message: string } }
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
  | { type: "prompts:list"; payload: { prompts: SavedPromptItem[] } }
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
  | { type: "decision:timeline"; payload: { timeline: DecisionTimelinePayload } };

type ChatPanelProps = {
  vscode: VsCodeApi;
};

type PersistedWebviewState = {
  draftInput: string;
};

const INPUT_MAX = 12_000;

function inferLinks(content: string): Array<{ label: string; url: string }> {
  const matches = content.match(/https?:\/\/[^\s)]+/g) || [];
  return matches.map((url, idx) => ({ label: `Link ${idx + 1}`, url }));
}

function renderMessageBody(content: string): React.ReactElement[] {
  const blocks = content.split("```");
  return blocks.map((part, index) => {
    const isCode = index % 2 === 1;
    if (!isCode) {
      return (
        <p key={`text-${index}`} className="whitespace-pre-wrap break-words">
          {part}
        </p>
      );
    }
    const [firstLine, ...rest] = part.split("\n");
    const language = firstLine.trim() || "text";
    return (
      <pre key={`code-${index}`} className="chat-code-block">
        <code data-lang={language}>{rest.join("\n")}</code>
      </pre>
    );
  });
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }): React.ReactElement {
  return (
    <div
      className="mx-3 mb-2 flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: "var(--vscode-inputValidation-errorBorder)",
        background: "var(--vscode-inputValidation-errorBackground)",
        color: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))"
      }}
      role="alert"
    >
      <span className="min-w-0 break-words">{message}</span>
      <button type="button" className="shrink-0 opacity-80 hover:opacity-100" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function ChatPanel({ vscode }: ChatPanelProps): React.ReactElement {
  const cached = (vscode.getState() as PersistedWebviewState | null) || null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<RepoContext>({});
  const [input, setInput] = useState(cached?.draftInput || "");
  const [error, setError] = useState("");
  const [streamingBuffer, setStreamingBuffer] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [treeState, setTreeState] = useState<{
    path: string;
    items: RemoteTreeNode[];
    error?: string;
    stale?: boolean;
    provider?: "github" | "gitlab" | "bitbucket";
    loading?: boolean;
  }>({ path: "", items: [] });
  const [intentFeedback, setIntentFeedback] = useState<IntentFeedbackState | undefined>();
  const [jobProgress, setJobProgress] = useState<JobProgressState | undefined>();
  const [conflictState, setConflictState] = useState<ConflictResolutionState | undefined>();
  const [health, setHealth] = useState<IntegrationHealthPayload[]>([]);
  const [featureStatuses, setFeatureStatuses] = useState<Record<string, DegradationFeatureStatusPayload>>({});
  const [degradationNotification, setDegradationNotification] = useState<DegradationNotificationPayload | undefined>();
  const [usageLabel, setUsageLabel] = useState<string | undefined>();
  const [savedPrompts, setSavedPrompts] = useState<SavedPromptItem[]>([]);
  const [autocompleteStatus, setAutocompleteStatus] = useState<AutocompleteBadgeStatus>("disabled");
  const [autocompleteMessage, setAutocompleteMessage] = useState<string | undefined>();
  const [inlineCompletionUi, setInlineCompletionUi] = useState<InlineCompletionUiState>({
    visible: false
  });
  const [decisionTimeline, setDecisionTimeline] = useState<DecisionTimelinePayload | undefined>();
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const streamMessage = useMemo<ChatMessage | null>(() => {
    if (!streamingBuffer) {
      return null;
    }
    return {
      role: "assistant",
      content: streamingBuffer,
      timestamp: Date.now(),
      links: inferLinks(streamingBuffer)
    };
  }, [streamingBuffer]);

  const isActiveChat = messages.length > 0 || Boolean(streamMessage) || isStreaming;

  const post = useCallback((payload: unknown) => vscode.postMessage(payload), [vscode]);

  const requestTree = useCallback((path = "") => {
    post({ type: "repo:list", payload: { path } });
  }, [post]);

  useEffect(() => {
    post({ type: "webview-ready" });
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
          setStreamingBuffer("");
          setIsStreaming(false);
          break;
        case "chat:delta":
          setIsStreaming(true);
          setStreamingBuffer((prev) => prev + message.payload.chunk);
          break;
        case "chat:complete":
          setMessages((prev) => [...prev, message.payload.message]);
          if (message.payload.message.role === "assistant") {
            setDecisionTimeline((current) =>
              current ? { ...current, narrative: message.payload.message.content } : current
            );
          }
          setStreamingBuffer("");
          setIsStreaming(false);
          break;
        case "chat:error":
          setError(message.payload.message);
          setIsStreaming(false);
          setStreamingBuffer("");
          break;
        case "repo:tree":
          setTreeState({
            path: message.payload.path,
            items: message.payload.items,
            error: message.payload.error,
            stale: message.payload.stale,
            provider: message.payload.provider,
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
        case "degradation:health":
          setHealth(message.payload);
          break;
        case "degradation:feature-status":
          setFeatureStatuses(message.payload);
          break;
        case "degradation:notification":
          setDegradationNotification(message.payload);
          break;
        case "trace:autoload":
          setInput(message.payload.message);
          break;
        case "decision:timeline":
          setDecisionTimeline(message.payload.timeline);
          break;
        case "job:progress":
          setJobProgress(message.payload);
          break;
        case "job:complete":
          setJobProgress(message.payload);
          break;
        case "chat:usage":
          setUsageLabel(
            `~$${message.payload.estimatedCostUsd.toFixed(4)} (${message.payload.inputTokens}+${message.payload.outputTokens} tok) · session $${message.payload.sessionCostUsd.toFixed(4)}`
          );
          break;
        case "prompts:list":
          setSavedPrompts(message.payload.prompts);
          break;
        case "autocomplete:status":
          setAutocompleteStatus(message.payload.status);
          setAutocompleteMessage(message.payload.message);
          setInlineCompletionUi({
            visible: message.payload.status !== "disabled",
            previewText: message.payload.previewText,
            suggestionIndex: message.payload.suggestionIndex,
            suggestionCount: message.payload.suggestionCount,
            latencyMs: message.payload.latencyMs,
            sourceLabel: "Coop AI"
          });
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", listener);
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
    (prompt: string, quickAction?: QuickActionId) => {
      const message = prompt.trim();
      if (!message) {
        return;
      }
      if (message.length > INPUT_MAX) {
        setError(`Prompt exceeds ${INPUT_MAX} characters.`);
        return;
      }
      setError("");
      setIsStreaming(true);
      setStreamingBuffer("");
      post({ type: "chat:send", payload: { message, quickAction } });
      setInput("");
    },
    [post]
  );

  const handleSend = useCallback(() => submitPrompt(input), [input, submitPrompt]);

  const handleQuickAction = useCallback(
    (actionId: QuickActionId, prompt: string) => {
      submitPrompt(prompt, actionId);
    },
    [submitPrompt]
  );

  const handleNewChat = useCallback(() => {
    setError("");
    setStreamingBuffer("");
    setIsStreaming(false);
    setDecisionTimeline(undefined);
    post({ type: "chat:new" });
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
        requestTree(treeState.path || "");
      }
      return next;
    });
  }, [treeState.path, requestTree]);

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

  return (
    <div className="coop-panel coop-canvas-bg flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-[var(--coop-panel-foreground)]">
      {error ? <ErrorBanner message={error} onDismiss={() => setError("")} /> : null}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <AutocompleteStatus
          status={autocompleteStatus}
          message={autocompleteMessage}
          onToggle={() => post({ type: "autocomplete:toggle" })}
        />
      </div>
      <InlineCompletion state={inlineCompletionUi} />
      <DegradationNotification
        health={health}
        featureStatuses={featureStatuses}
        notification={degradationNotification}
        onDismiss={() => setDegradationNotification(undefined)}
        onRetry={(provider, feature) => post({ type: "degradation:retry", payload: { provider, feature } })}
        onRefresh={(feature) => post({ type: "degradation:refresh", payload: { feature } })}
        onOpenSettings={() => post({ type: "ui:open-settings" })}
      />
      <JobProgress
        state={jobProgress}
        onCancel={(jobId) => post({ type: "job:cancel", payload: { jobId } })}
        onViewResults={(jobId) => post({ type: "job:view-results", payload: { jobId } })}
        onDismiss={() => setJobProgress(undefined)}
      />
      <IntentFeedback state={intentFeedback} onDismiss={() => setIntentFeedback(undefined)} />
      {decisionTimeline ? (
        <DecisionTimeline timeline={decisionTimeline} onDismiss={() => setDecisionTimeline(undefined)} />
      ) : null}
      <ConflictResolution
        state={conflictState}
        onDismiss={(conflictId) => handleConflictAction(conflictId, "dismiss")}
        onAction={handleConflictAction}
      />

      {isActiveChat ? (
        <ChatStream
          messages={messages}
          streamingMessage={streamMessage}
          endRef={messageEndRef}
          renderBody={renderMessageBody}
        />
      ) : (
        <EmptyState
          context={context}
          disabled={isStreaming}
          featureStatuses={featureStatuses}
          onAction={handleQuickAction}
        />
      )}

      <RemoteExplorer
        open={isExplorerOpen}
        context={context}
        treeState={treeState}
        onClose={() => setIsExplorerOpen(false)}
        onRefresh={(path) => requestTree(path)}
        onExpand={(path) => requestTree(path)}
        onSelectFile={(path) => post({ type: "repo:open-file", payload: { path } })}
        onOpenSettings={() => post({ type: "ui:open-settings" })}
      />

      <SavedPromptsMenu
        prompts={savedPrompts}
        disabled={isStreaming}
        onRun={(id) => post({ type: "prompts:run", payload: { id } })}
        onSaveCurrent={() => {
          const title = window.prompt("Prompt title");
          if (!title?.trim()) {
            return;
          }
          post({
            type: "prompts:save",
            payload: { title: title.trim(), template: input.trim() || "Describe {{file}} in {{owner}}/{{repo}}." }
          });
        }}
      />

      <ChatComposer
        value={input}
        maxLength={INPUT_MAX}
        isStreaming={isStreaming}
        contextFile={context.file}
        usageLabel={usageLabel}
        onChange={setInput}
        onSend={handleSend}
        onStop={handleStopStreaming}
        onToggleExplorer={toggleExplorer}
      />
    </div>
  );
}
