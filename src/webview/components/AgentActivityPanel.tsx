import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentFileChip, AgentTodoItem, AgentToolRow } from "../agentActivity";
import { summarizeAgentExploration } from "../agentActivity";
import { splitNarrativeLabelParts } from "../agentNarrative";
import {
  formatThoughtLabel,
  formatWorkedForLabel,
  looksLikeRepoPath
} from "../../chat/chatTurnActivity";
import { useChatLinks } from "./ChatLinkContext";

type AgentActivityPanelProps = {
  todos: AgentTodoItem[];
  tools: AgentToolRow[];
  files: AgentFileChip[];
  thinkingText?: string;
  thinkingStreaming?: boolean;
  fallbackStatus?: string;
  onStop?: () => void;
  /** Live = in-flight stack. Complete = persisted Cursor-style trail. */
  mode?: "live" | "complete";
  durationMs?: number;
  thinkingMs?: number;
};

function TodoGlyph({ status }: { status: AgentTodoItem["status"] }): React.ReactElement {
  if (status === "completed") {
    return (
      <span className="coop-agent-todo-glyph coop-agent-todo-glyph--done" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M5.2 8.1 7.1 10l3.7-4.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="coop-agent-todo-glyph coop-agent-todo-glyph--active" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
          <circle
            className="coop-agent-todo-glyph-spin"
            cx="8"
            cy="8"
            r="6.25"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="10 22"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="coop-agent-todo-glyph coop-agent-todo-glyph--pending" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
        <circle
          cx="8"
          cy="8"
          r="6.25"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="2.2 2.2"
        />
      </svg>
    </span>
  );
}

function RichLabel({ text }: { text: string }): React.ReactElement {
  const { onOpenFile } = useChatLinks();
  const parts = splitNarrativeLabelParts(text);
  return (
    <span className="coop-agent-rich-label">
      {parts.map((part, index) =>
        part.type === "code" ? (
          looksLikeRepoPath(part.value) && onOpenFile ? (
            <button
              key={`${part.value}-${index}`}
              type="button"
              className="coop-agent-inline-code coop-agent-path-btn"
              onClick={() => onOpenFile(part.value)}
            >
              {part.value}
            </button>
          ) : (
            <code key={`${part.value}-${index}`} className="coop-agent-inline-code">
              {part.value}
            </code>
          )
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        )
      )}
    </span>
  );
}

function ThinkingBody({ text }: { text: string }): React.ReactElement {
  // Highlight backtick code and simple identifiers like isActiveChat after punctuation.
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\b[a-z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]+)+\b)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`c-${key++}`} className="coop-agent-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <code key={`i-${key++}`} className="coop-agent-inline-code">
          {token}
        </code>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return <div className="coop-agent-thinking-body">{nodes}</div>;
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      className={`coop-agent-chevron${open ? " coop-agent-chevron--open" : ""}`}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.25 2.75 7.5 6 4.25 9.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TodoList({ items }: { items: AgentTodoItem[] }): React.ReactElement {
  return (
    <ul className="coop-agent-todo-list">
      {items.map((todo) => (
        <TodoRow key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}

function TodoRow({ todo }: { todo: AgentTodoItem }): React.ReactElement {
  const detail = todo.detail?.trim() ?? "";
  const [open, setOpen] = useState(false);
  if (!detail) {
    return (
      <li
        className={`coop-agent-todo coop-agent-todo--${todo.status}`}
        data-status={todo.status}
      >
        <TodoGlyph status={todo.status} />
        <RichLabel text={todo.content} />
      </li>
    );
  }
  return (
    <li
      className={`coop-agent-todo coop-agent-todo--${todo.status} coop-agent-todo--expandable`}
      data-status={todo.status}
    >
      <button
        type="button"
        className="coop-agent-todo-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <TodoGlyph status={todo.status} />
        <RichLabel text={todo.content} />
        <Chevron open={open} />
      </button>
      {open ? <pre className="coop-agent-todo-detail">{detail}</pre> : null}
    </li>
  );
}

function CollapsibleTerm({
  label,
  open,
  live,
  onToggle,
  children
}: {
  label: string;
  open: boolean;
  live?: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="coop-agent-explore">
      <button
        type="button"
        className="coop-agent-thinking-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="coop-agent-thinking-title">
          {label}
          {live ? <span className="coop-agent-thinking-pulse" aria-hidden="true" /> : null}
        </span>
        <Chevron open={open} />
      </button>
      {open ? children : null}
    </div>
  );
}

/** Cursor-like activity panel: todos, thinking, tool/file summary. */
export function AgentActivityPanel({
  todos,
  tools,
  files,
  thinkingText,
  thinkingStreaming = false,
  fallbackStatus,
  onStop,
  mode = "live",
  durationMs,
  thinkingMs
}: AgentActivityPanelProps): React.ReactElement | null {
  const { onOpenFile } = useChatLinks();
  const isComplete = mode === "complete";
  const trimmedThinking = thinkingText?.trim() ?? "";
  const [workedOpen, setWorkedOpen] = useState(!isComplete);
  const [thinkingOpen, setThinkingOpen] = useState(!isComplete);
  const [exploredOpen, setExploredOpen] = useState(false);
  const [exploringOpen, setExploringOpen] = useState(!isComplete);
  const [filesOpen, setFilesOpen] = useState(false);
  const exploredTouchedRef = useRef(isComplete);
  const exploration = useMemo(() => summarizeAgentExploration(tools), [tools]);

  useEffect(() => {
    if (isComplete) {
      return;
    }
    setThinkingOpen(thinkingStreaming || Boolean(trimmedThinking));
  }, [isComplete, thinkingStreaming, trimmedThinking]);

  useEffect(() => {
    if (isComplete || exploredTouchedRef.current) {
      return;
    }
    // While tools are the only activity, keep the list open so new work is visible.
    // Once Thinking is up, collapse to the summary — click to reopen, like Cursor.
    if (exploration?.exploring) {
      setExploredOpen(false);
      return;
    }
    setExploredOpen(Boolean(exploration?.explored) && !trimmedThinking);
  }, [isComplete, exploration?.explored, exploration?.exploring, trimmedThinking]);

  const exploredTodos = useMemo(
    () => todos.filter((todo) => todo.status === "completed"),
    [todos]
  );
  const exploringTodos = useMemo(
    () => todos.filter((todo) => todo.status === "in_progress"),
    [todos]
  );

  const statusTodos = useMemo(() => {
    if (exploration) {
      return [];
    }
    // Keep the list focused: show completed + current + a couple upcoming.
    const activeIndex = todos.findIndex((todo) => todo.status === "in_progress");
    if (activeIndex < 0) {
      return todos.slice(0, 8);
    }
    const start = Math.max(0, activeIndex - 2);
    return todos.slice(start, Math.min(todos.length, activeIndex + 4));
  }, [todos, exploration]);

  const fileCount = files.length;
  const showFilesToolbar = !exploration && fileCount > 0;
  const hasAnything =
    Boolean(exploration?.explored || exploration?.exploring) ||
    statusTodos.length > 0 ||
    trimmedThinking ||
    Boolean(fallbackStatus) ||
    showFilesToolbar;

  if (!hasAnything) {
    return null;
  }

  const inner = (
    <>
      {exploration?.explored && exploredTodos.length ? (
        <CollapsibleTerm
          label={exploration.explored}
          open={exploredOpen}
          onToggle={() => {
            exploredTouchedRef.current = true;
            setExploredOpen((value) => !value);
          }}
        >
          <div className="coop-agent-explore-body">
            <TodoList items={exploredTodos} />
          </div>
        </CollapsibleTerm>
      ) : null}

      {!isComplete && exploration?.exploring && exploringTodos.length ? (
        <CollapsibleTerm
          label={exploration.exploring}
          open={exploringOpen}
          live
          onToggle={() => setExploringOpen((value) => !value)}
        >
          <div className="coop-agent-explore-body">
            <TodoList items={exploringTodos} />
          </div>
        </CollapsibleTerm>
      ) : null}

      {!exploration && statusTodos.length ? <TodoList items={statusTodos} /> : null}

      {!exploration && !statusTodos.length && fallbackStatus ? (
        <p className="coop-agent-fallback-status">{fallbackStatus}</p>
      ) : null}

      {trimmedThinking ? (
        <div className="coop-agent-thinking">
          <button
            type="button"
            className="coop-agent-thinking-toggle"
            aria-expanded={thinkingOpen}
            onClick={() => setThinkingOpen((value) => !value)}
          >
            <span className="coop-agent-thinking-title">
              {thinkingStreaming ? "Thinking" : formatThoughtLabel(isComplete ? thinkingMs : undefined)}
              {thinkingStreaming ? <span className="coop-agent-thinking-pulse" aria-hidden="true" /> : null}
            </span>
            <Chevron open={thinkingOpen} />
          </button>
          {thinkingOpen ? <ThinkingBody text={trimmedThinking} /> : null}
        </div>
      ) : null}

      {showFilesToolbar || (onStop && !isComplete) ? (
        <div className="coop-agent-toolbar">
          <div className="coop-agent-toolbar-left">
            {showFilesToolbar ? (
              <button
                type="button"
                className="coop-agent-files-toggle"
                aria-expanded={filesOpen}
                onClick={() => setFilesOpen((value) => !value)}
              >
                <Chevron open={filesOpen} />
                <span>
                  {fileCount} {fileCount === 1 ? "File" : "Files"}
                </span>
              </button>
            ) : null}
          </div>
          {onStop && !isComplete ? (
            <button type="button" className="coop-agent-stop-btn" onClick={onStop}>
              Stop
            </button>
          ) : null}
        </div>
      ) : null}

      {filesOpen && showFilesToolbar ? (
        <ul className="coop-agent-file-list">
          {files.map((file) => (
            <li key={`${file.action}:${file.path}`} className="coop-agent-file-row">
              <span className="coop-agent-file-action">{labelForFileAction(file.action)}</span>
              {onOpenFile ? (
                <button
                  type="button"
                  className="coop-agent-inline-code coop-agent-path-btn"
                  onClick={() => onOpenFile(file.path)}
                >
                  {file.path}
                </button>
              ) : (
                <code className="coop-agent-inline-code">{file.path}</code>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );

  return (
    <article
      className={`chat-message chat-message--agent-activity${isComplete ? " chat-message--agent-activity-complete" : ""}`}
      aria-label={isComplete ? formatWorkedForLabel(durationMs ?? 0) : "Agent activity"}
    >
      <div className="chat-message-inner chat-message-inner--agent-activity">
        {isComplete ? (
          <>
            <button
              type="button"
              className="coop-agent-worked-toggle"
              aria-expanded={workedOpen}
              onClick={() => setWorkedOpen((value) => !value)}
            >
              <span className="coop-agent-thinking-title">{formatWorkedForLabel(durationMs ?? 0)}</span>
              <Chevron open={workedOpen} />
            </button>
            {workedOpen ? <div className="coop-agent-worked-body">{inner}</div> : null}
          </>
        ) : (
          inner
        )}
      </div>
    </article>
  );
}

function labelForFileAction(action: AgentFileChip["action"]): string {
  switch (action) {
    case "read":
      return "Read";
    case "searched":
      return "Searched";
    default:
      return "Explored";
  }
}
