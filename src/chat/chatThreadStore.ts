import * as vscode from "vscode";
import { isChatSessionIdle, resolveLastActiveAt, shouldStartFreshThreadOnRestore } from "./chatThreadRestore";
import type { ChatMessage, ChatPersistedArtifact, RepoContext } from "./types";

export type ChatThreadSummary = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
  /** True when a generation turn is still running for this thread. */
  isRunning?: boolean;
};

export type ChatThreadRecord = ChatThreadSummary & {
  messages: ChatMessage[];
  artifacts: ChatPersistedArtifact[];
  sessionCostUsd: number;
  /** Repo/file scope last used in this thread (restored on switch). */
  repoContext?: RepoContext;
};

type ThreadStoreSnapshot = {
  activeThreadId: string;
  threads: ChatThreadRecord[];
  lastActiveAt: number;
};

const MAX_THREADS = 40;
const STORAGE_PREFIX = "coopAI.chatThreads.v1";

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyThread(id = createThreadId()): ChatThreadRecord {
  const now = Date.now();
  return {
    id,
    title: "New Chat",
    messages: [],
    artifacts: [],
    sessionCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  };
}

function snapshotThreadRepoContext(ctx: RepoContext): RepoContext | undefined {
  const owner = ctx.owner?.trim();
  const repo = ctx.repo?.trim();
  const file = ctx.file?.trim();
  if (!owner && !repo && !file) {
    return undefined;
  }
  return {
    provider: ctx.provider,
    owner,
    repo,
    branch: ctx.branch?.trim() || undefined,
    scope: ctx.scope,
    file,
    fileSource: ctx.fileSource,
    languageId: ctx.languageId
  };
}

export function resolveThreadScopeKey(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
  return folder ?? "global";
}

export class ChatThreadStore {
  private snapshot: ThreadStoreSnapshot;

