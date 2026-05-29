import {
  ConflictDetector,
  ConflictSourceRecord,
  ConflictType,
  DetectedConflict,
  MetadataConflictInput
} from "./conflictDetector";
import { ConflictResolution, ConflictResolutionStrategy } from "./resolutionStrategy";
import type { IssueMetadata, PullRequestMetadata } from "../webhooks/types";

export type JiraTicketLike = {
  key: string;
  title?: string;
  epicName?: string;
  status?: string;
  updatedAt?: Date;
  url?: string;
};

export type GitHubPRLike = Pick<PullRequestMetadata, "id" | "number" | "title" | "linkedIssues" | "updatedAt"> & {
  description?: string;
  url?: string;
};

export type MetadataReconciliationResult = {
  conflicts: DetectedConflict[];
  resolutions: ConflictResolution[];
};

const TICKET_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export function extractTicketsFromDescription(description: string | undefined): string[] {
  if (!description) {
    return [];
  }
  return [...new Set(description.match(TICKET_PATTERN) ?? [])];
}

export function reconcileLinks(pr: GitHubPRLike, jiraTickets: JiraTicketLike[]): ConflictResolution | undefined {
  const conflicts = detectLinkConflicts(pr, jiraTickets);
  const conflict = conflicts[0];
  return conflict ? new ConflictResolutionStrategy().resolve(conflict) : undefined;
}

export function reconcileMetadata(pr: GitHubPRLike, jiraTickets: JiraTicketLike[]): MetadataReconciliationResult {
  const conflicts = [
    ...detectLinkConflicts(pr, jiraTickets),
    ...detectTitleConflicts(pr, jiraTickets),
    ...detectDuplicateTicketLinks(pr)
  ];
  const resolver = new ConflictResolutionStrategy();
  return {
    conflicts,
    resolutions: resolver.resolveMany(conflicts)
  };
}

export function detectLinkConflicts(pr: GitHubPRLike, jiraTickets: JiraTicketLike[]): DetectedConflict[] {
  const prMentions = extractTicketsFromDescription(pr.description);
  const linkedTickets = pr.linkedIssues.map(normalizeTicketKey).filter(Boolean);
  if (prMentions.length === 0 || linkedTickets.length === 0) {
    return [];
  }

  const primaryMention = prMentions[0];
  const primaryLinked = linkedTickets[0];
  if (primaryMention === primaryLinked) {
    return [];
  }

  const ticket = jiraTickets.find((item) => normalizeTicketKey(item.key) === primaryLinked);
  return metadataDetector().detectMetadataConflict({
    repoId: undefined,
    kind: "ticket-link",
    message: `PR description mentions ticket ${primaryMention} but GitHub link points to ${primaryLinked}.`,
    suggestedResolution: "Verify which ticket is correct; update the GitHub link or PR description.",
    severity: "high",
    sources: [
      {
        source: "github",
        label: `PR #${pr.number} description`,
        value: primaryMention,
        lastUpdated: pr.updatedAt,
        metadata: { prId: pr.id, prNumber: pr.number }
      },
      {
        source: "github_issue",
        label: `PR #${pr.number} linked issue`,
        value: primaryLinked,
        lastUpdated: pr.updatedAt,
        metadata: { linkedIssues: linkedTickets }
      },
      {
        source: "jira_ticket",
        label: ticket?.key ? `Jira ${ticket.key}` : "Jira ticket",
        value: ticket?.title ?? primaryLinked,
        lastUpdated: ticket?.updatedAt,
        url: ticket?.url
      }
    ]
  });
}

export function detectTitleConflicts(pr: GitHubPRLike, jiraTickets: JiraTicketLike[]): DetectedConflict[] {
  const linked = pr.linkedIssues
    .map(normalizeTicketKey)
    .map((key) => jiraTickets.find((ticket) => normalizeTicketKey(ticket.key) === key))
    .filter((ticket): ticket is JiraTicketLike => Boolean(ticket));

  return linked.flatMap((ticket) => {
    const expected = ticket.epicName ?? ticket.title;
    if (!expected || titlesCompatible(pr.title, expected)) {
      return [];
    }
    return metadataDetector().detectMetadataConflict({
      kind: "title-mismatch",
      message: `PR title "${pr.title}" does not match Jira epic or ticket title "${expected}".`,
      suggestedResolution: "Confirm whether the PR is linked to the right Jira ticket or update the title metadata.",
      severity: "medium",
      sources: [
        {
          source: "github",
          label: `PR #${pr.number} title`,
          value: pr.title,
          lastUpdated: pr.updatedAt,
          url: pr.url
        },
        {
          source: "jira_ticket",
          label: `Jira ${ticket.key}`,
          value: expected,
          lastUpdated: ticket.updatedAt,
          url: ticket.url
        }
      ]
    });
  });
}

export function detectDuplicateTicketLinks(pr: GitHubPRLike): DetectedConflict[] {
  const linked = pr.linkedIssues.map(normalizeTicketKey).filter(Boolean);
  const mentioned = extractTicketsFromDescription(pr.description);
  const all = [...linked, ...mentioned];
  const unique = [...new Set(all)];
  if (unique.length <= 1) {
    return [];
  }

  return metadataDetector().detectMetadataConflict({
    kind: "multiple-ticket-links",
    message: `PR #${pr.number} references multiple tickets: ${unique.join(", ")}.`,
    suggestedResolution: "Pick the canonical ticket and remove stale references from the PR description or linked issues.",
    severity: "medium",
    sources: [
      {
        source: "github",
        label: "PR linked issues",
        value: linked,
        lastUpdated: pr.updatedAt
      },
      {
        source: "github",
        label: "PR description mentions",
        value: mentioned,
        lastUpdated: pr.updatedAt
      }
    ]
  });
}

export function metadataConflictFromIssue(pr: PullRequestMetadata, issue: IssueMetadata): DetectedConflict[] {
  if (!pr.linkedIssues.includes(String(issue.number)) && !pr.linkedIssues.includes(issue.id)) {
    return [];
  }
  if (titlesCompatible(pr.title, issue.title)) {
    return [];
  }
  return metadataDetector().detectMetadataConflict({
    kind: "pr-issue-title",
    message: `PR "${pr.title}" is linked to issue "${issue.title}" but titles appear unrelated.`,
    suggestedResolution: "Confirm linked issue metadata before surfacing the PR as evidence for this work.",
    severity: "low",
    sources: [
      { source: "github", label: `PR #${pr.number}`, value: pr.title, lastUpdated: pr.updatedAt },
      { source: "github_issue", label: `Issue #${issue.number}`, value: issue.title, lastUpdated: issue.updatedAt }
    ]
  });
}

export function metadataInputFromSources(
  message: string,
  sources: ConflictSourceRecord[],
  overrides: Partial<MetadataConflictInput> = {}
): MetadataConflictInput {
  return {
    message,
    kind: "custom",
    sources,
    suggestedResolution: "Verify which source is correct and update stale metadata.",
    ...overrides
  };
}

export function normalizeTicketKey(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function metadataDetector(): ConflictDetector {
  return new ConflictDetector({ includeLowSeverity: true });
}

function titlesCompatible(left: string, right: string): boolean {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length) >= 0.5;
}

function significantTokens(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export { ConflictType };
