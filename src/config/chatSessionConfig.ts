import * as vscode from "vscode";

/** @deprecated Activate always starts on a blank thread; kept for package.json / callers. */
const DEFAULT_SESSION_IDLE_MINUTES = 240;

/**
 * @deprecated Idle no longer gates startup restore — activate always lands on a blank thread.
 * Retained so existing settings keys and callers keep compiling.
 */
export function readChatSessionIdleMs(): number {
  const minutes = vscode.workspace
    .getConfiguration("coopAI.chat")
    .get<number>("sessionIdleMinutes", DEFAULT_SESSION_IDLE_MINUTES);
  if (minutes <= 0) {
    return 0;
  }
  return minutes * 60_000;
}
