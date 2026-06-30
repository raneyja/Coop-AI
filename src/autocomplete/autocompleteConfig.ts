import * as vscode from "vscode";
import type {
  AutocompleteModelPreset,
  AutocompleteSettings,
  AutocompleteTriggerMode,
  CopilotPolicy
} from "./types";

const SECTION = "coopAI.autocomplete";

export function readAutocompleteSettings(): AutocompleteSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: config.get<boolean>("enabled", false),
    trigger: config.get<AutocompleteTriggerMode>("trigger", "auto"),
    maxSuggestionLength: config.get<number>("maxSuggestionLength", 200),
    debounceMs: config.get<number>("debounceMs", 300),
    model: config.get<AutocompleteModelPreset>("model", "haiku"),
    customModel: config.get<string>("customModel", ""),
    copilotPolicy: config.get<CopilotPolicy>("copilotPolicy", "warn"),
    showMultipleSuggestions: config.get<boolean>("showMultipleSuggestions", false),
    requestTimeoutMs: config.get<number>("requestTimeoutMs", 400),
    useFim: config.get<boolean>("useFim", true)
  };
}

export function isAutocompleteGloballyEnabled(): boolean {
  return readAutocompleteSettings().enabled;
}

export function onAutocompleteSettingsChanged(
  listener: () => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}