  public constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly scopeKey: string
  ) {
    this.snapshot = this.readSnapshot();
    this.ensureActiveThread();
  }

  public getActiveThreadId(): string {
    return this.snapshot.activeThreadId;
  }

  public getActiveThread(): ChatThreadRecord {
    return this.getThread(this.snapshot.activeThreadId) ?? emptyThread(this.snapshot.activeThreadId);
  }

  public getLastActiveAt(): number {
    return this.snapshot.lastActiveAt;
  }

  public isSessionIdle(idleMs: number): boolean {
    return isChatSessionIdle(this.snapshot.lastActiveAt, idleMs);
  }

  /** Persist sidebar activity so the next reload can apply the idle timeout. */
  public recordActivity(): void {
    this.snapshot.lastActiveAt = Date.now();
    this.writeSnapshot();
  }

  /**
   * Restore the active thread, or start a fresh one when the session has been idle.
   * Expired sessions keep prior threads in history; only the default view changes.
   */
  public resolveStartupThread(idleMs: number): ChatThreadRecord {
    this.ensureActiveThread();
    const active = this.getActiveThread();

    if (!shouldStartFreshThreadOnRestore(active, this.snapshot.lastActiveAt, idleMs)) {
      this.recordActivity();
      return active;
    }

    const fresh = this.startNewThread();
    this.recordActivity();
    return fresh;
  }

  public listSummaries(): ChatThreadSummary[] {
    return [...this.snapshot.threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        messageCount: thread.messageCount
      }));
  }

  public listAllThreads(): ChatThreadRecord[] {
    return [...this.snapshot.threads];
  }

  public setActiveThread(
    messages: ChatMessage[],
    sessionCostUsd: number,
    title: string,
    artifacts: ChatPersistedArtifact[] = [],
    repoContext?: RepoContext
  ): void {
    this.setThread(this.snapshot.activeThreadId, messages, sessionCostUsd, title, artifacts, repoContext);
  }

  /** Persist messages/artifacts for any thread (active or background). */
  public setThread(
    threadId: string,
    messages: ChatMessage[],
    sessionCostUsd: number,
    title: string,
    artifacts: ChatPersistedArtifact[] = [],
    repoContext?: RepoContext
  ): void {
    const thread = this.getThread(threadId);
    if (!thread) {
      return;
    }
    thread.messages = [...messages];
    thread.artifacts = [...artifacts];
    thread.sessionCostUsd = sessionCostUsd;
    thread.title = title;
    thread.messageCount = messages.length;
    thread.updatedAt = Date.now();
    if (repoContext) {
      thread.repoContext = snapshotThreadRepoContext(repoContext);
    }
    if (threadId === this.snapshot.activeThreadId) {
      this.snapshot.lastActiveAt = Date.now();
    }
    this.writeSnapshot();
  }

  public appendMessage(
    threadId: string,
    message: ChatMessage,
    options?: { sessionCostUsd?: number; title?: string }
  ): boolean {
    const thread = this.getThread(threadId);
    if (!thread) {
      return false;
    }
    thread.messages = [...thread.messages, message];
    thread.messageCount = thread.messages.length;
    thread.updatedAt = Date.now();
    if (options?.sessionCostUsd !== undefined) {
      thread.sessionCostUsd = options.sessionCostUsd;
    }
    if (options?.title) {
      thread.title = options.title;
    }
    this.writeSnapshot();
    return true;
  }

  public getThreadById(threadId: string): ChatThreadRecord | undefined {
    const thread = this.getThread(threadId);
    return thread ? { ...thread, messages: [...thread.messages], artifacts: [...thread.artifacts] } : undefined;
  }

  public updateActiveTitle(title: string): void {
    const thread = this.getThread(this.snapshot.activeThreadId);
    if (!thread) {
      return;
    }
    thread.title = title;
    thread.updatedAt = Date.now();
    this.writeSnapshot();
  }

  public switchTo(threadId: string): ChatThreadRecord | undefined {
    if (!this.getThread(threadId)) {
      return undefined;
    }
    this.snapshot.activeThreadId = threadId;
    this.snapshot.lastActiveAt = Date.now();
    this.writeSnapshot();
    return this.getActiveThread();
  }

  public startNewThread(inheritContext?: RepoContext): ChatThreadRecord {
    const thread = emptyThread();
    const inherited = inheritContext ? snapshotThreadRepoContext(inheritContext) : undefined;
    if (inherited) {
      thread.repoContext = inherited;
    }
    this.snapshot.threads.unshift(thread);
    this.snapshot.activeThreadId = thread.id;
    this.pruneThreads();
    this.writeSnapshot();
    return thread;
  }

  public clearActiveThread(): ChatThreadRecord {
    const thread = this.getActiveThread();
    thread.messages = [];
    thread.artifacts = [];
    thread.sessionCostUsd = 0;
    thread.title = "New Chat";
    thread.messageCount = 0;
    thread.updatedAt = Date.now();
    this.writeSnapshot();
    return thread;
  }

  private getThread(threadId: string): ChatThreadRecord | undefined {
    return this.snapshot.threads.find((thread) => thread.id === threadId);
  }

  private ensureActiveThread(): void {
    if (this.snapshot.threads.length === 0) {
      const thread = emptyThread();
      const now = Date.now();
      this.snapshot = { activeThreadId: thread.id, threads: [thread], lastActiveAt: now };
      this.writeSnapshot();
      return;
    }
    if (!this.getThread(this.snapshot.activeThreadId)) {
      this.snapshot.activeThreadId = this.snapshot.threads[0].id;
      this.writeSnapshot();
    }
  }

  private pruneThreads(): void {
    if (this.snapshot.threads.length <= MAX_THREADS) {
      return;
    }
    const activeId = this.snapshot.activeThreadId;
    const sorted = [...this.snapshot.threads].sort((a, b) => b.updatedAt - a.updatedAt);
    const kept = sorted.slice(0, MAX_THREADS);
    if (!kept.some((thread) => thread.id === activeId)) {
      const active = this.getThread(activeId);
      if (active) {
        kept[MAX_THREADS - 1] = active;
      }
    }
    this.snapshot.threads = kept;
  }

  private storageKey(): string {
    return `${STORAGE_PREFIX}.${this.scopeKey}`;
  }

  private readSnapshot(): ThreadStoreSnapshot {
    const raw = this.extensionContext.workspaceState.get<Partial<ThreadStoreSnapshot>>(this.storageKey());
    if (!raw?.activeThreadId || !Array.isArray(raw.threads)) {
      const thread = emptyThread();
      const now = Date.now();
      return { activeThreadId: thread.id, threads: [thread], lastActiveAt: now };
    }
    const threads = raw.threads.map((thread) => ({
      ...thread,
      messageCount: thread.messageCount ?? thread.messages?.length ?? 0,
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      artifacts: Array.isArray(thread.artifacts) ? thread.artifacts : [],
      sessionCostUsd: thread.sessionCostUsd ?? 0
    }));
    return {
      activeThreadId: raw.activeThreadId,
      threads,
      lastActiveAt: resolveLastActiveAt(raw.lastActiveAt, threads)
    };
  }

  private writeSnapshot(): void {
    void this.extensionContext.workspaceState.update(this.storageKey(), this.snapshot);
  }
}
