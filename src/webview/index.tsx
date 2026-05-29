import React from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "./ChatPanel";
import { SettingsView } from "./SettingsView";
import { startVscodeThemeSync } from "./theme";

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

if (view === "settings") {
  root.render(<SettingsView vscode={vscode} />);
} else {
  root.render(<ChatPanel vscode={vscode} />);
}
