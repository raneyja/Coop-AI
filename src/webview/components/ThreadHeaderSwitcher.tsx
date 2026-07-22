import React, { useEffect, useRef } from "react";

export type ThreadListItem = {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  isRunning?: boolean;
};

type ThreadHeaderSwitcherProps = {
  activeId: string;
  activeTitle: string;
  threads: ThreadListItem[];
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
};

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 opacity-70 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ThreadHeaderSwitcher({
  activeId,
  activeTitle,
  threads,
  onSelect,
  onNewThread
}: ThreadHeaderSwitcherProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const activeRunning = threads.some((thread) => thread.id === activeId && thread.isRunning);

  return (
    <div ref={rootRef} className="thread-switcher min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          className="thread-switcher-trigger min-w-0 flex-1"
          aria-expanded={open}
          aria-haspopup="listbox"
          title={activeTitle}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <span
            className={`thread-switcher-status${activeRunning ? " thread-switcher-status--running" : ""}`}
            aria-hidden="true"
          />
          <span className="thread-switcher-title truncate">{activeTitle}</span>
          <ChevronIcon open={open} />
        </button>
        <button
          type="button"
          className="coop-icon-btn shrink-0"
          aria-label="New chat thread"
          title="New chat"
          onClick={() => {
            onNewThread();
          }}
        >
          <PlusIcon />
        </button>
      </div>
      {open ? (
        <div className="thread-switcher-menu" role="listbox" aria-label="Chat threads">
          {threads.length === 0 ? (
            <p className="thread-switcher-empty">No saved threads yet.</p>
          ) : (
            <ul className="thread-switcher-list">
              {threads.map((thread) => {
                const isActive = thread.id === activeId;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`thread-switcher-item${isActive ? " thread-switcher-item--active" : ""}`}
                      onClick={() => {
                        setOpen(false);
                        if (thread.id !== activeId) {
                          onSelect(thread.id);
                        }
                      }}
                    >
                      <span className="thread-switcher-item-title truncate">
                        {thread.isRunning ? (
                          <span className="thread-switcher-running-dot" aria-hidden="true" />
                        ) : null}
                        {thread.title}
                      </span>
                      <span className="thread-switcher-item-meta">
                        {thread.isRunning
                          ? "Generating…"
                          : thread.messageCount > 0
                            ? `${thread.messageCount} msgs · `
                            : ""}
                        {thread.isRunning ? "" : formatRelativeTime(thread.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
