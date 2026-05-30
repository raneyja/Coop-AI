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

function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class CoopChatPanel {
  public static readonly viewType = CHAT_PANEL_VIEW_TYPE;

  private static readonly panels = new Map<string, CoopChatPanel>();

  public static create(
    extensionUri: vscode.Uri,
    extensionContext: vscode.ExtensionContext,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    options?: { sessionId?: string; moveToNewWindow?: boolean }
  ): CoopChatPanel {
    const sessionId = options?.sessionId ?? createSessionId();
    const existing = CoopChatPanel.panels.get(sessionId);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active, true);
      return existing;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
    const panel = vscode.window.createWebviewPanel(
      CoopChatPanel.viewType,
      "New Chat",
      column,
      {
        ...getWebviewOptions(extensionUri),
        retainContextWhenHidden: true
      }
    );

    const instance = new CoopChatPanel(panel, extensionUri, extensionContext, api, services, sessionId);
    CoopChatPanel.panels.set(sessionId, instance);
    panel.reveal(vscode.ViewColumn.Active, true);

    if (options?.moveToNewWindow) {
      void CoopChatPanel.moveToNewWindow(panel);
    }

    return instance;
  }

  public static getActive(): CoopChatPanel | undefined {
    for (const panel of CoopChatPanel.panels.values()) {
      if (panel.panel.active) {
        return panel;
      }
    }
    return undefined;
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionContext: vscode.ExtensionContext,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    state: PanelState
  ): CoopChatPanel {
    const sessionId = state.sessionId ?? createSessionId();
    const existing = CoopChatPanel.panels.get(sessionId);
    if (existing) {
      return existing;
    }
    const instance = new CoopChatPanel(panel, extensionUri, extensionContext, api, services, sessionId);
    CoopChatPanel.panels.set(sessionId, instance);
    return instance;
  }

  private static async moveToNewWindow(panel: vscode.WebviewPanel): Promise<void> {
    try {
      panel.reveal();
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } catch {
      void vscode.window.showInformationMessage(
        "Could not open CoopAI in a new window automatically. Drag the CoopAI tab to a new window instead."
      );
    }
  }

  private readonly session: CoopChatSession;
  private readonly sessionId: string;

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionContext: vscode.ExtensionContext,
    api: SecureApiClient,
    services: CoopRuntimeServices,
    sessionId: string
  ) {
    this.sessionId = sessionId;
    this.session = new CoopChatSession({
      extensionUri,
      extensionContext,
      api,
      ...services,
      onTitleChange: (title) => {
        this.panel.title = title;
      }
    });
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
    return { sessionId: this.sessionId };
  }
}
