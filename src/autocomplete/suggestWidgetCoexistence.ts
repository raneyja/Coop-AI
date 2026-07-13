import * as vscode from "vscode";

/**
 * VS Code setting that controls whether the native suggest widget (e.g. the TS/JS member
 * dropdown shown after typing `.`) is allowed to auto-open while an inline suggestion (ghost
 * text) is available. VS Code's default lets the suggest widget win — its dropdown stays
 * visible and Coop's ghost text is never rendered, even though the completion provider
 * returned items. See https://github.com/microsoft/vscode/issues/265595 and
 * https://github.com/microsoft/vscode/issues/315373 for the underlying editor behavior.
 */
export const SUPPRESS_SUGGEST_WIDGET_SETTING = "editor.inlineSuggest.suppressSuggestions";

const SNAPSHOT_KEY = "coopAI.suggestWidgetSuppressSnapshot";
const MANAGED_KEY = "coopAI.suggestWidgetSuppressManagedByCoop";

function readSuppressSuggestions(): boolean | undefined {
  return vscode.workspace.getConfiguration().get<boolean>(SUPPRESS_SUGGEST_WIDGET_SETTING);
}

/**
 * When Coop autocomplete is on, prefer Coop's ghost text over the native suggest widget so
 * after-dot member completions (e.g. `vscode.window.`) are visible even while the language
 * server's IntelliSense dropdown is showing. Restores the user's prior setting when Coop
 * autocomplete turns off, mirroring `syncCopilotInlineWithCoopAutocomplete`.
 */
export async function syncSuggestWidgetCoexistenceWithCoopAutocomplete(
  context: vscode.ExtensionContext,
  coopAutocompleteEnabled: boolean
): Promise<void> {
  const config = vscode.workspace.getConfiguration();

  if (coopAutocompleteEnabled) {
    const managed = context.globalState.get<boolean>(MANAGED_KEY, false);
    if (!managed) {
      const current = readSuppressSuggestions();
      await context.globalState.update(SNAPSHOT_KEY, current ?? false);
      await context.globalState.update(MANAGED_KEY, true);
    }
    const current = readSuppressSuggestions();
    if (current !== true) {
      await config.update(SUPPRESS_SUGGEST_WIDGET_SETTING, true, vscode.ConfigurationTarget.Global);
    }
    return;
  }

  const managed = context.globalState.get<boolean>(MANAGED_KEY, false);
  if (!managed) {
    return;
  }

  const snapshot = context.globalState.get<boolean>(SNAPSHOT_KEY, false);
  await config.update(SUPPRESS_SUGGEST_WIDGET_SETTING, snapshot, vscode.ConfigurationTarget.Global);
  await context.globalState.update(MANAGED_KEY, false);
  await context.globalState.update(SNAPSHOT_KEY, undefined);
}
