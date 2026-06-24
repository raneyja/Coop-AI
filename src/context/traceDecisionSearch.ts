import {
  confluenceSearchFromBundle,
  googleDocsSearchFromBundle,
  jiraSearchFromBundle,
  notionSearchFromBundle,
  slackSearchFromBundle,
  teamsSearchFromBundle
} from "./contextBundleEvidence";
import { collectJiraKeysFromText } from "./jiraContext";
import type { DecisionIntegrationSearch, DecisionTimeline } from "../types/decisionTimeline";

export type { DecisionIntegrationSearch };

export type TraceDecisionSearchSeeds = {
  jiraKeys: string[];
  searchTerms: string[];
  queryText: string;
};

/** Basename and stem terms derived from a repository file path. */
export function filePathSearchTerms(file: string | undefined): string[] {
  const normalized = (file ?? "").trim().replace(/^\/+/, "");
  if (!normalized) {
    return [];
  }
  const base = normalized.split("/").pop() ?? normalized;
  const stem = base.replace(/\.[^.]+$/, "");
  const terms = [stem, base].filter((term) => term.length >= 3);
  const camelSpaced = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  if (camelSpaced.includes(" ") && camelSpaced.length >= 4) {
    terms.push(camelSpaced);
  }
  return [...new Set(terms)].slice(0, 6);
}

/** Collect Jira keys referenced across trace sources (commit, PR, file content, patch). */
export function collectDecisionJiraKeys(
  timeline: DecisionTimeline,
  extraTexts: string[] = []
): string[] {
  const texts = [
    timeline.originalCommit?.message,
    timeline.linkedPR?.description,
    timeline.linkedPR?.title,
    timeline.codeSnippet,
    timeline.introducingDiffSummary?.patchExcerpt,
    timeline.introducingDiffSummary?.summary,
    ...extraTexts,
    ...(timeline.jiraTickets ?? []).map((ticket) => `${ticket.key} ${ticket.summary} ${ticket.description}`)
  ];
  return collectJiraKeysFromText(...texts);
}

export function buildTraceDecisionSearchSeeds(
  timeline: DecisionTimeline,
  file?: string,
  fileContent?: string
): TraceDecisionSearchSeeds {
  const jiraKeys = collectDecisionJiraKeys(timeline, fileContent ? [fileContent] : []);
  const searchTerms = [
    ...filePathSearchTerms(file ?? timeline.file),
    ...jiraKeys
  ];
  for (const ticket of timeline.jiraTickets ?? []) {
    if (ticket.summary.trim()) {
      searchTerms.push(ticket.summary.trim());
    }
  }
  const uniqueTerms = [...new Set(searchTerms.map((term) => term.trim()).filter(Boolean))].slice(0, 12);
  const queryText = [...jiraKeys, ...uniqueTerms].join(" ");
  return { jiraKeys, searchTerms: uniqueTerms, queryText };
}

export function integrationSearchFromBundleEntries(bundle: unknown[]): DecisionIntegrationSearch | undefined {
  const jira = jiraSearchFromBundle(bundle);
  const confluence = confluenceSearchFromBundle(bundle);
  const notion = notionSearchFromBundle(bundle);
  const googleDocs = googleDocsSearchFromBundle(bundle);
  const slack = slackSearchFromBundle(bundle);
  const teams = teamsSearchFromBundle(bundle);
  if (!jira && !confluence && !notion && !googleDocs && !slack && !teams) {
    return undefined;
  }
  return {
    jira,
    confluence,
    notion,
    googleDocs,
    slack,
    teams
  };
}

export function mergeTraceDecisionIntegrationEvidence(
  timeline: DecisionTimeline,
  bundle: unknown[],
  seeds?: TraceDecisionSearchSeeds
): DecisionTimeline {
  const integrationSearch = integrationSearchFromBundleEntries(bundle);
  if (!integrationSearch && !seeds) {
    return timeline;
  }

  const docTexts = [
    ...(integrationSearch?.confluence?.pages ?? []).flatMap((page) => [page.title, page.excerpt]),
    ...(integrationSearch?.notion?.pages ?? []).map((page) => page.title),
    ...(integrationSearch?.googleDocs?.documents ?? []).map((doc) => doc.title),
    ...(integrationSearch?.jira?.issues ?? []).flatMap((issue) => [issue.key, issue.summary])
  ];
  const discoveredKeys = collectJiraKeysFromText(...docTexts);
  const seedJiraKeys = seeds?.jiraKeys.length ? seeds.jiraKeys : collectDecisionJiraKeys(timeline);
  const mergedKeys = [...new Set([...seedJiraKeys, ...discoveredKeys])];

  const merged: DecisionTimeline = {
    ...timeline,
    integrationSearch: {
      ...integrationSearch,
      seedJiraKeys: mergedKeys.length ? mergedKeys : undefined,
      seedSearchTerms: seeds?.searchTerms.length ? seeds.searchTerms : undefined
    }
  };

  if (mergedKeys.length > 0 && (merged.jiraTickets?.length ?? 0) === 0 && integrationSearch?.jira?.issues.length) {
    merged.warnings = [
      ...merged.warnings,
      `Jira keys ${mergedKeys.slice(0, 3).join(", ")} were found in code or docs; linked ticket details may be partial.`
    ];
  }

  return merged;
}

export function timelineHasIntegrationDocEvidence(timeline: DecisionTimeline): boolean {
  const search = timeline.integrationSearch;
  if (!search) {
    return false;
  }
  return (
    (search.jira?.issues.length ?? 0) > 0 ||
    (search.confluence?.pages.length ?? 0) > 0 ||
    (search.notion?.pages.length ?? 0) > 0 ||
    (search.googleDocs?.documents.length ?? 0) > 0 ||
    (search.slack?.messages.length ?? 0) > 0 ||
    (search.teams?.messages.length ?? 0) > 0
  );
}

export function adrTitlesFromIntegrationSearch(search: DecisionIntegrationSearch | undefined): string[] {
  if (!search) {
    return [];
  }
  const titles = [
    ...(search.confluence?.pages ?? []).map((page) => page.title),
    ...(search.notion?.pages ?? []).map((page) => page.title),
    ...(search.googleDocs?.documents ?? []).map((doc) => doc.title)
  ];
  return titles
    .map((title) => title.trim())
    .filter((title) => /\b(adr|decision|architecture|design doc|rfc)\b/i.test(title))
    .slice(0, 5);
}

/** Extra Jira keys found in integration doc titles/excerpts for follow-up search. */
export function jiraKeysFromIntegrationSearch(search: DecisionIntegrationSearch | undefined): string[] {
  if (!search) {
    return [];
  }
  const chunks = [
    ...(search.confluence?.pages ?? []).flatMap((page) => [page.title, page.excerpt]),
    ...(search.notion?.pages ?? []).map((page) => page.title),
    ...(search.googleDocs?.documents ?? []).map((doc) => doc.title),
    ...(search.jira?.issues ?? []).flatMap((issue) => [issue.key, issue.summary])
  ];
  return collectJiraKeysFromText(...chunks);
}
