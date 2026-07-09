import * as vscode from "vscode";
import { buildRepoId } from "../chat/buildRepoId";
import { readConfiguration } from "../chat/SecureApiClient";
import type { IndexRepoStatus } from "../indexing/indexBackend";
import type {
  AutocompleteModelPreset,
  AutocompleteSettings,
  AutocompleteTriggerMode
} from "./types";

const SECTION = "coopAI.autocomplete";

/** globalState — user explicitly turned autocomplete off; suppress index-discovery prompt. */
export const AUTOCOMPLETE_USER_DISABLED_KEY = "coopAI.autocomplete.userDisabled";
/** globalState — one-time index-ready discovery toast already shown or dismissed. */
export const AUTOCOMPLETE_INDEX_DISCOVERY_SHOWN_KEY = "coopAI.autocomplete.indexReadyToastShown";

export function readAutocompleteSettings(): AutocompleteSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: config.get<boolean>("enabled", false),
    trigger: config.get<AutocompleteTriggerMode>("trigger", "auto"),
    maxSuggestionLength: config.get<number>("maxSuggestionLength", 200),
    debounceMs: config.get<number>("debounceMs", 300),
    model: config.get<AutocompleteModelPreset>("model", "chat"),
    customModel: config.get<string>("customModel", ""),
    showMultipleSuggestions: config.get<boolean>("showMultipleSuggestions", false),
    requestTimeoutMs: config.get<number>("requestTimeoutMs", 1500),
    useFim: config.get<boolean>("useFim", true),
    useGraphContext: config.get<boolean>("useGraphContext", false)
  };
}

export function isAutocompleteGloballyEnabled(): boolean {
  return readAutocompleteSettings().enabled;
}

export function isRepoIndexHealthy(
  status?: Pick<IndexRepoStatus, "enabled" | "status" | "scipAvailable" | "zoektAvailable">
): boolean {
  return Boolean(
    status?.enabled &&
      status.status === "ready" &&
      (status.scipAvailable || status.zoektAvailable)
  );
}

export function resolveAutocompleteActiveRepoId(): string | undefined {
  const repoId = buildRepoId(readConfiguration());
  if (repoId.includes("unknown/unknown")) {
    return undefined;
  }
  return repoId;
}

export function isAutocompleteUserDisabled(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(AUTOCOMPLETE_USER_DISABLED_KEY, false);
}

export async function markAutocompleteUserDisabled(
  context: vscode.ExtensionContext,
  disabled: boolean
): Promise<void> {
  await context.globalState.update(AUTOCOMPLETE_USER_DISABLED_KEY, disabled);
}

export function hasAutocompleteDiscoveryBeenShown(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(AUTOCOMPLETE_INDEX_DISCOVERY_SHOWN_KEY, false);
}

export async function markAutocompleteDiscoveryShown(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(AUTOCOMPLETE_INDEX_DISCOVERY_SHOWN_KEY, true);
}

/** Eligible for the one-time index-ready auto-enable toast (not explicitly disabled). */
export function shouldAutoEnableAutocompleteOnIndexReady(context: vscode.ExtensionContext): boolean {
  return !isAutocompleteUserDisabled(context) && !hasAutocompleteDiscoveryBeenShown(context);
}

/** Eligible for the one-time index-ready discovery toast (default off; no prior opt-out). */
export function shouldOfferAutocompleteDiscovery(
  settings: Pick<AutocompleteSettings, "enabled">,
  context: vscode.ExtensionContext
): boolean {
  return (
    !settings.enabled &&
    !isAutocompleteUserDisabled(context) &&
    !hasAutocompleteDiscoveryBeenShown(context)
  );
}

export function findActiveRepoBecameHealthy(
  statuses: IndexRepoStatus[],
  previousStatuses: ReadonlyMap<string, string>,
  activeRepoId?: string
): IndexRepoStatus | undefined {
  for (const status of statuses) {
    if (activeRepoId && status.repoId !== activeRepoId) {
      continue;
    }
    const previous = previousStatuses.get(status.repoId);
    const becameReady = isRepoIndexHealthy(status) && previous !== "ready";
    if (becameReady) {
      return status;
    }
  }
  return undefined;
}

export function resolveAutocompleteEnabledUpdateTarget(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(SECTION)
): vscode.ConfigurationTarget {
  const inspected = config.inspect<boolean>("enabled");
  if (inspected?.workspaceFolderValue !== undefined || inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

/** Explicit setting forces graph on; otherwise auto-enable when the repo index is healthy. */
export function resolveEffectiveUseGraphContext(
  settings: Pick<AutocompleteSettings, "useGraphContext">,
  status?: Pick<IndexRepoStatus, "enabled" | "status" | "scipAvailable" | "zoektAvailable">
): boolean {
  if (settings.useGraphContext) {
    return true;
  }
  return isRepoIndexHealthy(status);
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
