import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import {
  CoopAutocompleteProvider,
  registerCoopAutocomplete,
  type AutocompleteStatusPublisher
} from "./coopAutocompleteProvider";
import { readAutocompleteSettings } from "./autocompleteConfig";

const AUTOCOMPLETE_HELP = [
  "CoopAI inline autocomplete",
  "",
  "Tab — accept full suggestion",
  "Escape — reject suggestion",
  "Alt+] — next suggestion (when multiple enabled)",
  "Alt+[ — previous suggestion",
  "Cmd+Shift+\\ — manual trigger"
].join("\n");

export function registerAutocompleteCommands(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  provider: CoopAutocompleteProvider,
  publishStatus: AutocompleteStatusPublisher
): void {
  const emitUsage = async (eventType: string, metadata?: Record<string, unknown>) => {
    try {
      await api.recordUsageEvents(eventType, metadata);
    } catch {
      // fail-open — usage telemetry must not block editor UX
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "coopAI.internal.autocompleteAccepted",
      (contextHash: string, languageId?: string) => {
        provider.noteSuggestionAccepted(contextHash);
        void emitUsage("completion.accepted", { languageId });
      }
    ),
    vscode.commands.registerCommand("coopAI.internal.autocompleteRejected", (reason?: string, languageId?: string) => {
      provider.noteSuggestionRejected(reason ?? "dismissed", languageId);
      void emitUsage("completion.rejected", { reason: reason ?? "dismissed", languageId });
    }),
    vscode.commands.registerCommand("coopAI.triggerAutocomplete", async () => {
      const settings = readAutocompleteSettings();
      if (!settings.enabled) {
        void vscode.window.showInformationMessage(
          "Enable CoopAI autocomplete in settings (coopAI.autocomplete.enabled)."
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
    vscode.commands.registerCommand("coopAI.setAutocompleteEnabled", async (enabled: boolean) => {
      const config = vscode.workspace.getConfiguration("coopAI.autocomplete");
      const current = config.get<boolean>("enabled", false);
      if (current === enabled) {
        publishStatus({
          status: enabled ? "ready" : "disabled",
          message: enabled ? "Autocomplete enabled" : "Autocomplete disabled"
        });
        return;
      }
      await config.update("enabled", enabled, vscode.ConfigurationTarget.Global);
      void vscode.commands.executeCommand("setContext", "coopAI.autocomplete.enabled", enabled);
      publishStatus({
        status: enabled ? "ready" : "disabled",
        message: enabled ? "Autocomplete enabled" : "Autocomplete disabled"
      });
      void vscode.window.showInformationMessage(
        enabled ? "CoopAI autocomplete enabled." : "CoopAI autocomplete disabled."
      );
    }),
    vscode.commands.registerCommand("coopAI.toggleAutocomplete", async () => {
      const enabled = readAutocompleteSettings().enabled;
      await vscode.commands.executeCommand("coopAI.setAutocompleteEnabled", !enabled);
    })
  );
}

export { registerCoopAutocomplete };
