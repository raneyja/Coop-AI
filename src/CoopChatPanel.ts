import * as vscode from "vscode";
import { CoopChatSession } from "./chat/CoopChatSession";
import { getWebviewOptions } from "./chat/renderWebviewHtml";
import type { SecureApiClient } from "./chat/SecureApiClient";
import { coopSessionRegistry } from "./chat/CoopSessionRegistry";
import { CHAT_PANEL_VIEW_TYPE } from "./chat/types";
import type { CoopRuntimeServices } from "./CoopSidebarProvider";

type PanelState = {
  sessionId?: string;
};

export class CoopChatPanel {
  public static readonly viewType = CHAT_PANEL_VIEW_TYPE;

  private static readonly panels = new Map<string, CoopChatPanel>();

  public static create(
    extensionUri: vscode.Uri,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    options?: { sessionId?: string; moveToNewWindow?: boolean }
  ): CoopChatPanel {
    const sessionId = options?.sessionId ?? `session-${Date.now()}`;
    const existing = CoopChatPanel.panels.get(sessionId);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const panel = vscode.window.createWebviewPanel(
      CoopChatPanel.viewType,
      "Coop AI Chat",
      column,
      {
        ...getWebviewOptions(extensionUri),
        retainContextWhenHidden: true
      }
    );

    const instance = new CoopChatPanel(panel, extensionUri, api, services, sessionId);
    CoopChatPanel.panels.set(sessionId, instance);

    if (options?.moveToNewWindow) {
      void CoopChatPanel.moveToNewWindow(panel);
    }

    return instance;
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    state: PanelState
  ): CoopChatPanel {
    const sessionId = state.sessionId ?? `session-${Date.now()}`;
    const existing = CoopChatPanel.panels.get(sessionId);
    if (existing) {
      return existing;
    }
    const instance = new CoopChatPanel(panel, extensionUri, api, services, sessionId);
    CoopChatPanel.panels.set(sessionId, instance);
    return instance;
  }

  private static async moveToNewWindow(panel: vscode.WebviewPanel): Promise<void> {
    try {
      panel.reveal();
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } catch {
      void vscode.window.showInformationMessage(
        "Could not open Coop AI in a new window automatically. Drag the Coop AI tab to a new window instead."
      );
    }
  }

  private readonly session: CoopChatSession;

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    sessionId: string
  ) {
    this.session = new CoopChatSession({ extensionUri, api, ...services });
    this.session.attachWebview(panel.webview);

    void this.session.initialize().then(() => {
      this.session.refreshEditorContext(vscode.window.activeTextEditor);
    });

    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        this.session.touch();
      }
    });

    panel.onDidDispose(() => {
      CoopChatPanel.panels.delete(sessionId);
      this.session.dispose();
    });

    coopSessionRegistry.setActive(this.session);
  }

  public getSession(): CoopChatSession {
    return this.session;
  }

  public getState(): PanelState {
    return { sessionId: undefined };
  }
}
