import * as fs from "node:fs";
import * as vscode from "vscode";
import { activeThemeMode } from "./themeMode";

export type WebviewViewMode = "chat" | "settings";

function webviewAssetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...pathSegments: string[]
): vscode.Uri {
  const fileUri = vscode.Uri.joinPath(extensionUri, ...pathSegments);
  let version = Date.now().toString(36);
  try {
    version = String(fs.statSync(fileUri.fsPath).mtimeMs);
  } catch {
    /* dist asset may be missing during partial builds */
  }
  return webview.asWebviewUri(fileUri).with({ query: `v=${version}` });
}

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options?: { view?: WebviewViewMode; enforceMinWidth?: boolean }
): string {
  const view = options?.view ?? "chat";
  const enforceMinWidth = options?.enforceMinWidth ?? false;
  const themeMode = activeThemeMode();
  const scriptUri = webviewAssetUri(webview, extensionUri, "dist", "webview.js");
  const styleUri = webviewAssetUri(webview, extensionUri, "dist", "webview.css");
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
    <div id="root" style="color:#d4d4d4;padding:16px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif">Starting CoopAI…</div>
    <script nonce="${nonce}">
      window.__COOP_VIEW__ = "${view}";
      window.__COOP_ENFORCE_MIN_WIDTH__ = ${enforceMinWidth ? "true" : "false"};
      window.addEventListener("error", function (event) {
        var root = document.getElementById("root");
        if (!root) { return; }
        var loc = event.filename ? (event.filename + ":" + event.lineno) : "";
        root.textContent = "CoopAI failed to load. " + (event.message || "Unknown error") + (loc ? "\\n" + loc : "");
      });
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
