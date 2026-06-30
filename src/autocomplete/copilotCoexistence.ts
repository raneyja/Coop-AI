import * as vscode from "vscode";
import type { CopilotPolicy } from "./types";

export const COPILOT_EXTENSION_IDS = ["GitHub.copilot", "GitHub.copilot-chat"] as const;

export type CopilotExtensionId = (typeof COPILOT_EXTENSION_IDS)[number];

export type CopilotDetection = {
  installed: CopilotExtensionId[];
  active: boolean;
};

export function detectCopilotExtensions(): CopilotDetection {
  const installed: CopilotExtensionId[] = [];
  for (const id of COPILOT_EXTENSION_IDS) {
    if (vscode.extensions.getExtension(id)) {
      installed.push(id);
    }
  }
  const active = installed.some((id) => vscode.extensions.getExtension(id)?.isActive === true);
  return { installed, active };
}

export function isCopilotInstalled(): boolean {
  return detectCopilotExtensions().installed.length > 0;
}

export function shouldYieldToCopilot(policy: CopilotPolicy): boolean {
  return policy === "disable-when-copilot" && isCopilotInstalled();
}

export function copilotCoexistenceWarning(): string | undefined {
  const { installed } = detectCopilotExtensions();
  if (installed.length === 0) {
    return undefined;
  }
  const names = installed.map((id) => id.replace("GitHub.", "GitHub ")).join(" and ");
  return `${names} is installed — you may see competing inline suggestions. Set coopAI.autocomplete.copilotPolicy to disable-when-copilot to prefer Copilot.`;
}

export function onCopilotExtensionsChanged(listener: () => void): vscode.Disposable {
  return vscode.extensions.onDidChange(() => listener());
}
