import * as vscode from "vscode";
import { readConfiguration, type SecureApiClient } from "../chat/SecureApiClient";
import { getWebviewOptions, renderWebviewHtml } from "../chat/renderWebviewHtml";
import { parseSupportSubmission, type SupportDiagnostics } from "./supportTypes";

export class SupportReportPanel {
  private static panel: vscode.WebviewPanel | undefined;

  public static open(context: vscode.ExtensionContext, api: SecureApiClient): void {
    if (this.panel) { this.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("coopAI.support", "Report an issue · CoopAI", vscode.ViewColumn.Active, {
      ...getWebviewOptions(context.extensionUri), retainContextWhenHidden: true
    });
    this.panel = panel;
    const diagnostics: SupportDiagnostics = {
      extensionVersion: String(context.extension.packageJSON.version), vscodeVersion: vscode.version,
      platform: process.platform, architecture: process.arch
    };
    let sending = false;
    let receipt: string | undefined;
    const listener = panel.webview.onDidReceiveMessage(async (message: { type?: string; payload?: unknown }) => {
      if (message.type === "support:close") { panel.dispose(); return; }
      if (message.type === "support:ready") {
        await panel.webview.postMessage({ type: "support:init", payload: { diagnostics, contactEmail: "" } });
        let contactEmail = "";
        if (await api.getToken()) {
          try { contactEmail = (await api.fetchMe(readConfiguration().apiBaseUrl)).email ?? ""; } catch { /* manual email remains available */ }
        }
        await panel.webview.postMessage({ type: "support:init", payload: { diagnostics, contactEmail } });
        return;
      }
      if (message.type !== "support:submit" || sending) return;
      if (receipt) { await panel.webview.postMessage({ type: "support:sent", payload: { id: receipt } }); return; }
      sending = true;
      try {
        const input = parseSupportSubmission(message.payload);
        const report = { ...input, ...(input.diagnostics ? { diagnostics } : {}) };
        const result = await api.submitSupportReport(readConfiguration().apiBaseUrl, report);
        receipt = result.id;
        await panel.webview.postMessage({ type: "support:sent", payload: result });
      } catch (error) {
        // Axios errors can contain credentials; display only a safe user-facing message.
        const message = error instanceof Error && error.name !== "AxiosError" ? error.message : "Could not confirm delivery. Your draft is still here. Try again or email support@coop-ai.dev.";
        await panel.webview.postMessage({ type: "support:error", payload: { message } });
      } finally { sending = false; }
    });
    panel.onDidDispose(() => { listener.dispose(); if (this.panel === panel) this.panel = undefined; });
    context.subscriptions.push(panel);
    panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, { view: "support" });
  }
}
