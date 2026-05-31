import * as vscode from "vscode";
import { VIEW_ID } from "../chat/types";
import {
  SIDEBAR_WIDTH_ENFORCE_COOLDOWN_MS,
  SIDEBAR_WIDTH_ENFORCE_MAX_STEPS,
  SIDEBAR_WIDTH_STEP_PX
} from "./panelMinWidth";

let lastEnforceAt = 0;

/**
 * VS Code does not expose a minimum sidebar width for webview views. When the
 * webview reports it is narrower than our design minimum, nudge the workbench
 * wider using the built-in view resize command.
 */
export async function ensureSidebarMinWidth(currentWidth: number, minWidth: number): Promise<void> {
  if (currentWidth >= minWidth) {
    return;
  }

  const now = Date.now();
  if (now - lastEnforceAt < SIDEBAR_WIDTH_ENFORCE_COOLDOWN_MS) {
    return;
  }
  lastEnforceAt = now;

  await vscode.commands.executeCommand(`${VIEW_ID}.focus`);

  const steps = Math.min(
    Math.ceil((minWidth - currentWidth) / SIDEBAR_WIDTH_STEP_PX),
    SIDEBAR_WIDTH_ENFORCE_MAX_STEPS
  );

  for (let i = 0; i < steps; i++) {
    await vscode.commands.executeCommand("workbench.action.increaseViewWidth");
  }
}
