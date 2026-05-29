import type { ConflictCategory, ConflictSourceRecord, SourceSystem } from "./conflictDetector";

export type AuthorityQuestion = "ownership" | "decision" | "implementation";

export type AuthorityScore = {
  source: SourceSystem;
  label: string;
  value: unknown;
  baseScore: number;
  freshnessMultiplier: number;
  adjustedScore: number;
  lastUpdated?: Date;
  reason: string;
  record: ConflictSourceRecord;
};

export type SourceAuthorityConfig = {
  trustOrder?: Partial<Record<AuthorityQuestion, SourceSystem[]>>;
  authority?: Partial<Record<AuthorityQuestion, Partial<Record<SourceSystem, number>>>>;
  now?: () => Date;
};

export const SOURCE_AUTHORITY: Record<AuthorityQuestion, Record<SourceSystem, number>> = {
  ownership: {
    github_commit_history: 90,
    slack_active_contributors: 75,
    jira_assignee: 60,
    google_docs: 40,
    documentation: 40,
    github: 80,
    code: 85,
    actual_code: 85
  },
  decision: {
    slack_recent_thread: 95,
    teams_thread: 90,
    pr_comments: 85,
    jira_ticket: 70,
    github_issue: 60,
    google_docs: 40,
    documentation: 40,
    actual_code: 80,
    code: 80
  },
  implementation: {
    actual_code: 100,
    code: 100,
    recent_pr: 90,
    pr_comments: 85,
    slack_thread: 70,
    slack_recent_thread: 70,
    teams_thread: 70,
    documentation: 40,
    google_docs: 40,
    jira_ticket: 55,
    github_issue: 55
  }
};

const DEFAULT_TRUST_ORDER: Record<AuthorityQuestion, SourceSystem[]> = {
  ownership: ["github_commit_history", "slack_active_contributors", "jira_assignee", "google_docs"],
  decision: ["slack_recent_thread", "teams_thread", "pr_comments", "jira_ticket", "github_issue", "google_docs"],
  implementation: ["actual_code", "code", "recent_pr", "pr_comments", "slack_thread", "documentation"]
};

const SOURCE_ALIASES: Record<string, SourceSystem> = {
  github_commits: "github_commit_history",
  github_commit: "github_commit_history",
  github_blame: "github_commit_history",
  slack_active: "slack_active_contributors",
  slack: "slack_recent_thread",
  slack_decision: "slack_recent_thread",
  teams: "teams_thread",
  jira: "jira_ticket",
  jira_issue: "jira_ticket",
  jira_assignee: "jira_assignee",
  docs: "documentation",
  google_doc: "google_docs",
  gdocs: "google_docs",
  code_implementation: "actual_code",
  implementation: "actual_code",
  pr_review: "pr_comments",
  pull_request_comments: "pr_comments"
};

export class SourceAuthorityScorer {
  private readonly authority: Record<AuthorityQuestion, Record<SourceSystem, number>>;
  private readonly trustOrder: Record<AuthorityQuestion, SourceSystem[]>;
  private readonly now: () => Date;

  public constructor(config: SourceAuthorityConfig = {}) {
    this.authority = {
      ownership: { ...SOURCE_AUTHORITY.ownership, ...definedScores(config.authority?.ownership) },
      decision: { ...SOURCE_AUTHORITY.decision, ...definedScores(config.authority?.decision) },
      implementation: { ...SOURCE_AUTHORITY.implementation, ...definedScores(config.authority?.implementation) }
    };
    this.trustOrder = {
      ownership: config.trustOrder?.ownership ?? DEFAULT_TRUST_ORDER.ownership,
      decision: config.trustOrder?.decision ?? DEFAULT_TRUST_ORDER.decision,
      implementation: config.trustOrder?.implementation ?? DEFAULT_TRUST_ORDER.implementation
    };
    this.now = config.now ?? (() => new Date());
  }

