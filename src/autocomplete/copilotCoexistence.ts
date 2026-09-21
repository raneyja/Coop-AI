import * as vscode from "vscode";

export const COPILOT_EXTENSION_IDS = ["GitHub.copilot", "GitHub.copilot-chat"] as const;

export type CopilotExtensionId = (typeof COPILOT_EXTENSION_IDS)[number];

export type CopilotDetection = {
  installed: CopilotExtensionId[];
  active: boolean;
};

/** VS Code setting that gates Copilot inline ghost text per language. */
export const COPILOT_INLINE_ENABLE_SETTING = "github.copilot.enable";
/**
 * Built-in Copilot still requests ghosts when `github.copilot.enable` is off.
 * This is the switch that was still open on the line the user was testing.
 */
export const COPILOT_NEXT_EDIT_SETTING = "github.copilot.nextEditSuggestions.enabled";

const SNAPSHOT_KEY = "coopAI.copilotEnableSnapshot";
const MANAGED_KEY = "coopAI.copilotInlineManagedByCoop";
const NES_SNAPSHOT_KEY = "coopAI.copilotNextEditSnapshot";
const NES_MANAGED_KEY = "coopAI.copilotNextEditManagedByCoop";

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

function readCopilotNextEditEnabled(): boolean | undefined {
  return vscode.workspace.getConfiguration().get<boolean>(COPILOT_NEXT_EDIT_SETTING);
}

export function isCopilotInlineDisabled(value: CopilotEnableValue | undefined): boolean {
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
    await syncCopilotNextEdit(context, config, true);
    return;
  }

  const managed = context.globalState.get<boolean>(MANAGED_KEY, false);
  if (managed) {
    const snapshot = context.globalState.get<CopilotEnableValue>(SNAPSHOT_KEY);
    await config.update(
      COPILOT_INLINE_ENABLE_SETTING,
      snapshot ?? { "*": true },
      vscode.ConfigurationTarget.Global
    );
    await context.globalState.update(MANAGED_KEY, false);
    await context.globalState.update(SNAPSHOT_KEY, undefined);
  }
  await syncCopilotNextEdit(context, config, false);
}

async function syncCopilotNextEdit(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration,
  coopAutocompleteEnabled: boolean
): Promise<void> {
  if (coopAutocompleteEnabled) {
    const managed = context.globalState.get<boolean>(NES_MANAGED_KEY, false);
    if (!managed) {
      await context.globalState.update(NES_SNAPSHOT_KEY, readCopilotNextEditEnabled() ?? true);
      await context.globalState.update(NES_MANAGED_KEY, true);
    }
    if (readCopilotNextEditEnabled() !== false) {
      await config.update(COPILOT_NEXT_EDIT_SETTING, false, vscode.ConfigurationTarget.Global);
    }
    return;
  }

  const managed = context.globalState.get<boolean>(NES_MANAGED_KEY, false);
  if (!managed) {
    return;
  }
  const snapshot = context.globalState.get<boolean>(NES_SNAPSHOT_KEY, true);
  await config.update(COPILOT_NEXT_EDIT_SETTING, snapshot, vscode.ConfigurationTarget.Global);
  await context.globalState.update(NES_MANAGED_KEY, false);
  await context.globalState.update(NES_SNAPSHOT_KEY, undefined);
}
