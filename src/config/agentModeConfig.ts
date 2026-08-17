import * as vscode from "vscode";

export type AgentModeSetting = "off" | "auto" | "on";

/**
 * Agent is product-default **on** for locate / change / understand repo hunts.
 * Coop Settings no longer exposes a toggle. VS Code `coopAI.chat.agentMode` remains
 * a kill switch only (`off` / `auto` still honored if set in settings.json).
 */
export function readAgentModeSetting(): AgentModeSetting {
  const value = vscode.workspace.getConfiguration("coopAI.chat").get<string>("agentMode", "on");
  if (value === "off" || value === "auto") {
    return value;
  }
  return "on";
}
