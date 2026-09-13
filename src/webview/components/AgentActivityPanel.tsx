import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentFileChip, AgentTodoItem, AgentToolRow } from "../agentActivity";
import {
  nextLiveThinkingOpenState,
  partitionActivityTodos,
  summarizeAgentExploration
} from "../agentActivity";
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

/** Cursor-like activity panel: explored work, files, then Thinking last. */
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
  const [researchOpen, setResearchOpen] = useState(!isComplete);
  const thinkingTouchedRef = useRef(false);
  const exploration = useMemo(() => summarizeAgentExploration(tools), [tools]);
  const { plan, research } = useMemo(() => partitionActivityTodos(todos), [todos]);

  useEffect(() => {
    if (!trimmedThinking) {
      thinkingTouchedRef.current = false;
    }
  }, [trimmedThinking]);

  useEffect(() => {
    const nextOpen = nextLiveThinkingOpenState({
      isComplete,
      userTouched: thinkingTouchedRef.current,
      streaming: thinkingStreaming,
      hasText: Boolean(trimmedThinking)
    });
    if (nextOpen === null) {
      return;
    }
    setThinkingOpen(nextOpen);
  }, [isComplete, thinkingStreaming, trimmedThinking]);

  const fileCount = files.length;
  const showLiveThinking = !isComplete && thinkingStreaming;
  const showThinkingHeader = Boolean(trimmedThinking) || showLiveThinking;
  const researchLabel = researchSectionLabel({
    live: !isComplete,
    exploration,
    researchCount: research.length,
    fileCount
  });
  const hasResearch = research.length > 0 || fileCount > 0 || Boolean(exploration);
  const hasAnything =
    plan.length > 0 ||
    hasResearch ||
    showThinkingHeader ||
    Boolean(fallbackStatus) ||
    Boolean(onStop && !isComplete);

  if (!hasAnything) {
    return null;
  }

  const inner = (
    <>
      {showThinkingHeader ? (
        <div className="coop-agent-thinking">
          <div className="coop-agent-thinking-row">
            <button
              type="button"
              className="coop-agent-thinking-toggle"
              aria-expanded={thinkingOpen}
              onClick={() => {
                thinkingTouchedRef.current = true;
                setThinkingOpen((value) => !value);
              }}
            >
              <span className="coop-agent-thinking-title">
                {thinkingStreaming || !isComplete
                  ? "Thinking"
                  : formatThoughtLabel(thinkingMs)}
                {thinkingStreaming ? <span className="coop-agent-thinking-pulse" aria-hidden="true" /> : null}
              </span>
              <Chevron open={thinkingOpen} />
            </button>
            {onStop && !isComplete ? (
              <button type="button" className="coop-agent-stop-btn" onClick={onStop}>
                Stop
              </button>
            ) : null}
          </div>
          {thinkingOpen && trimmedThinking ? <ThinkingBody text={trimmedThinking} /> : null}
        </div>
      ) : onStop && !isComplete ? (
        <div className="coop-agent-toolbar">
          <div className="coop-agent-toolbar-left" />
          <button type="button" className="coop-agent-stop-btn" onClick={onStop}>
            Stop
          </button>
        </div>
      ) : null}

      {plan.length > 0 ? (
        <section className="coop-agent-section" aria-label="Plan">
          <TodoList items={plan} />
        </section>
      ) : null}

      {hasResearch ? (
        <CollapsibleTerm
          label={researchLabel}
          open={researchOpen}
          live={!isComplete && research.some((todo) => todo.status === "in_progress")}
          onToggle={() => setResearchOpen((value) => !value)}
        >
          <div className="coop-agent-explore-body">
            {research.length > 0 ? <TodoList items={research} /> : null}
            {fileCount > 0 ? (
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
          </div>
        </CollapsibleTerm>
      ) : null}

      {!plan.length && !hasResearch && fallbackStatus ? (
        <p className="coop-agent-fallback-status">{fallbackStatus}</p>
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

function researchSectionLabel(input: {
  live: boolean;
  exploration: ReturnType<typeof summarizeAgentExploration>;
  researchCount: number;
  fileCount: number;
}): string {
  if (input.live && input.exploration?.exploring) {
    return input.exploration.exploring;
  }
  if (input.exploration?.explored) {
    return input.exploration.explored;
  }
  if (input.researchCount === 0 && input.fileCount > 0) {
    return input.live
      ? `Reading ${input.fileCount === 1 ? "1 file" : `${input.fileCount} files`}`
      : `Read ${input.fileCount === 1 ? "1 file" : `${input.fileCount} files`}`;
  }
  if (input.researchCount === 1) {
    return input.live ? "Searching" : "Searched";
  }
  return input.live
    ? `Searching · ${input.researchCount}`
    : `Searched ${input.researchCount}`;
}
