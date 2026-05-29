import * as vscode from "vscode";
import type { CoopChatSession } from "./chat/CoopChatSession";
import { getWebviewOptions, renderWebviewHtml } from "./chat/renderWebviewHtml";
import { SETTINGS_PANEL_VIEW_TYPE } from "./chat/types";

type SettingsPanelState = Record<string, never>;

export class CoopSettingsPanel {
  public static readonly viewType = SETTINGS_PANEL_VIEW_TYPE;

  private static instance: CoopSettingsPanel | undefined;

  public static createOrReveal(extensionUri: vscode.Uri, session: CoopChatSession): CoopSettingsPanel {
    if (CoopSettingsPanel.instance) {
      CoopSettingsPanel.instance.bindSession(session);
      CoopSettingsPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      return CoopSettingsPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      CoopSettingsPanel.viewType,
      "Coop AI Settings",
      vscode.ViewColumn.Active,
      {
        ...getWebviewOptions(extensionUri),
        retainContextWhenHidden: true
      }
    );

    CoopSettingsPanel.instance = new CoopSettingsPanel(panel, extensionUri, session);
    return CoopSettingsPanel.instance;
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    session: CoopChatSession
  ): CoopSettingsPanel {
    if (CoopSettingsPanel.instance) {
      CoopSettingsPanel.instance.bindSession(session);
      return CoopSettingsPanel.instance;
    }
    return new CoopSettingsPanel(panel, extensionUri, session);
  }

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private session: CoopChatSession
  ) {
    panel.webview.options = getWebviewOptions(extensionUri);
    this.bindSession(session);

    panel.onDidDispose(() => {
      this.session.detachSettingsWebview();
      CoopSettingsPanel.instance = undefined;
    });
  }

  private bindSession(session: CoopChatSession): void {
    if (this.session !== session) {
      this.session.detachSettingsWebview();
      this.session = session;
    }
    session.attachSettingsWebview(this.panel.webview, () => {
      this.panel.dispose();
    });
  }

  public getState(): SettingsPanelState {
    return {};
  }
}
