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
};

export class CoopSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
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
      onDescriptionChange: (description) => {
        if (this.view) {
          this.view.description = description;
        }
      }
    });
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = getWebviewOptions(this.extensionUri);
    this.session.attachWebview(webviewView.webview);
    await this.session.initialize();
    this.session.refreshEditorContext(vscode.window.activeTextEditor);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.session.touch();
      }
    });
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
    this.session.dispose();
  }
}
