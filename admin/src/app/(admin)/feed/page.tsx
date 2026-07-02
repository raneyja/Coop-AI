"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FeedChatProse } from "@/components/FeedChatProse";
import {
  fetchThread,
  fetchThreads,
  type ThreadMessage,
  type ThreadSummary
} from "@/lib/coopApi";

function formatThreadTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function roleLabel(role: string): string {
  if (role === "assistant") return "Coop";
  if (role === "user") return "You";
  return role;
}

function repoLabel(thread: ThreadSummary): string | null {
  if (!thread.repoOwner || !thread.repoName) {
    return null;
  }
  return `${thread.repoOwner}/${thread.repoName}`;
}

function FeedMessage({ message }: { message: ThreadMessage }) {
  const isUser = message.role === "user";
  return (
    <article className={`feed-chat-message feed-chat-message--${isUser ? "user" : "assistant"}`}>
      <div className="feed-chat-message-inner">
        <div className="feed-chat-message-meta">
          <span className="feed-chat-message-label">{roleLabel(message.role)}</span>
          <time className="feed-chat-message-time">{formatThreadTime(message.createdAt)}</time>
        </div>
        <div className="feed-chat-message-body">
          <FeedChatProse content={message.content} />
        </div>
      </div>
    </article>
  );
}

export default function ChatFeedPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [search, setSearch] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [threads, selectedId]
  );

  const loadThreads = useCallback(async (query?: string) => {
    setLoadingThreads(true);
    setError(null);
    const result = await fetchThreads({ q: query?.trim() || undefined, limit: 50 });
    setLoadingThreads(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load chat threads.");
      setThreads([]);
      return;
    }
    const nextThreads = result.data?.threads ?? [];
    setThreads(nextThreads);
    setSelectedId((current) => {
      if (current && nextThreads.some((thread) => thread.id === current)) {
        return current;
      }
      return nextThreads[0]?.id ?? null;
    });
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    setError(null);
    const result = await fetchThread(threadId);
    setLoadingMessages(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load thread.");
      setMessages([]);
      return;
    }
    setMessages(result.data?.messages ?? []);
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreads(search);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, loadThreads]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Chat Feed</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Past chats synced from the Coop VS Code extension — browse threads and read full message history.
        </p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="grid min-h-[32rem] gap-0 overflow-hidden rounded-md border border-coop-border lg:grid-cols-[minmax(240px,320px)_1fr]">
        <aside className="border-b border-coop-border bg-coop-dark/40 lg:border-b-0 lg:border-r">
          <div className="border-b border-coop-border/60 p-3">
            <label htmlFor="feed-search" className="admin-label">
              Search threads
            </label>
            <input
              id="feed-search"
              className="admin-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title or preview…"
            />
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {loadingThreads ? (
              <p className="px-4 py-6 text-sm text-coop-muted">Loading threads…</p>
            ) : threads.length === 0 ? (
              <p className="px-4 py-6 text-sm text-coop-muted">
                No synced chats yet. Chats appear here after you sign in to the VS Code extension and start a conversation.
              </p>
            ) : (
              <ul>
                {threads.map((thread) => {
                  const active = thread.id === selectedId;
                  const repo = repoLabel(thread);
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(thread.id)}
                        className={`block w-full border-b border-coop-border/40 px-4 py-3 text-left transition-colors ${
                          active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <p className="truncate text-sm font-medium text-white">{thread.title || "New Chat"}</p>
                        {thread.previewText ? (
                          <p className="mt-1 line-clamp-2 text-xs text-coop-muted">{thread.previewText}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-coop-muted">
                          <span>{thread.messageCount} messages</span>
                          {repo ? <span>{repo}</span> : null}
                          <span className="ml-auto normal-case">{formatThreadTime(thread.updatedAt)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-[28rem] flex-col bg-coop-dark/20">
          {selectedThread ? (
            <>
              <header className="border-b border-coop-border/60 px-5 py-4">
                <h2 className="text-base font-semibold text-white">{selectedThread.title || "New Chat"}</h2>
                <p className="mt-1 text-xs text-coop-muted">
                  Updated {formatThreadTime(selectedThread.updatedAt)}
                  {repoLabel(selectedThread) ? ` · ${repoLabel(selectedThread)}` : ""}
                </p>
              </header>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {loadingMessages ? (
                  <p className="text-sm text-coop-muted">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-coop-muted">This thread has no messages yet.</p>
                ) : (
                  <div className="feed-chat-thread">
                    {messages.map((message) => (
                      <FeedMessage key={message.id} message={message} />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-coop-muted">
              Select a thread to read the conversation.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
