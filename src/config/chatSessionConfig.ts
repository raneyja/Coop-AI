import * as vscode from "vscode";

/** Default: 4 hours idle before sidebar opens on a fresh thread instead of the last one. */
const DEFAULT_SESSION_IDLE_MINUTES = 240;

/**
 * Milliseconds of inactivity before the sidebar starts on the landing screen.
 * Set `coopAI.chat.sessionIdleMinutes` to 0 to always restore the last thread.
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
