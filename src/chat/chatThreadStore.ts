import * as vscode from "vscode";
import type { ChatMessage } from "./types";

export type ChatThreadSummary = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
};

export type ChatThreadRecord = ChatThreadSummary & {
  messages: ChatMessage[];
  sessionCostUsd: number;
};

type ThreadStoreSnapshot = {
  activeThreadId: string;
  threads: ChatThreadRecord[];
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
    sessionCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    messageCount: 0
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

  public setActiveThread(
    messages: ChatMessage[],
    sessionCostUsd: number,
    title: string
  ): void {
    const thread = this.getThread(this.snapshot.activeThreadId);
    if (!thread) {
      return;
    }
    thread.messages = [...messages];
    thread.sessionCostUsd = sessionCostUsd;
    thread.title = title;
    thread.messageCount = messages.length;
    thread.updatedAt = Date.now();
    this.writeSnapshot();
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
    this.writeSnapshot();
    return this.getActiveThread();
  }

  public startNewThread(): ChatThreadRecord {
    const thread = emptyThread();
    this.snapshot.threads.unshift(thread);
    this.snapshot.activeThreadId = thread.id;
    this.pruneThreads();
    this.writeSnapshot();
    return thread;
  }

  public clearActiveThread(): ChatThreadRecord {
    const thread = this.getActiveThread();
    thread.messages = [];
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
      this.snapshot = { activeThreadId: thread.id, threads: [thread] };
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
    const raw = this.extensionContext.workspaceState.get<ThreadStoreSnapshot>(this.storageKey());
    if (!raw?.activeThreadId || !Array.isArray(raw.threads)) {
      const thread = emptyThread();
      return { activeThreadId: thread.id, threads: [thread] };
    }
    return {
      activeThreadId: raw.activeThreadId,
      threads: raw.threads.map((thread) => ({
        ...thread,
        messageCount: thread.messageCount ?? thread.messages?.length ?? 0,
        messages: Array.isArray(thread.messages) ? thread.messages : [],
        sessionCostUsd: thread.sessionCostUsd ?? 0
      }))
    };
  }

  private writeSnapshot(): void {
    void this.extensionContext.workspaceState.update(this.storageKey(), this.snapshot);
  }
}
