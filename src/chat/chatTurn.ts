import type { ChatMessage, ChatPersistedArtifact, RepoContext } from "./types";
import type { ContextFetchResult } from "../context/requestBatcher";
import type { DecisionTimeline } from "../types/decisionTimeline";

/** Synthetic id for editor panels that do not use ChatThreadStore. */
export const SESSION_RUN_THREAD_ID = "session";

export type ChatTurnStatus = "running" | "completed" | "aborted" | "error";

/**
 * Per-thread generation turn. Owns abort/token/bundle/history so switching the
 * active UI thread does not cancel or corrupt an in-flight response.
 */
export type ChatTurn = {
  id: string;
  threadId: string;
  status: ChatTurnStatus;
  startedAt: number;
  /** Repo/file scope at send time (immutable for the turn). */
  context: RepoContext;
  /** Thread messages including the user bubble that started this turn. */
  history: ChatMessage[];
  artifacts: ChatPersistedArtifact[];
  sessionCostUsd: number;
  modelMessage: string;
  quickAction?: string;
  contextBundle: ContextFetchResult[];
  jobResult?: unknown;
  jobId?: string;
  jobGeneration: number;
  streamAbort: AbortController;
  streamGeneration: number;
  partialAssistant: string;
  pendingEvidenceArtifactId?: string;
  lastTraceTimeline?: DecisionTimeline;
  pendingMentions?: import("./types").ChatFileMention[];
  codeEditIntent: boolean;
};

export type BeginChatTurnInput = {
  threadId: string;
  context: RepoContext;
  history: ChatMessage[];
  artifacts: ChatPersistedArtifact[];
  sessionCostUsd: number;
  modelMessage: string;
  quickAction?: string;
  pendingMentions?: import("./types").ChatFileMention[];
  codeEditIntent?: boolean;
};

function createTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * At most one running turn per thread. Switching UI threads must not abort
 * other threads' turns — only Stop / same-thread re-send / session dispose.
 */
export class ThreadRunManager {
  private readonly runs = new Map<string, ChatTurn>();
  private streamGenerationSeq = 0;
  private jobGenerationSeq = 0;

  public begin(input: BeginChatTurnInput): ChatTurn {
    this.abort(input.threadId);
    const streamGeneration = ++this.streamGenerationSeq;
    const turn: ChatTurn = {
      id: createTurnId(),
      threadId: input.threadId,
      status: "running",
      startedAt: Date.now(),
      context: { ...input.context },
      history: [...input.history],
      artifacts: [...input.artifacts],
      sessionCostUsd: input.sessionCostUsd,
      modelMessage: input.modelMessage,
      quickAction: input.quickAction,
      contextBundle: [],
      jobGeneration: ++this.jobGenerationSeq,
      streamAbort: new AbortController(),
      streamGeneration,
      partialAssistant: "",
      pendingMentions: input.pendingMentions,
      codeEditIntent: Boolean(input.codeEditIntent)
    };
    this.runs.set(input.threadId, turn);
    return turn;
  }

  public get(threadId: string): ChatTurn | undefined {
    return this.runs.get(threadId);
  }

  public isRunning(threadId: string): boolean {
    return this.runs.get(threadId)?.status === "running";
  }

  public runningThreadIds(): string[] {
    return [...this.runs.entries()]
      .filter(([, turn]) => turn.status === "running")
      .map(([threadId]) => threadId);
  }

  public isStreamActive(turn: ChatTurn): boolean {
    const current = this.runs.get(turn.threadId);
    return Boolean(
      current &&
        current.id === turn.id &&
        current.streamGeneration === turn.streamGeneration &&
        current.status === "running"
    );
  }

  public isJobActive(turn: ChatTurn): boolean {
    const current = this.runs.get(turn.threadId);
    return Boolean(
      current &&
        current.id === turn.id &&
        current.jobGeneration === turn.jobGeneration &&
        current.status === "running"
    );
  }

  public appendPartial(turn: ChatTurn, chunk: string): void {
    if (!this.isStreamActive(turn)) {
      return;
    }
    turn.partialAssistant += chunk;
  }

  public complete(turn: ChatTurn): void {
    const current = this.runs.get(turn.threadId);
    if (!current || current.id !== turn.id) {
      return;
    }
    turn.status = "completed";
    this.runs.delete(turn.threadId);
  }

  public markError(turn: ChatTurn): void {
    const current = this.runs.get(turn.threadId);
    if (!current || current.id !== turn.id) {
      return;
    }
    turn.status = "error";
    this.runs.delete(turn.threadId);
  }

  public abort(threadId: string): void {
    const turn = this.runs.get(threadId);
    if (!turn) {
      return;
    }
    turn.status = "aborted";
    turn.streamAbort.abort();
    this.runs.delete(threadId);
  }

  public abortAll(): void {
    for (const threadId of [...this.runs.keys()]) {
      this.abort(threadId);
    }
  }
}
