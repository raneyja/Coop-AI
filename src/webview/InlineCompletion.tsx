import React from "react";

export type InlineCompletionUiState = {
  visible: boolean;
  previewText?: string;
  suggestionIndex?: number;
  suggestionCount?: number;
  latencyMs?: number;
  sourceLabel?: string;
};

type InlineCompletionProps = {
  state: InlineCompletionUiState;
};

/**
 * Sidebar companion for editor ghost-text completions.
 * VS Code renders inline suggestions in the editor; this panel shows status and shortcuts.
 */
export function InlineCompletion({ state }: InlineCompletionProps): React.ReactElement | null {
  if (!state.visible) {
    return null;
  }

  const indexLabel =
    state.suggestionCount && state.suggestionCount > 1
      ? `${state.suggestionIndex ?? 1}/${state.suggestionCount}`
      : undefined;

  return (
    <div
      className="mx-3 mb-2 rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: "var(--vscode-editorWidget-border, var(--vscode-widget-border))",
        background: "var(--vscode-editorWidget-background, var(--vscode-sideBar-background))",
        color: "var(--vscode-descriptionForeground)"
      }}
      aria-live="polite"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium" style={{ color: "rgb(128, 128, 128)" }}>
          Inline suggestion
        </span>
        <span className="flex items-center gap-2 opacity-80">
          {indexLabel ? <span>{indexLabel}</span> : null}
          {state.sourceLabel ? <span>{state.sourceLabel}</span> : null}
          {typeof state.latencyMs === "number" ? <span>{state.latencyMs}ms</span> : null}
        </span>
      </div>
      {state.previewText ? (
        <pre
          className="mt-1 overflow-x-auto whitespace-pre-wrap rounded px-2 py-1 font-mono text-[11px] italic"
          style={{
            color: "rgb(128, 128, 128)",
            background: "var(--vscode-textBlockQuote-background, rgba(128,128,128,0.12))"
          }}
        >
          {state.previewText}
        </pre>
      ) : (
        <p className="mt-0.5 opacity-90">
          Ghost text appears at the cursor in the editor. Tab to accept, Escape to dismiss.
        </p>
      )}
      <p className="mt-2 text-[10px] opacity-75">
        Alt+] / Alt+[ cycle alternatives · Cmd+Shift+\ manual trigger
      </p>
    </div>
  );
}
