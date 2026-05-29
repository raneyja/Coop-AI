import React, { useCallback, useEffect, useRef } from "react";

type ChatComposerProps = {
  value: string;
  maxLength: number;
  isStreaming: boolean;
  contextFile?: string;
  usageLabel?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleExplorer: () => void;
};

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

function truncateFile(path: string, max = 22): string {
  const name = path.split("/").pop() || path;
  if (name.length <= max) {
    return name;
  }
  return `…${name.slice(-max + 1)}`;
}

export function ChatComposer({
  value,
  maxLength,
  isStreaming,
  contextFile,
  usageLabel,
  onChange,
  onSend,
  onStop,
  onToggleExplorer
}: ChatComposerProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="coop-canvas-bg relative z-10 shrink-0 px-3 pb-3 pt-2">
      <div className="coop-composer transition-[border-color] duration-150">
        {contextFile ? (
          <div
            className="flex items-center gap-1.5 border-b px-3 py-1.5"
            style={{ borderColor: "var(--coop-composer-border)" }}
          >
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[11px]
                bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]"
              title={contextFile}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-80">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className="truncate">{truncateFile(contextFile)}</span>
            </span>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={isStreaming}
          placeholder="Ask Coop AI a question…"
          aria-label="Chat input"
          onChange={(e) => {
            onChange(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          className="
            block w-full min-w-0 resize-none border-0 bg-transparent px-3 pt-2.5 pb-1
            text-[13px] leading-relaxed text-[var(--coop-composer-text)]
            placeholder:text-[var(--coop-composer-placeholder)]
            outline-none max-h-[140px]
          "
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {usageLabel ? (
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
            <button type="button" title="Attach context" aria-label="Attach context" className="coop-icon-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 5v10M8 9l4-4 4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M5 19h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          </div>

          <div className="flex items-center gap-1">
            {isStreaming ? (
              <button type="button" onClick={onStop} title="Stop" aria-label="Stop" className="coop-icon-btn">
                <StopIcon />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSend}
              disabled={isStreaming || !value.trim()}
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

      <p className="mt-1 text-center text-[10px] text-[var(--coop-panel-muted)] opacity-70">
        {value.length}/{maxLength} · Shift+Enter for new line
      </p>
    </div>
  );
}
