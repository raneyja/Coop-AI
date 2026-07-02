import * as vscode from "vscode";
import type {
  AutocompleteModelPreset,
  AutocompleteSettings,
  AutocompleteTriggerMode
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
    showMultipleSuggestions: config.get<boolean>("showMultipleSuggestions", false),
    requestTimeoutMs: config.get<number>("requestTimeoutMs", 400),
    useFim: config.get<boolean>("useFim", true),
    useGraphContext: config.get<boolean>("useGraphContext", false)
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
