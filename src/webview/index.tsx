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

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
    __COOP_VIEW__?: "chat" | "settings";
  }
}

const vscode = window.acquireVsCodeApi();
const view = window.__COOP_VIEW__ ?? "chat";
startVscodeThemeSync();
const root = createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <AppShell>
    {view === "settings" ? <SettingsView vscode={vscode} /> : <ChatPanel vscode={vscode} />}
  </AppShell>
);
