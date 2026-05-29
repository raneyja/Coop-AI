export enum ConflictType {
  OWNERSHIP_MISMATCH = "OWNERSHIP_MISMATCH",
  DECISION_CONTRADICTION = "DECISION_CONTRADICTION",
  DOCUMENTATION_STALE = "DOCUMENTATION_STALE",
  STATUS_INCONSISTENT = "STATUS_INCONSISTENT",
  METADATA_CONFLICT = "METADATA_CONFLICT"
}

export type ConflictSeverity = "low" | "medium" | "high" | "critical";

export type ConflictCategory =
  | "ownership"
  | "decision"
  | "implementation"
  | "documentation"
  | "status"
  | "metadata";

export type SourceSystem =
  | "actual_code"
  | "code"
  | "documentation"
  | "github"
  | "github_commit_history"
  | "github_issue"
  | "google_docs"
  | "jira_assignee"
  | "jira_ticket"
  | "pr_comments"
  | "recent_pr"
  | "slack_active_contributors"
  | "slack_recent_thread"
  | "slack_thread"
  | "teams_thread"
  | string;

export type ConflictSourceRecord<TValue = unknown> = {
  source: SourceSystem;
  value: TValue;
  label?: string;
  lastUpdated?: Date;
  confidence?: number;
  score?: number;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type DetectedConflict = {
  id: string;
  type: ConflictType;
  category: ConflictCategory;
  severity: ConflictSeverity;
  message: string;
  sources: ConflictSourceRecord[];
  suggestedResolution: string;
  detectedAt: Date;
  repoId?: string;
  file?: string;
  metadata?: Record<string, unknown>;
};

export type OwnershipConflictInput = {
  repoId?: string;
  file?: string;
  github?: {
    owner?: string;
    lastUpdated?: Date;
    recentCommits?: number;
    ownershipScore?: number;
  };
  jira?: {
    assignee?: string;
    lastUpdated?: Date;
    ticket?: string;
  };
  slack?: {
    mentionedOwner?: string;
    lastUpdated?: Date;
    mentions?: number;
  };
};

export type DocumentationConflictInput = {
  repoId?: string;
  file?: string;
  docs?: {
    status?: string;
    lastReviewed?: Date;
    source?: SourceSystem;
    title?: string;
    url?: string;
  };
  code?: {
    status?: string;
    lastModified?: Date;
    path?: string;
    pattern?: string;
  };
};

export type DecisionConflictInput = {
  repoId?: string;
  file?: string;
  slack?: {
    decision?: string;
    lastUpdated?: Date;
    url?: string;
  };
  teams?: {
    decision?: string;
    lastUpdated?: Date;
    url?: string;
  };
  pr?: {
    decision?: string;
    lastUpdated?: Date;
    url?: string;
  };
  code?: {
    pattern?: string;
    lastModified?: Date;
  };
};

export type StatusConflictInput = {
  repoId?: string;
  file?: string;
  issue?: {
    status?: string;
    source?: SourceSystem;
    id?: string;
    lastUpdated?: Date;
  };
  code?: {
    status?: string;
    completion?: "complete" | "partial" | "unfinished" | "unknown";
    lastModified?: Date;
  };
  pr?: {
    state?: string;
    lastUpdated?: Date;
  };
};

export type MetadataConflictInput = {
  repoId?: string;
  file?: string;
  kind?: string;
  message: string;
  sources: ConflictSourceRecord[];
  suggestedResolution?: string;
  severity?: ConflictSeverity;
  metadata?: Record<string, unknown>;
};

export type ConflictDetectionInput = {
  ownership?: OwnershipConflictInput[];
  documentation?: DocumentationConflictInput[];
  decisions?: DecisionConflictInput[];
  statuses?: StatusConflictInput[];
  metadata?: MetadataConflictInput[];
};

export type ConflictDetectorOptions = {
  now?: () => Date;
  jiraStaleAfterDays?: number;
  includeLowSeverity?: boolean;
  idFactory?: (conflict: Omit<DetectedConflict, "id">) => string;
};

const DEFAULT_JIRA_STALE_DAYS = 30;
const RESOLVED_STATES = new Set(["done", "fixed", "closed", "resolved", "complete", "completed", "merged"]);
const UNFINISHED_STATES = new Set(["todo", "open", "in_progress", "in-progress", "partial", "unfinished", "blocked"]);
const DEPRECATED_WORDS = new Set(["deprecated", "retired", "obsolete"]);

export class ConflictDetector {
  private readonly now: () => Date;
  private readonly jiraStaleAfterDays: number;
  private readonly includeLowSeverity: boolean;
  private readonly idFactory?: ConflictDetectorOptions["idFactory"];

  public constructor(options: ConflictDetectorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.jiraStaleAfterDays = options.jiraStaleAfterDays ?? DEFAULT_JIRA_STALE_DAYS;
    this.includeLowSeverity = options.includeLowSeverity ?? false;
    this.idFactory = options.idFactory;
  }

  public detect(input: ConflictDetectionInput): DetectedConflict[] {
    const conflicts = [
      ...(input.ownership ?? []).flatMap((item) => this.detectOwnershipMismatch(item)),
      ...(input.documentation ?? []).flatMap((item) => this.detectDocumentationStale(item)),
      ...(input.decisions ?? []).flatMap((item) => this.detectDecisionContradiction(item)),
      ...(input.statuses ?? []).flatMap((item) => this.detectStatusInconsistent(item)),
      ...(input.metadata ?? []).flatMap((item) => this.detectMetadataConflict(item))
    ];
    return this.includeLowSeverity ? conflicts : conflicts.filter((conflict) => conflict.severity !== "low");
  }

  public detectOwnershipMismatch(input: OwnershipConflictInput): DetectedConflict[] {
    const githubOwner = clean(input.github?.owner);
    const jiraAssignee = clean(input.jira?.assignee);
    if (!githubOwner || !jiraAssignee || sameValue(githubOwner, jiraAssignee)) {
      return [];
    }

    const jiraAgeDays = input.jira?.lastUpdated ? ageInDays(input.jira.lastUpdated, this.now()) : undefined;
    const jiraLooksOutdated = jiraAgeDays === undefined || jiraAgeDays > this.jiraStaleAfterDays;
    const severity: ConflictSeverity = jiraLooksOutdated ? "high" : "medium";
    const sources: ConflictSourceRecord[] = [
      {
        source: "github_commit_history",
        label: "GitHub commit history",
        value: githubOwner,
        lastUpdated: input.github?.lastUpdated,
        confidence: input.github?.ownershipScore,
        metadata: { recentCommits: input.github?.recentCommits }
      },
      {
        source: "jira_assignee",
        label: "Jira assignee",
        value: jiraAssignee,
        lastUpdated: input.jira?.lastUpdated,
        metadata: { ticket: input.jira?.ticket, ageDays: jiraAgeDays }
      }
    ];
    if (input.slack?.mentionedOwner) {
      sources.push({
        source: "slack_active_contributors",
        label: "Slack mentioned owner",
        value: input.slack.mentionedOwner,
        lastUpdated: input.slack.lastUpdated,
        metadata: { mentions: input.slack.mentions }
      });
    }

    return [
      this.createConflict({
        type: ConflictType.OWNERSHIP_MISMATCH,
        category: "ownership",
        severity,
        repoId: input.repoId,
        file: input.file,
        sources,
        message: `GitHub owner "${githubOwner}" differs from Jira assignee "${jiraAssignee}".`,
        suggestedResolution: jiraLooksOutdated
          ? "Jira may be outdated; confirm with the team and update assignment if GitHub reflects current ownership."
          : "Confirm whether the formal Jira assignment or recent GitHub activity should be treated as current ownership.",
        detectedAt: this.now(),
        metadata: { jiraAgeDays, jiraLooksOutdated }
      })
    ];
  }

  public detectDocumentationStale(input: DocumentationConflictInput): DetectedConflict[] {
    const docsStatus = clean(input.docs?.status);
    const codeModified = input.code?.lastModified;
    const docsReviewed = input.docs?.lastReviewed;
    if (!docsStatus || !DEPRECATED_WORDS.has(normalizeComparable(docsStatus)) || !codeModified || !docsReviewed) {
      return [];
    }
    if (codeModified.getTime() <= docsReviewed.getTime()) {
      return [];
    }

    return [
      this.createConflict({
        type: ConflictType.DOCUMENTATION_STALE,
        category: "documentation",
        severity: "medium",
        repoId: input.repoId,
        file: input.file ?? input.code?.path,
        sources: [
          {
            source: input.docs?.source ?? "documentation",
            label: input.docs?.title ?? "Documentation",
            value: docsStatus,
            lastUpdated: docsReviewed,
            url: input.docs?.url
          },
          {
            source: "actual_code",
            label: "Actual code",
            value: input.code?.status ?? input.code?.pattern ?? "modified",
            lastUpdated: codeModified,
            metadata: { path: input.code?.path }
          }
        ],
        message: "Docs mark this area as deprecated, but code was modified after the last doc review.",
        suggestedResolution: "Treat code as current behavior and update or re-review the documentation.",
        detectedAt: this.now(),
        metadata: {
          docsStatus,
          daysSinceCodeChange: ageInDays(codeModified, this.now()),
          daysSinceDocReview: ageInDays(docsReviewed, this.now())
        }
      })
    ];
  }

  public detectDecisionContradiction(input: DecisionConflictInput): DetectedConflict[] {
    const discussion = firstPresentDecision(input.slack, input.teams);
    const codePattern = clean(input.code?.pattern);
    if (!discussion?.decision || !codePattern) {
      return [];
    }

    const discussedPattern = extractPattern(discussion.decision);
    const actualPattern = extractPattern(codePattern) ?? codePattern;
    if (!discussedPattern || sameValue(discussedPattern, actualPattern)) {
      return [];
    }

    const sources: ConflictSourceRecord[] = [
      {
        source: discussion.source,
        label: discussion.source === "teams_thread" ? "Teams thread" : "Slack thread",
        value: discussion.decision,
        lastUpdated: discussion.lastUpdated,
        url: discussion.url
      },
      {
        source: "actual_code",
        label: "Code implementation",
        value: codePattern,
        lastUpdated: input.code?.lastModified
      }
    ];
    if (input.pr?.decision) {
      sources.splice(1, 0, {
        source: "pr_comments",
        label: "PR comments",
        value: input.pr.decision,
        lastUpdated: input.pr.lastUpdated,
        url: input.pr.url
      });
    }

    return [
      this.createConflict({
        type: ConflictType.DECISION_CONTRADICTION,
        category: "decision",
        severity: "high",
        repoId: input.repoId,
        file: input.file,
        sources,
        message: `Discussion says "${discussedPattern}" but code uses "${actualPattern}".`,
        suggestedResolution: "Review recent PR context and confirm whether the discussion decision was superseded by implementation.",
        detectedAt: this.now(),
        metadata: { discussedPattern, actualPattern }
      })
    ];
  }

  public detectStatusInconsistent(input: StatusConflictInput): DetectedConflict[] {
    const issueStatus = clean(input.issue?.status);
    const codeStatus = clean(input.code?.completion ?? input.code?.status);
    if (!issueStatus || !codeStatus) {
      return [];
    }

    const issueResolved = RESOLVED_STATES.has(normalizeComparable(issueStatus));
    const codeUnfinished = UNFINISHED_STATES.has(normalizeComparable(codeStatus));
    if (!issueResolved || !codeUnfinished) {
      return [];
    }

    return [
      this.createConflict({
        type: ConflictType.STATUS_INCONSISTENT,
        category: "status",
        severity: "high",
        repoId: input.repoId,
        file: input.file,
        sources: [
          {
            source: input.issue?.source ?? "jira_ticket",
            label: input.issue?.id ? `Issue ${input.issue.id}` : "Issue tracker",
            value: issueStatus,
            lastUpdated: input.issue?.lastUpdated
          },
          {
            source: "actual_code",
            label: "Code status",
            value: codeStatus,
            lastUpdated: input.code?.lastModified
          }
        ],
        message: `Issue is marked "${issueStatus}" but code appears "${codeStatus}".`,
        suggestedResolution: "Reopen or update the issue unless the unfinished code is intentional follow-up work.",
        detectedAt: this.now(),
        metadata: { prState: input.pr?.state, prUpdatedAt: input.pr?.lastUpdated?.toISOString() }
      })
    ];
  }

  public detectMetadataConflict(input: MetadataConflictInput): DetectedConflict[] {
    if (input.sources.length < 2) {
      return [];
    }
    return [
      this.createConflict({
        type: ConflictType.METADATA_CONFLICT,
        category: "metadata",
        severity: input.severity ?? "medium",
        repoId: input.repoId,
        file: input.file,
        sources: input.sources,
        message: input.message,
        suggestedResolution: input.suggestedResolution ?? "Verify which metadata source is correct and update the stale reference.",
        detectedAt: this.now(),
        metadata: { kind: input.kind, ...input.metadata }
      })
    ];
  }

  private createConflict(input: Omit<DetectedConflict, "id">): DetectedConflict {
    const id = this.idFactory?.(input) ?? defaultConflictId(input);
    return { ...input, id };
  }
}

export function createSourceRecord<TValue>(
  source: SourceSystem,
  value: TValue,
  options: Omit<ConflictSourceRecord<TValue>, "source" | "value"> = {}
): ConflictSourceRecord<TValue> {
  return {
    source,
    value,
    ...options
  };
}

export function hasSeverityAtLeast(severity: ConflictSeverity, threshold: ConflictSeverity): boolean {
  return severityRank(severity) >= severityRank(threshold);
}

export function severityRank(severity: ConflictSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function ageInDays(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

export function getDaysSince(date: Date, now = new Date()): number {
  return ageInDays(date, now);
}

function defaultConflictId(input: Omit<DetectedConflict, "id">): string {
  const scope = [input.repoId, input.file, input.type, input.message].filter(Boolean).join(":");
  let hash = 0;
  for (const char of scope) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `${input.type.toLowerCase()}-${hash.toString(16)}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function clean(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
  return text || undefined;
}

function extractPattern(text: string): string | undefined {
  const match = text.match(/pattern\s*:?\s*([a-z0-9_.\- /]+)/i);
  return clean(match?.[1]) ?? clean(text.match(/use\s+([a-z0-9_.\- /]+)/i)?.[1]);
}

function firstPresentDecision(
  slack: DecisionConflictInput["slack"],
  teams: DecisionConflictInput["teams"]
): { source: SourceSystem; decision: string; lastUpdated?: Date; url?: string } | undefined {
  if (slack?.decision) {
    return {
      source: "slack_recent_thread",
      decision: slack.decision,
      lastUpdated: slack.lastUpdated,
      url: slack.url
    };
  }
  if (teams?.decision) {
    return {
      source: "teams_thread",
      decision: teams.decision,
      lastUpdated: teams.lastUpdated,
      url: teams.url
    };
  }
  return undefined;
}
