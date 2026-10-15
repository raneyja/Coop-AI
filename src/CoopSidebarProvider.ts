import * as vscode from "vscode";
import { CoopChatSession } from "./chat/CoopChatSession";
import { getWebviewOptions } from "./chat/renderWebviewHtml";
import type { SecureApiClient } from "./chat/SecureApiClient";
import type { DegradationCache } from "./cache/degradationCache";
import type { HealthMonitor } from "./integrations/healthMonitor";
import type { CodeHostRouter } from "./api/codeHosts/codeHostRouter";
import type { CodeHostSecrets } from "./api/codeHosts/codeHostSecrets";
import type { IntegrationSecrets } from "./api/integrations/integrationSecrets";
import { resolveThreadScopeKey } from "./chat/chatThreadStore";
import { WebviewStartup, type WebviewStartupEvent } from "./chat/webviewStartup";
import { COOP_EXTENSION_BUILD_ID, COOP_EXTENSION_BUNDLE_ID } from "./config/coopBuildId";

export type CoopRuntimeServices = {
  healthMonitor: HealthMonitor;
  degradationCache: DegradationCache;
  codeHostRouter: CodeHostRouter;
  codeHostSecrets: CodeHostSecrets;
  integrationSecrets: IntegrationSecrets;
  indexManager: import("./indexing/indexManager").IndexManager;
  indexBackend: import("./indexing/indexBackend").IndexBackend;
  lightningStatusBar: import("./extension/lightningStatusBar").LightningStatusBar;
  identityDirectoryStore: import("./identity/identityDirectoryStore").IdentityDirectoryStore;
  agentOrchestrator: import("./api/agent/AgentOrchestrator").AgentOrchestrator;
};

export class CoopSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private viewSubscriptions: vscode.Disposable[] = [];
  private readonly startupLog = vscode.window.createOutputChannel("CoopAI Startup");
  private readonly startup = new WebviewStartup((event) => this.reportStartupFailure(event));
  public readonly session: CoopChatSession;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionContext: vscode.ExtensionContext,
    api: SecureApiClient,
    services: CoopRuntimeServices
  ) {
    this.session = new CoopChatSession({
      extensionUri,
      extensionContext,
      api,
      ...services,
      // Let the panel shrink freely with the window; the webview reflows responsively
      // instead of forcing the sidebar back to a minimum width.
      enforceSidebarMinWidth: false,
      threadScopeKey: resolveThreadScopeKey(),
      onWebviewStartup: (event) => {
        this.startupLog.appendLine(JSON.stringify({ time: new Date().toISOString(), ...event,
          build: COOP_EXTENSION_BUILD_ID, bundle: COOP_EXTENSION_BUNDLE_ID }));
        this.startup.update(event);
      },
      onDescriptionChange: (description) => {
        if (this.view) {
          this.view.description = description;
        }
      }
    });
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.clearViewSubscriptions();
    this.startup.dispose();
    this.view = webviewView;
    this.startup.setVisible(webviewView.visible);
    webviewView.webview.options = getWebviewOptions(this.extensionUri);
    this.session.attachWebview(webviewView.webview);
    this.session.refreshEditorContext(vscode.window.activeTextEditor);
    void this.session.initialize().catch((error) => {
      console.error("[CoopAI] sidebar initialize failed:", error);
    });

    this.viewSubscriptions.push(webviewView.onDidDispose(() => {
      if (this.view !== webviewView) { return; }
      this.session.detachWebview(webviewView.webview);
      this.startup.dispose();
      this.view = undefined;
      this.clearViewSubscriptions();
    }));

    this.viewSubscriptions.push(webviewView.onDidChangeVisibility(() => {
      if (this.view !== webviewView) { return; }
      this.startup.setVisible(webviewView.visible);
      if (webviewView.visible) {
        // After Extension Host reload the iframe can stay blank until HTML is re-injected.
        this.ensureSidebarWebviewLoaded();
        this.session.touch();
        this.session.refreshEditorContext(vscode.window.activeTextEditor);
      }
    }));
  }

  /** Re-attach HTML when activate runs before resolveWebviewView (EH reload race). */
  public ensureSidebarWebviewLoaded(): void {
    if (!this.view?.visible || this.view.webview.html) {
      return;
    }
    this.view.webview.options = getWebviewOptions(this.extensionUri);
    this.session.attachWebview(this.view.webview);
  }

  public refreshEditorContext(editor: vscode.TextEditor | undefined): void {
    this.session.refreshEditorContext(editor);
  }

  public handleThemeChange(): void {
    this.session.handleThemeChange();
  }

  public clearChat(): void {
    this.session.clearChat();
  }

  public openSettings(): void {
    this.session.openSettings();
  }

  public traceDecisionFromSelection(editor: vscode.TextEditor | undefined): Promise<void> {
    return this.session.traceDecisionFromSelection(editor);
  }

  public dispose(): void {
    this.clearViewSubscriptions();
    this.startup.dispose();
    this.startupLog.dispose();
    this.view = undefined;
    this.session.dispose();
  }

  private clearViewSubscriptions(): void {
    for (const subscription of this.viewSubscriptions) { subscription.dispose(); }
    this.viewSubscriptions = [];
  }

  private reportStartupFailure(event: WebviewStartupEvent): void {
    const view = this.view;
    const restoring = event.stage === "webview-ready" || event.stage === "session-failed";
    const reason = restoring ? "CoopAI could not finish restoring this chat."
      : event.stage === "html-assigned" ? "The CoopAI sidebar did not acknowledge document startup."
      : "CoopAI could not finish loading the sidebar interface.";
    this.startupLog.appendLine(JSON.stringify({ time: new Date().toISOString(), ...event, failure: true }));
    // The outer frame may never load, so this failure must live in VS Code's UI.
    // No automatic HTML retry: it cannot repair a pending VS Code frame request.
    void vscode.window.showErrorMessage(`${reason} Your saved chats are preserved. Reload this window to retry, or open the startup log for details.`,
      "Reload Window", "Show Startup Log").then((action) => {
      if (this.view !== view || !view?.visible || !this.startup.owns(event.generation)) { return; }
      if (action === "Reload Window") { void vscode.commands.executeCommand("workbench.action.reloadWindow"); }
      if (action === "Show Startup Log") { this.startupLog.show(true); }
    });
  }
}
