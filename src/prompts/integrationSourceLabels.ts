import type { IntegrationChatProvider } from "../chat/types";
import { buildSourcesChecklistFromKeys } from "./evidenceSynthesis";

const LABEL_BY_PROVIDER: Record<IntegrationChatProvider, string> = {
  slack: "[Sources: Slack search]",
  jira: "[Sources: Jira search]",
  teams: "[Sources: Teams search]",
  confluence: "[Sources: Confluence search]",
  notion: "[Sources: Notion search]",
  "google-docs": "[Sources: Google Docs search]"
};

export function integrationSourceLabel(provider: IntegrationChatProvider): string {
  return LABEL_BY_PROVIDER[provider];
}

export function listIntegrationSourceLabels(provider: IntegrationChatProvider): string[] {
  return [integrationSourceLabel(provider)];
}

export function listIntegrationSourcesChecklist(
  provider: IntegrationChatProvider,
  options?: { error?: string; resultCount?: number }
): string[] {
  if (options?.error || !options?.resultCount) {
    return [];
  }
  const extra = [
    `${integrationSourceLabel(provider)} — ${options.resultCount} result(s) returned for this search.`
  ];
  return buildSourcesChecklistFromKeys(listIntegrationSourceLabels(provider), extra);
}
