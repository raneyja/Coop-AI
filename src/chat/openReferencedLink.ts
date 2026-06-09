import * as vscode from "vscode";

/** Opens http(s) references in VS Code Simple Browser; falls back to the system browser. */
export async function openReferencedLink(url: string): Promise<void> {
  const normalized = url.trim();
  if (!normalized) {
    return;
  }

  const uri = vscode.Uri.parse(normalized);

  try {
    await vscode.commands.executeCommand("simpleBrowser.show", normalized);
    return;
  } catch {
    // simpleBrowser may be unavailable in some hosts.
  }

  try {
    await vscode.commands.executeCommand("simpleBrowser.api.open", uri);
    return;
  } catch {
    // Fall through to external browser.
  }

  await vscode.env.openExternal(uri);
}
