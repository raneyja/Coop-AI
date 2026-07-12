import * as vscode from "vscode";
import type { SecureApiClient } from "../chat/SecureApiClient";
import {
  CoopAutocompleteProvider,
  registerCoopAutocomplete,
  registerAutocompleteIndexNotifier
} from "./coopAutocompleteProvider";
import {
  readAutocompleteSettings,
  onAutocompleteSettingsChanged,
  markAutocompleteUserDisabled,
} from "./autocompleteConfig";
import type { AutocompleteTelemetryEvent } from "./types";
import {
  isCopilotInstalled,
  onCopilotExtensionsChanged,
  syncCopilotInlineWithCoopAutocomplete
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

export function createAutocompleteUsageTelemetryHandler(
  emitUsage: (eventType: string, metadata?: Record<string, unknown>) => void
): (event: AutocompleteTelemetryEvent) => void {
  return (event) => {
    if (event.kind === "show") {
      emitUsage("completion.suggested", { languageId: event.languageId });
      return;
    }
    if (event.kind === "performance" && event.performance) {
      emitUsage("completion.performance", { ...event.performance });
    }
  };
}

export function registerAutocompleteCommands(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  provider: CoopAutocompleteProvider
): void {
  const emitUsage = async (eventType: string, metadata?: Record<string, unknown>) => {
    try {
      await api.recordUsageEvents(eventType, metadata);
    } catch {
      // fail-open — usage telemetry must not block editor UX
    }
  };

  const syncCopilotInline = async (enabled: boolean) => {
    await syncCopilotInlineWithCoopAutocomplete(context, enabled);
  };

  const refreshAfterCopilotChange = () => {
    const settings = readAutocompleteSettings();
    if (settings.enabled && isCopilotInstalled()) {
      void syncCopilotInline(true);
    }
  };

  void syncCopilotInline(readAutocompleteSettings().enabled);

  context.subscriptions.push(
    onCopilotExtensionsChanged(refreshAfterCopilotChange),
    onAutocompleteSettingsChanged(() => {
      void syncCopilotInline(readAutocompleteSettings().enabled);
    })
  );

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
    vscode.commands.registerCommand(
      "coopAI.setAutocompleteEnabled",
      async (enabled: boolean, _target?: vscode.ConfigurationTarget) => {
      const config = vscode.workspace.getConfiguration("coopAI.autocomplete");
      const current = config.get<boolean>("enabled", false);
      if (current === enabled) {
        return;
      }
      const updateTarget = vscode.ConfigurationTarget.Global;
      await markAutocompleteUserDisabled(context, !enabled);
      await config.update("enabled", enabled, updateTarget);
      void vscode.commands.executeCommand("setContext", "coopAI.autocomplete.enabled", enabled);
      await syncCopilotInline(enabled);
    })
  );
}

export { registerCoopAutocomplete, registerAutocompleteIndexNotifier };
