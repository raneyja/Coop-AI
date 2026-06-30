import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import {
  CoopAutocompleteProvider,
  registerCoopAutocomplete,
  type AutocompleteStatusPublisher
} from "./coopAutocompleteProvider";
import { readAutocompleteSettings } from "./autocompleteConfig";
import {
  copilotCoexistenceWarning,
  detectCopilotExtensions,
  isCopilotInstalled,
  onCopilotExtensionsChanged
} from "./copilotCoexistence";

const AUTOCOMPLETE_HELP = [
  "CoopAI inline autocomplete",
  "",
  "Tab — accept full suggestion",
  "Escape — reject suggestion",
  "Alt+] — next suggestion (when multiple enabled)",
  "Alt+[ — previous suggestion",
  "Cmd+Shift+\\ — manual trigger"
].join("\n");

let copilotWarningShown = false;

function maybeWarnCopilotCoexistence(settings = readAutocompleteSettings()): void {
  if (!settings.enabled || settings.copilotPolicy !== "warn") {
    return;
  }
  if (!isCopilotInstalled()) {
    copilotWarningShown = false;
    return;
  }
  if (copilotWarningShown) {
    return;
  }
  const warning = copilotCoexistenceWarning();
  if (!warning) {
    return;
  }
  copilotWarningShown = true;
  void vscode.window.showWarningMessage(warning, "Open settings").then((choice) => {
    if (choice === "Open settings") {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "coopAI.autocomplete.copilotPolicy"
      );
    }
  });
}

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

  const refreshCopilotStatus = () => {
    const settings = readAutocompleteSettings();
    const { installed } = detectCopilotExtensions();
    if (settings.enabled && installed.length > 0) {
      publishStatus({
        status: settings.copilotPolicy === "disable-when-copilot" ? "disabled" : "ready",
        message: copilotCoexistenceWarning()
      });
      maybeWarnCopilotCoexistence(settings);
    }
  };

  maybeWarnCopilotCoexistence();
  context.subscriptions.push(onCopilotExtensionsChanged(refreshCopilotStatus));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "coopAI.internal.autocompleteAccepted",
      (contextHash: string, languageId?: string) => {
        provider.noteSuggestionAccepted(contextHash, languageId);
        void emitUsage("completion.accepted", { languageId });
      }
    ),
    vscode.commands.registerCommand("coopAI.internal.autocompleteRejected", (reason?: string) => {
      const resolvedReason = reason ?? "dismissed";
      const { rejected, languageId } = provider.rejectActiveSuggestion(resolvedReason);
      if (!rejected) {
        return;
      }
      void emitUsage("completion.rejected", { reason: resolvedReason, languageId });
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
        message: enabled
          ? copilotCoexistenceWarning() ?? "Autocomplete enabled"
          : "Autocomplete disabled"
      });
      if (enabled) {
        maybeWarnCopilotCoexistence({ ...readAutocompleteSettings(), enabled: true });
      }
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
