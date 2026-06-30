import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/**
 * Best-effort git user.email for attributing extension thread sync to org members.
 */
export async function resolveGitUserEmail(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("git", ["config", "user.email"], { cwd: folder });
    const email = stdout.trim();
    return email.includes("@") ? email : undefined;
  } catch {
    return undefined;
  }
}
