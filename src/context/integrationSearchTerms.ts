import { buildRepoSearchTerms } from "./docSearchQuery";
import { collectJiraKeysFromText } from "./jiraContext";
import { filePathSearchTerms } from "./traceDecisionSearch";

/** Cap terms per integration to avoid oversized API queries. */
export const MAX_INTEGRATION_SEARCH_TERMS = 16;

/**
 * Shared discovery terms for connected integrations (Slack, Teams, Jira, Confluence, Notion, Google Docs).
 * Derived only from Settings owner/repo, active file, editor context, cross-tool doc text, and trace seeds.
 * No hardcoded channel names, spaces, project keys, or demo slugs.
 */
export function buildIntegrationSearchTermList(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  extraTerms?: string[];
  jiraIssueKeys?: string[];
  preferHost?: import("../api/codeHosts/types").CodeHostProvider;
}): string[] {
  const terms = new Set<string>();
  // Caller extras (e.g. Gaps focus phrases) first so they survive the term cap.
  for (const term of options.extraTerms ?? []) {
    const trimmed = term.trim();
    if (trimmed) {
      terms.add(trimmed);
    }
  }
  for (const key of [
    ...collectJiraKeysFromText(
      options.queryText,
      ...(options.contextText ?? []),
      ...(options.crossToolText ?? [])
    ),
    ...(options.jiraIssueKeys ?? [])
  ]) {
    terms.add(key);
  }
  for (const term of filePathSearchTerms(options.activeFile)) {
    terms.add(term);
  }
  for (const term of buildRepoSearchTerms(options.owner, options.repo, {
    preferHost: options.preferHost
  })) {
    terms.add(term);
  }
  return [...terms].slice(0, MAX_INTEGRATION_SEARCH_TERMS);
}

/** @deprecated Use buildIntegrationSearchTermList */
export function buildIntegrationSearchExtraTerms(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  extraTerms?: string[];
}): string[] {
  return buildIntegrationSearchTermList(options);
}

/**
 * Per-term queries for discussion tools (Slack, Teams). Jira keys first, then file, then repo slugs.
 * Each term is searched individually — no channel/channel-name guessing.
 */
export function buildDiscussionSearchQueries(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  extraTerms?: string[];
  jiraIssueKeys?: string[];
  preferHost?: import("../api/codeHosts/types").CodeHostProvider;
  /** When set (e.g. Slack `is:thread`), appended as a separate query variant per term. */
  threadModifier?: string;
  /**
   * Job dispatch: extraTerms are the search. Do not dump queryText / file / repo
   * slugs as if they were the user's terms.
   */
  jobScoped?: boolean;
}): string[] {
  if (options.jobScoped) {
    const ordered: string[] = [];
    const push = (query: string): void => {
      const trimmed = query.trim();
      if (trimmed && !ordered.includes(trimmed)) {
        ordered.push(trimmed);
      }
    };
    for (const term of options.extraTerms ?? []) {
      push(term);
      if (options.threadModifier) {
        push(`${term} ${options.threadModifier}`);
      }
    }
    return ordered.slice(0, MAX_INTEGRATION_SEARCH_TERMS * 2);
  }

  const terms = buildIntegrationSearchTermList(options);
  const jiraKeys = new Set(
    [
      ...collectJiraKeysFromText(
        options.queryText,
        ...(options.contextText ?? []),
        ...(options.crossToolText ?? [])
      ),
      ...(options.jiraIssueKeys ?? [])
    ].map((key) => key.trim())
  );

  const ordered: string[] = [];
  const push = (query: string): void => {
    const trimmed = query.trim();
    if (trimmed) {
      ordered.push(trimmed);
    }
  };

  for (const key of [...jiraKeys].slice(0, 6)) {
    push(key);
    if (options.threadModifier) {
      push(`${key} ${options.threadModifier}`);
    }
  }

  for (const term of filePathSearchTerms(options.activeFile)) {
    push(term);
    if (options.threadModifier) {
      push(`${term} ${options.threadModifier}`);
    }
  }

  for (const term of buildRepoSearchTerms(options.owner, options.repo, {
    preferHost: options.preferHost
  })) {
    push(term);
    if (options.threadModifier) {
      push(`${term} ${options.threadModifier}`);
    }
  }

  for (const term of terms) {
    if (!ordered.includes(term)) {
      push(term);
    }
  }

  return [...new Set(ordered)].slice(0, MAX_INTEGRATION_SEARCH_TERMS * 2);
}

export function collectCrossToolSearchText(
  confluence?: { pages?: Array<{ title?: string; excerpt?: string }> },
  notion?: { pages?: Array<{ title?: string }> }
): string[] {
  return [
    ...(confluence?.pages ?? []).flatMap((page) => [page.title, page.excerpt]),
    ...(notion?.pages ?? []).map((page) => page.title)
  ].filter((chunk): chunk is string => Boolean(chunk?.trim()));
}
