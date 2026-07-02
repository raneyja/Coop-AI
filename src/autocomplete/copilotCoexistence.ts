import * as vscode from "vscode";

export const COPILOT_EXTENSION_IDS = ["GitHub.copilot", "GitHub.copilot-chat"] as const;

export type CopilotExtensionId = (typeof COPILOT_EXTENSION_IDS)[number];

export type CopilotDetection = {
  installed: CopilotExtensionId[];
  active: boolean;
};

/** VS Code setting that gates Copilot inline ghost text per language. */
export const COPILOT_INLINE_ENABLE_SETTING = "github.copilot.enable";

const SNAPSHOT_KEY = "coopAI.copilotEnableSnapshot";
const MANAGED_KEY = "coopAI.copilotInlineManagedByCoop";

export type CopilotEnableValue = boolean | Record<string, boolean>;

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

export function onCopilotExtensionsChanged(listener: () => void): vscode.Disposable {
  return vscode.extensions.onDidChange(() => listener());
}

function readCopilotEnable(): CopilotEnableValue | undefined {
  return vscode.workspace.getConfiguration().get<CopilotEnableValue>(COPILOT_INLINE_ENABLE_SETTING);
}

function isCopilotInlineDisabled(value: CopilotEnableValue | undefined): boolean {
  if (value === false) {
    return true;
  }
  if (typeof value === "object" && value !== null && value["*"] === false) {
    return true;
  }
  return false;
}

/**
 * When Coop autocomplete is on, disable Copilot inline suggestions and restore
 * the user's prior setting when Coop autocomplete is turned off.
 */
export async function syncCopilotInlineWithCoopAutocomplete(
  context: vscode.ExtensionContext,
  coopAutocompleteEnabled: boolean
): Promise<void> {
  if (!isCopilotInstalled()) {
    return;
  }

  const config = vscode.workspace.getConfiguration();

  if (coopAutocompleteEnabled) {
    const managed = context.globalState.get<boolean>(MANAGED_KEY, false);
    if (!managed) {
      const current = readCopilotEnable();
      await context.globalState.update(SNAPSHOT_KEY, current ?? { "*": true });
      await context.globalState.update(MANAGED_KEY, true);
    }
    const current = readCopilotEnable();
    if (!isCopilotInlineDisabled(current)) {
      await config.update(
        COPILOT_INLINE_ENABLE_SETTING,
        { "*": false },
        vscode.ConfigurationTarget.Global
      );
    }
    return;
  }

  const managed = context.globalState.get<boolean>(MANAGED_KEY, false);
  if (!managed) {
    return;
  }

  const snapshot = context.globalState.get<CopilotEnableValue>(SNAPSHOT_KEY);
  await config.update(
    COPILOT_INLINE_ENABLE_SETTING,
    snapshot ?? { "*": true },
    vscode.ConfigurationTarget.Global
  );
  await context.globalState.update(MANAGED_KEY, false);
  await context.globalState.update(SNAPSHOT_KEY, undefined);
}
