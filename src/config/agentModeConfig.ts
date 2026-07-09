import * as vscode from "vscode";

export type AgentModeSetting = "off" | "auto" | "on";

/** Plain-chat agent loop (`search_code`, `read_file`). Default: off. */
export function readAgentModeSetting(): AgentModeSetting {
  const value = vscode.workspace.getConfiguration("coopAI.chat").get<string>("agentMode", "off");
  if (value === "on" || value === "auto") {
    return value;
  }
  return "off";
}
