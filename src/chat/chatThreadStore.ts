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

/** True until the user submits a prompt (or the thread otherwise has content). */
export function isDraftChatThread(thread: {
  messages: unknown[];
  artifacts?: unknown[];
  messageCount?: number;
}): boolean {
  const messageCount = thread.messageCount ?? thread.messages.length;
  const artifactCount = thread.artifacts?.length ?? 0;
  return messageCount === 0 && artifactCount === 0;
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

function threadHasPersistedRepo(thread: ChatThreadRecord): boolean {
  return Boolean(snapshotThreadRepoContext(thread.repoContext ?? {}));
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
      .filter((thread) => !isDraftChatThread(thread))
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
    if (repoContext !== undefined) {
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
    const previousId = this.snapshot.activeThreadId;
    this.snapshot.activeThreadId = threadId;
    this.snapshot.lastActiveAt = Date.now();
    if (previousId !== threadId) {
      this.removeIfDraft(previousId);
    }
    this.discardInactiveDrafts();
    this.writeSnapshot();
    return this.getActiveThread();
  }

  public startNewThread(inheritContext?: RepoContext): ChatThreadRecord {
    this.discardInactiveDrafts();
    const inherited = inheritContext ? snapshotThreadRepoContext(inheritContext) : undefined;
    const active = this.getThread(this.snapshot.activeThreadId);
    // Reuse only a truly blank draft. A New Chat that still has Use-repo must
    // not be recycled — that left InspectIQ stuck on the next thread.
    const canReuseDraft =
      active && isDraftChatThread(active) && !threadHasPersistedRepo(active);
    if (canReuseDraft) {
      active.title = "New Chat";
      active.repoContext = inherited;
      active.updatedAt = Date.now();
      this.snapshot.lastActiveAt = Date.now();
      this.writeSnapshot();
      return active;
    }

    const thread = emptyThread();
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
    thread.repoContext = undefined;
    thread.updatedAt = Date.now();
    this.writeSnapshot();
    return thread;
  }

  private getThread(threadId: string): ChatThreadRecord | undefined {
    return this.snapshot.threads.find((thread) => thread.id === threadId);
  }

  private removeIfDraft(threadId: string): void {
    const thread = this.getThread(threadId);
    if (!thread || !isDraftChatThread(thread)) {
      return;
    }
    this.snapshot.threads = this.snapshot.threads.filter((item) => item.id !== threadId);
  }

  private discardInactiveDrafts(): void {
    const activeId = this.snapshot.activeThreadId;
    this.snapshot.threads = this.snapshot.threads.filter(
      (thread) => thread.id === activeId || !isDraftChatThread(thread)
    );
  }

  private ensureActiveThread(): void {
    const before = this.snapshot.threads.length;
    this.discardInactiveDrafts();
    let dirty = this.snapshot.threads.length !== before;
    if (this.snapshot.threads.length === 0) {
      const thread = emptyThread();
      const now = Date.now();
      this.snapshot = { activeThreadId: thread.id, threads: [thread], lastActiveAt: now };
      this.writeSnapshot();
      return;
    }
    if (!this.getThread(this.snapshot.activeThreadId)) {
      this.snapshot.activeThreadId = this.snapshot.threads[0].id;
      dirty = true;
    }
    if (dirty) {
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
    const snapshot: ThreadStoreSnapshot = {
      activeThreadId: raw.activeThreadId,
      threads,
      lastActiveAt: resolveLastActiveAt(raw.lastActiveAt, threads)
    };
    snapshot.threads = snapshot.threads.filter(
      (thread) => thread.id === snapshot.activeThreadId || !isDraftChatThread(thread)
    );
    return snapshot;
  }

  private writeSnapshot(): void {
    void this.extensionContext.workspaceState.update(this.storageKey(), this.snapshot);
  }
}
