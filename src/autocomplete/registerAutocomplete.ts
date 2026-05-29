import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import {
  CoopAutocompleteProvider,
  registerCoopAutocomplete,
  type AutocompleteStatusPublisher
} from "./coopAutocompleteProvider";
import { readAutocompleteSettings } from "./autocompleteConfig";

const AUTOCOMPLETE_HELP = [
  "Coop AI inline autocomplete",
  "",
  "Tab — accept full suggestion",
  "Escape — reject suggestion",
  "Alt+] — next suggestion (when multiple enabled)",
  "Alt+[ — previous suggestion",
  "Cmd+Shift+\\ — manual trigger"
].join("\n");

export function registerAutocompleteCommands(
  context: vscode.ExtensionContext,
  provider: CoopAutocompleteProvider,
  publishStatus: AutocompleteStatusPublisher
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("coopAI.triggerAutocomplete", async () => {
      const settings = readAutocompleteSettings();
      if (!settings.enabled) {
        void vscode.window.showInformationMessage(
          "Enable Coop AI autocomplete in settings (coopAI.autocomplete.enabled)."
        );
        return;
      }
      provider.setManualInvoke(true);
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }),
    vscode.commands.registerCommand("coopAI.autocompleteNext", () => {
      provider.cycleSuggestion(1);
    }),
    vscode.commands.registerCommand("coopAI.autocompletePrev", () => {
      provider.cycleSuggestion(-1);
    }),
    vscode.commands.registerCommand("coopAI.showAutocompleteHelp", () => {
      void vscode.window.showInformationMessage(AUTOCOMPLETE_HELP, { modal: true });
    }),
    vscode.commands.registerCommand("coopAI.toggleAutocomplete", async () => {
      const config = vscode.workspace.getConfiguration("coopAI.autocomplete");
      const enabled = config.get<boolean>("enabled", false);
      await config.update("enabled", !enabled, vscode.ConfigurationTarget.Global);
      publishStatus({
        status: !enabled ? "ready" : "disabled",
        message: !enabled ? "Autocomplete enabled" : "Autocomplete disabled"
      });
      void vscode.window.showInformationMessage(
        !enabled ? "Coop AI autocomplete enabled." : "Coop AI autocomplete disabled."
      );
    })
  );
}

export { registerCoopAutocomplete };
