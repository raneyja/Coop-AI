import * as vscode from "vscode";
import { resolveEditorFileUri } from "../context/editorFileContext";
import {
  applyRemoteFirstFileIdentity,
  classifyEditorFileIdentityDecoration
} from "../context/remoteFirstFileIdentity";
import { readConfiguration } from "../chat/SecureApiClient";

/**
 * Shows L/R badges on editor tabs so local vs remote file identity is visible
 * without relying on the chat chip alone.
 */
export class EditorFileIdentityDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== "file" && uri.scheme !== "github" && uri.scheme !== "vscode-vfs") {
      return undefined;
    }
    const prefs = readConfiguration();
    const resolved = applyRemoteFirstFileIdentity(resolveEditorFileUri(uri), {
      owner: prefs.owner,
      repo: prefs.repo
    });
    const identity = classifyEditorFileIdentityDecoration(resolved);
    if (!identity) {
      return undefined;
    }
    return new vscode.FileDecoration(identity.badge, identity.tooltip);
  }

  refresh(uri?: vscode.Uri | vscode.Uri[]): void {
    this._onDidChangeFileDecorations.fire(uri);
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}

export function registerEditorFileIdentityDecorations(
  context: vscode.ExtensionContext
): EditorFileIdentityDecorationProvider {
  const provider = new EditorFileIdentityDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(provider),
    provider
  );
  return provider;
}
