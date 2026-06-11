import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatFileMention, ChatImageAttachment, MentionSearchResult } from "../../chat/types";
import { LaunchTypewriter } from "./LaunchTypewriter";
import type { LaunchIntroPhase } from "../hooks/useLaunchTypewriter";
import {
  matchSlashCommands,
  segmentComposerSlashHighlights,
  slashCommandDisplayToken,
  slashMenuQuery,
  slashMenuRange,
  type SlashCommandDef
} from "../../context/slashCommands";
import {
  attachmentsFromClipboard,
  attachmentsFromDataTransfer,
  mergeAttachments,
  readImageFiles
} from "../attachmentUtils";

type ChatComposerProps = {
  value: string;
  maxLength: number;
  isStreaming: boolean;
  variant?: "landing" | "chat";
  usageLabel?: string;
  attachments: ChatImageAttachment[];
  attachmentError?: string;
  onChange: (value: string) => void;
  onAttachmentsChange: (attachments: ChatImageAttachment[]) => void;
  onAttachmentError: (message: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleExplorer: () => void;
  launchIntroPhase?: LaunchIntroPhase;
  launchIntroVisibleLength?: number;
  launchIntroFlashIndex?: number | null;
  onLaunchIntroSkip?: () => void;
  mentions?: ChatFileMention[];
  onMentionsChange?: (mentions: ChatFileMention[]) => void;
  onMentionSearch?: (pattern: string) => void;
  mentionResults?: MentionSearchResult[];
  mentionLoading?: boolean;
  mentionError?: string;
  mentionHint?: string;
};

const MAX_MENTIONS = 3;

function mentionMenuQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]{0,80})$/.exec(before);
  return match ? match[1] : null;
}

function mentionMenuRange(value: string, cursor: number): { start: number; end: number } | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]{0,80})$/.exec(before);
  if (!match || match.index === undefined) {
    return null;
  }
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }
  return { start: atIndex, end: cursor };
}

function SendIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h12M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function PaperclipIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatComposer({
  value,
  maxLength,
  isStreaming,
  variant = "landing",
  usageLabel,
  attachments,
  attachmentError,
  onChange,
  onAttachmentsChange,
  onAttachmentError,
  onSend,
  onStop,
  onToggleExplorer,
  launchIntroPhase = "done",
  launchIntroVisibleLength = 0,
  launchIntroFlashIndex = null,
  onLaunchIntroSkip,
  mentions = [],
  onMentionsChange,
  onMentionSearch,
  mentionResults = [],
  mentionLoading = false,
  mentionError,
  mentionHint
}: ChatComposerProps): React.ReactElement {
  const isChat = variant === "chat";
  const launchIntroActive = !isChat && launchIntroPhase !== "done";
  const launchIntroDone = !isChat && launchIntroPhase === "done";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSend = Boolean(value.trim() || attachments.length);
  const highlightSegments = useMemo(() => segmentComposerSlashHighlights(value), [value]);

  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const slashQuery = slashMenuQuery(value, cursorPosition);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) {
      return [];
    }
    return matchSlashCommands(slashQuery);
  }, [slashQuery]);
  const showSlashMenu = !isStreaming && !slashDismissed && slashMatches.length > 0;
  const mentionQuery = mentionMenuQuery(value, cursorPosition);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const showMentionMenu =
    !isStreaming &&
    !mentionDismissed &&
    mentionQuery !== null &&
    mentions.length < MAX_MENTIONS;
  const mentionSearchTimer = useRef<number | null>(null);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    if (mentionSearchTimer.current !== null) {
      window.clearTimeout(mentionSearchTimer.current);
    }
    if (!onMentionSearch || mentionQuery === null || mentions.length >= MAX_MENTIONS) {
      return;
    }
    mentionSearchTimer.current = window.setTimeout(() => {
      onMentionSearch(mentionQuery);
    }, 250);
    return () => {
      if (mentionSearchTimer.current !== null) {
        window.clearTimeout(mentionSearchTimer.current);
      }
    };
  }, [mentionQuery, mentions.length, onMentionSearch]);

  const syncCursor = useCallback((el: HTMLTextAreaElement) => {
    setCursorPosition(el.selectionStart);
  }, []);

  const syncMirrorScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!textarea || !mirror) {
      return;
    }
    mirror.scrollTop = textarea.scrollTop;
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    syncMirrorScroll();
  }, [syncMirrorScroll]);

  const applySlashCommand = useCallback(
    (def: SlashCommandDef) => {
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? cursorPosition;
      const range = slashMenuRange(value, cursor);
      const token = `/${slashCommandDisplayToken(def)} `;
      if (range) {
        const next = value.slice(0, range.start) + token + value.slice(range.end);
        onChange(next);
        const newCursor = range.start + token.length;
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(newCursor, newCursor);
          setCursorPosition(newCursor);
        });
      } else {
        onChange(token);
        requestAnimationFrame(() => {
          el?.focus();
          const pos = token.length;
          el?.setSelectionRange(pos, pos);
          setCursorPosition(pos);
        });
      }
    },
    [cursorPosition, onChange, value]
  );

  const skipLaunchIntroIfNeeded = useCallback(() => {
    if (launchIntroActive) {
      onLaunchIntroSkip?.();
    }
  }, [launchIntroActive, onLaunchIntroSkip]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const addAttachments = useCallback(
    async (files: FileList | File[]) => {
      try {
        const incoming = await readImageFiles(files);
        if (!incoming.length) {
          onAttachmentError("Only PNG, JPEG, GIF, and WebP images are supported.");
          return;
        }
        onAttachmentError("");
        onAttachmentsChange(mergeAttachments(attachments, incoming, onAttachmentError));
      } catch (error) {
        onAttachmentError(error instanceof Error ? error.message : "Could not attach image.");
      }
    },
    [attachments, onAttachmentError, onAttachmentsChange]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const incoming = await attachmentsFromClipboard(event.clipboardData);
      if (!incoming.length) {
        return;
      }
      event.preventDefault();
      try {
        onAttachmentError("");
        onAttachmentsChange(mergeAttachments(attachments, incoming, onAttachmentError));
      } catch (error) {
        onAttachmentError(error instanceof Error ? error.message : "Could not attach image.");
      }
    },
    [attachments, onAttachmentError, onAttachmentsChange]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isStreaming) {
        return;
      }
      try {
        const incoming = await attachmentsFromDataTransfer(event.dataTransfer);
        if (!incoming.length) {
          return;
        }
        onAttachmentError("");
        onAttachmentsChange(mergeAttachments(attachments, incoming, onAttachmentError));
      } catch (error) {
        onAttachmentError(error instanceof Error ? error.message : "Could not attach image.");
      }
    },
    [attachments, isStreaming, onAttachmentError, onAttachmentsChange]
  );

  const applyMention = useCallback(
    (item: MentionSearchResult) => {
      if (!onMentionsChange || mentions.length >= MAX_MENTIONS) {
        return;
      }
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? cursorPosition;
      const range = mentionMenuRange(value, cursor);
      const label = item.path.split("/").pop() ?? item.path;
      const nextMention: ChatFileMention = {
        repoId: item.repoId,
        path: item.path,
        snippet: item.content
      };
      onMentionsChange([...mentions, nextMention]);
      if (range) {
        const next = `${value.slice(0, range.start)}@${label} ${value.slice(range.end)}`;
        onChange(next);
        const newCursor = range.start + label.length + 2;
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(newCursor, newCursor);
          setCursorPosition(newCursor);
        });
      }
      setMentionDismissed(true);
    },
    [cursorPosition, mentions, onChange, onMentionsChange, value]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    skipLaunchIntroIfNeeded();
    if (showMentionMenu && mentionResults.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(mentionResults[mentionActiveIndex] ?? mentionResults[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (showSlashMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActiveIndex((index) => (index + 1) % slashMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActiveIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySlashCommand(slashMatches[slashActiveIndex] ?? slashMatches[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !isStreaming) {
        onSend();
      }
    }
  };

  return (
    <div className={`relative z-10 shrink-0 ${isChat ? "chat-composer--active" : "coop-canvas-bg px-3 pb-3 pt-2"}`}>
      <div
        className={`coop-composer relative transition-[border-color] duration-150${
          launchIntroActive ? " coop-composer--launch-intro" : ""
        }${launchIntroDone ? " coop-composer--launch-ready" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={handleDrop}
      >
        {launchIntroActive ? (
          <LaunchTypewriter
            phase={launchIntroPhase}
            visibleLength={launchIntroVisibleLength}
            flashIndex={launchIntroFlashIndex}
          />
        ) : null}
        {showMentionMenu ? (
          <div className="coop-prompt-menu" role="listbox" aria-label="File mentions">
            <div className="coop-prompt-menu-panel">
              {mentionLoading ? (
                <p className="coop-prompt-modal-muted px-3 py-2 text-xs">Searching indexed files…</p>
              ) : mentionError ? (
                <p className="coop-settings-test-message--error px-3 py-2 text-xs">{mentionError}</p>
              ) : mentionResults.length === 0 ? (
                <p className="coop-prompt-modal-muted px-3 py-2 text-xs">
                  {mentionHint ??
                    `No indexed files match "${mentionQuery}". Check Workspace → Search scope is set to your collection and wait for repo indexing to finish.`}
                </p>
              ) : (
                <ul className="coop-prompt-menu-list">
                  {mentionResults.map((item, index) => (
                    <li key={`${item.repoId}:${item.path}:${item.lineNumber ?? 0}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === mentionActiveIndex}
                        className={`coop-prompt-menu-row${
                          index === mentionActiveIndex ? " coop-prompt-menu-row--active" : ""
                        }`}
                        onMouseEnter={() => setMentionActiveIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyMention(item);
                        }}
                      >
                        <span className="coop-prompt-menu-row-label">
                          <span className="font-medium">{item.path}</span>
                          <span className="ml-2 text-[var(--coop-panel-muted)]">{item.repoId}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
        {showSlashMenu ? (
          <div className="coop-prompt-menu" role="listbox" aria-label="Slash commands">
            <div className="coop-prompt-menu-panel">
              <ul className="coop-prompt-menu-list">
                {slashMatches.map((def, index) => (
                  <li key={def.name}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === slashActiveIndex}
                      className={`coop-prompt-menu-row${
                        index === slashActiveIndex ? " coop-prompt-menu-row--active" : ""
                      }`}
                      onMouseEnter={() => setSlashActiveIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySlashCommand(def);
                      }}
                    >
                      <span className="coop-prompt-menu-row-label">
                        <span className="coop-slash-hint-command font-medium">
                          /{slashCommandDisplayToken(def)}
                        </span>
                        <span className="ml-2 text-[var(--coop-panel-muted)]">{def.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {mentions.length > 0 ? (
          <div
            className="flex flex-wrap gap-1.5 border-b px-3 py-2"
            style={{ borderColor: "var(--coop-composer-border)" }}
          >
            {mentions.map((mention) => (
              <span
                key={`${mention.repoId}:${mention.path}`}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)] px-2 py-0.5 text-[11px]"
                title={`${mention.repoId} · ${mention.path}`}
              >
                <span className="truncate max-w-[180px]">{mention.path.split("/").pop() ?? mention.path}</span>
                <button
                  type="button"
                  aria-label={`Remove ${mention.path}`}
                  disabled={isStreaming}
                  className="text-[var(--coop-panel-muted)] hover:text-[var(--coop-panel-foreground)]"
                  onClick={() =>
                    onMentionsChange?.(mentions.filter((entry) => entry.path !== mention.path || entry.repoId !== mention.repoId))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div
            className="flex flex-wrap gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--coop-composer-border)" }}
          >
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative h-14 w-14 overflow-hidden rounded-md border border-[var(--coop-border)] bg-[var(--coop-composer-surface)]"
                title={attachment.name}
              >
                <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  disabled={isStreaming}
                  onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))}
                  className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className={`coop-composer-input-grid${launchIntroActive ? " opacity-0" : ""}`}>
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className="coop-composer-input-mirror"
          >
            {highlightSegments.map((segment, index) =>
              segment.kind === "slash-command" ? (
                <span key={index} className="coop-slash-hint-command">
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
            {value.endsWith("\n") ? " " : "\n"}
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            disabled={isStreaming}
            placeholder={isChat ? "Ask a follow-up, or type /…" : "Ask Coop, or type / for commands"}
            aria-label="Chat input"
            onChange={(e) => {
              onChange(e.target.value);
              syncCursor(e.target);
              setSlashDismissed(false);
              setMentionDismissed(false);
              resize();
            }}
            onFocus={(e) => {
              syncCursor(e.currentTarget);
              skipLaunchIntroIfNeeded();
            }}
            onClick={(e) => {
              syncCursor(e.currentTarget);
              skipLaunchIntroIfNeeded();
            }}
            onSelect={(e) => syncCursor(e.currentTarget)}
            onKeyUp={(e) => syncCursor(e.currentTarget)}
            onScroll={syncMirrorScroll}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            className="coop-composer-input"
          />
        </div>

        <div className="coop-composer-toolbar flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {!isChat && usageLabel ? (
              <span className="truncate text-[10px] text-[var(--vscode-descriptionForeground)]" title={usageLabel}>
                {usageLabel}
              </span>
            ) : null}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Remote workspace"
                aria-label="Remote workspace"
                onClick={onToggleExplorer}
                className="coop-icon-btn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 7h5l2 2h11v8H3V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                title="Attach image"
                aria-label="Attach image"
                disabled={isStreaming}
                onClick={() => fileInputRef.current?.click()}
                className="coop-icon-btn"
              >
                <PaperclipIcon />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = event.target.files;
                  if (files?.length) {
                    void addAttachments(files);
                  }
                  event.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="coop-composer-toolbar-actions flex items-center gap-1">
            {isStreaming ? (
              <button type="button" onClick={onStop} title="Stop" aria-label="Stop" className="coop-icon-btn">
                <StopIcon />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSend}
              disabled={isStreaming || !canSend}
              title="Send"
              aria-label="Send"
              className="
                flex h-7 w-7 items-center justify-center rounded
                bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]
                hover:bg-[var(--vscode-button-hoverBackground)]
                disabled:cursor-not-allowed disabled:opacity-40
                transition-colors duration-150
              "
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      {!isChat ? (
        <p className="mt-1 text-center text-[10px] text-[var(--coop-panel-muted)] opacity-70">
          {value.length}/{maxLength} · Shift+Enter for new line
          {attachmentError ? (
            <span className="coop-settings-test-message--error block">{attachmentError}</span>
          ) : null}
        </p>
      ) : attachmentError ? (
        <p className="coop-settings-test-message--error mt-1 text-center text-[10px]">{attachmentError}</p>
      ) : null}
    </div>
  );
}
