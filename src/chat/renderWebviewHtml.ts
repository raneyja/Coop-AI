import * as vscode from "vscode";
import { activeThemeMode } from "./themeMode";

export type WebviewViewMode = "chat" | "settings";

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options?: { view?: WebviewViewMode; enforceMinWidth?: boolean }
): string {
  const view = options?.view ?? "chat";
  const enforceMinWidth = options?.enforceMinWidth ?? false;
  const themeMode = activeThemeMode();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
  const nonce = createNonce();
  return `<!doctype html>
<html lang="en" data-theme="${themeMode}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>CoopAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__COOP_VIEW__ = "${view}";
      window.__COOP_ENFORCE_MIN_WIDTH__ = ${enforceMinWidth ? "true" : "false"};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

export function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, "dist"),
      vscode.Uri.joinPath(extensionUri, "media"),
      vscode.Uri.joinPath(extensionUri, "src", "webview")
    ]
  };
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