  public score(record: ConflictSourceRecord, question: AuthorityQuestion): AuthorityScore {
    const normalizedSource = normalizeSource(record.source);
    const baseScore = clampScore(record.score ?? this.lookupBaseScore(normalizedSource, question));
    const multiplier = record.lastUpdated ? freshnessMultiplier(record.lastUpdated, this.now()) : 0.8;
    const confidenceMultiplier = confidenceMultiplierFor(record.confidence);
    const adjustedScore = roundScore(baseScore * multiplier * confidenceMultiplier);
    return {
      source: normalizedSource,
      label: record.label ?? humanizeSource(normalizedSource),
      value: record.value,
      baseScore,
      freshnessMultiplier: multiplier,
      adjustedScore,
      lastUpdated: record.lastUpdated,
      reason: authorityReason(normalizedSource, question, baseScore, multiplier, confidenceMultiplier),
      record: { ...record, source: normalizedSource }
    };
  }

  public rank(records: ConflictSourceRecord[], question: AuthorityQuestion): AuthorityScore[] {
    return records
      .map((record) => this.score(record, question))
      .sort((left, right) => {
        if (right.adjustedScore !== left.adjustedScore) {
          return right.adjustedScore - left.adjustedScore;
        }
        return this.trustIndex(left.source, question) - this.trustIndex(right.source, question);
      });
  }

  public best(records: ConflictSourceRecord[], question: AuthorityQuestion): AuthorityScore | undefined {
    return this.rank(records, question)[0];
  }

  public questionForCategory(category: ConflictCategory): AuthorityQuestion {
    switch (category) {
      case "ownership":
        return "ownership";
      case "decision":
      case "metadata":
        return "decision";
      case "implementation":
      case "documentation":
      case "status":
        return "implementation";
    }
  }

  private lookupBaseScore(source: SourceSystem, question: AuthorityQuestion): number {
    const direct = this.authority[question][source];
    if (typeof direct === "number") {
      return direct;
    }
    if (source.includes("code")) {
      return this.authority.implementation.actual_code;
    }
    if (source.includes("slack")) {
      return this.authority.decision.slack_recent_thread;
    }
    if (source.includes("jira")) {
      return question === "ownership" ? this.authority.ownership.jira_assignee : this.authority.decision.jira_ticket;
    }
    if (source.includes("doc")) {
      return 40;
    }
    if (source.includes("github")) {
      return question === "ownership" ? 80 : 60;
    }
    return 50;
  }

  private trustIndex(source: SourceSystem, question: AuthorityQuestion): number {
    const index = this.trustOrder[question].indexOf(source);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }
}

export function freshnessMultiplier(lastUpdated: Date, now = new Date()): number {
  const ageInDays = Math.max(0, (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
  if (ageInDays < 7) {
    return 1.0;
  }
  if (ageInDays < 30) {
    return 0.9;
  }
  if (ageInDays < 90) {
    return 0.7;
  }
  if (ageInDays < 180) {
    return 0.5;
  }
  return 0.2;
}

export function normalizeSource(source: SourceSystem): SourceSystem {
  const normalized = String(source).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SOURCE_ALIASES[normalized] ?? normalized;
}

export function authorityQuestionForConflict(category: ConflictCategory): AuthorityQuestion {
  return new SourceAuthorityScorer().questionForCategory(category);
}

export function humanizeSource(source: SourceSystem): string {
  return String(source)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function authorityReason(
  source: SourceSystem,
  question: AuthorityQuestion,
  baseScore: number,
  multiplier: number,
  confidenceMultiplier: number
): string {
  const freshness = multiplier >= 1 ? "fresh" : multiplier >= 0.7 ? "recent" : multiplier >= 0.5 ? "old" : "very stale";
  const confidence = confidenceMultiplier === 1 ? "" : ` with ${Math.round(confidenceMultiplier * 100)}% confidence weight`;
  return `${humanizeSource(source)} has ${baseScore}/100 base authority for ${question} questions and is ${freshness}${confidence}.`;
}

function confidenceMultiplierFor(confidence: number | undefined): number {
  if (confidence === undefined) {
    return 1;
  }
  const normalized = confidence > 1 ? confidence / 100 : confidence;
  return Math.max(0.5, Math.min(1, normalized));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function definedScores(input: Partial<Record<SourceSystem, number>> | undefined): Record<SourceSystem, number> {
  if (!input) {
    return {};
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "number")) as Record<
    SourceSystem,
    number
  >;
}
