/**
 * Autocomplete on/off is a local VS Code setting. Reloading every Coop preference
 * (session, integrations, install statuses) makes the settings checkbox lag.
 */

const COOP_CONFIG_SECTIONS_NEEDING_SESSION_REFRESH = [
  "coopAI.defaultModel",
  "coopAI.llmProvider",
  "coopAI.temperature",
  "coopAI.maxTokens",
  "coopAI.useCachedResponses",
  "coopAI.includeSelection",
  "coopAI.includeActiveFile",
  "coopAI.apiBaseUrl",
  "coopAI.defaultOwner",
  "coopAI.defaultRepo",
  "coopAI.defaultBranch",
  "coopAI.defaultCodeHost",
  "coopAI.gitlab",
  "coopAI.jira",
  "coopAI.confluence",
  "coopAI.searchScope",
  "coopAI.timezone",
  "coopAI.devMode",
  "coopAI.license",
  "coopAI.lightning",
  "coopAI.degradation",
  "coopAI.intent",
  "coopAI.conflicts"
] as const;

export function isAutocompleteOnlySettingsUpdate(payload: object): boolean {
  const record = payload as Record<string, unknown>;
  if (typeof record.autocompleteEnabled !== "boolean") {
    return false;
  }
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  return keys.length === 1 && keys[0] === "autocompleteEnabled";
}

export function shouldRefreshSessionsOnCoopConfigChange(
  affectsConfiguration: (section: string) => boolean
): boolean {
  if (!affectsConfiguration("coopAI")) {
    return false;
  }
  if (!affectsConfiguration("coopAI.autocomplete.enabled")) {
    return true;
  }
  return COOP_CONFIG_SECTIONS_NEEDING_SESSION_REFRESH.some((section) =>
    affectsConfiguration(section)
  );
}
