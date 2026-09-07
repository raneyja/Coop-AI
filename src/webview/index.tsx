import React from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "./ChatPanel";
import { SettingsView } from "./SettingsView";
import { usePanelWidthMode } from "./hooks/usePanelWidthMode";
import { startVscodeThemeSync } from "./theme";

function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  usePanelWidthMode();
  return <>{children}</>;
}

class BootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: Error }
> {
  public state: { error?: Error } = {};

  public static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  public render(): React.ReactNode {
    if (this.state.error) {
      return (
        <pre style={{ color: "#d4d4d4", padding: 16, whiteSpace: "pre-wrap", font: "12px/1.4 monospace" }}>
          {`CoopAI failed to load.\n${this.state.error.stack ?? this.state.error.message}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
    __coopVscodeApi?: ReturnType<Window["acquireVsCodeApi"]>;
    __COOP_VIEW__?: "chat" | "settings";
  }
}

function showBootError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  root.textContent = `CoopAI failed to load.\n${message}`;
}

function getVsCodeApi(): ReturnType<Window["acquireVsCodeApi"]> {
  if (!window.__coopVscodeApi) {
    window.__coopVscodeApi = window.acquireVsCodeApi();
  }
  return window.__coopVscodeApi;
}

try {
  const vscode = getVsCodeApi();
  const view = window.__COOP_VIEW__ ?? "chat";
  startVscodeThemeSync();
  const mount = document.getElementById("root");
  if (!mount) {
    throw new Error("Missing #root");
  }
  const root = createRoot(mount);
  root.render(
    <BootErrorBoundary>
      <AppShell>
        {view === "settings" ? <SettingsView vscode={vscode} /> : <ChatPanel vscode={vscode} />}
      </AppShell>
    </BootErrorBoundary>
  );
} catch (error) {
  showBootError(error);
}
