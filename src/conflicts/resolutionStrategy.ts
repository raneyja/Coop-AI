import {
  ConflictSourceRecord,
  ConflictType,
  DetectedConflict,
  ageInDays,
  normalizeComparable
} from "./conflictDetector";
import { AuthorityScore, SourceAuthorityScorer, humanizeSource } from "./sourceAuthority";

export type AuthoritativeSource = {
  source: string;
  value: unknown;
  score: number;
  reason: string;
};

export type AlternativeSource = {
  source: string;
  value: unknown;
  score: number;
};

export interface ConflictResolution {
  conflictType: ConflictType;
  conflictId?: string;
  authoritative: AuthoritativeSource;
  alternatives: AlternativeSource[];
  recommendation: string;
  actionRequired: boolean;
  severity?: DetectedConflict["severity"];
  resolvedAt: Date;
}

export type ResolutionStrategyOptions = {
  scorer?: SourceAuthorityScorer;
  now?: () => Date;
  autoResolve?: boolean;
};

export class ConflictResolutionStrategy {
  private readonly scorer: SourceAuthorityScorer;
  private readonly now: () => Date;
  private readonly autoResolve: boolean;

  public constructor(options: ResolutionStrategyOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.scorer = options.scorer ?? new SourceAuthorityScorer({ now: this.now });
    this.autoResolve = options.autoResolve ?? false;
  }

  public resolve(conflict: DetectedConflict): ConflictResolution {
    switch (conflict.type) {
      case ConflictType.OWNERSHIP_MISMATCH:
        return this.resolveOwnership(conflict);
      case ConflictType.DECISION_CONTRADICTION:
        return this.resolveDecision(conflict);
      case ConflictType.DOCUMENTATION_STALE:
        return this.resolveDocumentation(conflict);
      case ConflictType.STATUS_INCONSISTENT:
        return this.resolveStatus(conflict);
      case ConflictType.METADATA_CONFLICT:
        return this.resolveMetadata(conflict);
    }
  }

  public resolveMany(conflicts: DetectedConflict[]): ConflictResolution[] {
    return conflicts.map((conflict) => this.resolve(conflict));
  }

  private resolveOwnership(conflict: DetectedConflict): ConflictResolution {
    const ranked = this.scorer.rank(conflict.sources, "ownership");
    const github = findScore(ranked, "github_commit_history");
    const jira = findScore(ranked, "jira_assignee");
    const slack = findScore(ranked, "slack_active_contributors");
    const winner = github && github.adjustedScore > 70 ? github : ranked[0] ?? fallbackScore(conflict.sources[0]);
    const jiraNeedsUpdate = Boolean(jira && !sameResolvedValue(jira.value, winner.value));
    const recommendation = winner.source === "github_commit_history"
      ? `@${winner.value} is primary owner based on recent commits. Jira may need updating.`
      : `${winner.label} is the most authoritative ownership source. Confirm assignment before updating other systems.`;

    return this.buildResolution(conflict, winner, ranked, {
      recommendation,
      actionRequired: jiraNeedsUpdate || !this.autoResolve,
      extraAlternatives: slack ? [] : []
    });
  }

  private resolveDecision(conflict: DetectedConflict): ConflictResolution {
    const ranked = this.scorer.rank(conflict.sources, "decision");
    const code = findScore(ranked, "actual_code") ?? findScore(ranked, "code");
    const pr = findScore(ranked, "pr_comments");
    const discussion = findScore(ranked, "slack_recent_thread") ?? findScore(ranked, "teams_thread") ?? findScore(ranked, "slack_thread");
    const winner = pr && code && pr.adjustedScore >= 70 ? pr : ranked[0] ?? fallbackScore(conflict.sources[0]);
    const recommendation = decisionRecommendation(discussion, pr, code, winner);
    return this.buildResolution(conflict, winner, ranked, {
      recommendation,
      actionRequired: true
    });
  }

  private resolveDocumentation(conflict: DetectedConflict): ConflictResolution {
    const ranked = this.scorer.rank(conflict.sources, "implementation");
    const code = findScore(ranked, "actual_code") ?? findScore(ranked, "code") ?? ranked[0] ?? fallbackScore(conflict.sources[0]);
    const docs = conflict.sources.find((source) => normalizeComparable(source.source).includes("doc"));
    const days = code.lastUpdated ? ageInDays(code.lastUpdated, this.now()) : undefined;
    return this.buildResolution(conflict, code, ranked, {
      recommendation: docs
        ? `Docs mark this as "${docs.value}" but code was updated${days === undefined ? "" : ` ${days} day${days === 1 ? "" : "s"} ago`}. Code is the source of truth.`
        : "Code is the source of truth; update stale documentation.",
      actionRequired: true
    });
  }

  private resolveStatus(conflict: DetectedConflict): ConflictResolution {
    const ranked = this.scorer.rank(conflict.sources, "implementation");
    const code = findScore(ranked, "actual_code") ?? findScore(ranked, "code") ?? ranked[0] ?? fallbackScore(conflict.sources[0]);
    return this.buildResolution(conflict, code, ranked, {
      recommendation: `Treat "${code.value}" from ${code.label} as current implementation status and update the tracker if it is marked complete.`,
      actionRequired: true
    });
  }

  private resolveMetadata(conflict: DetectedConflict): ConflictResolution {
    const ranked = this.scorer.rank(conflict.sources, "decision");
    const winner = ranked[0] ?? fallbackScore(conflict.sources[0]);
    return this.buildResolution(conflict, winner, ranked, {
      recommendation: conflict.suggestedResolution || `Verify ${winner.label} and update conflicting metadata references.`,
      actionRequired: true
    });
  }

  private buildResolution(
    conflict: DetectedConflict,
    winner: AuthorityScore,
    ranked: AuthorityScore[],
    options: {
      recommendation: string;
      actionRequired: boolean;
      extraAlternatives?: AlternativeSource[];
    }
  ): ConflictResolution {
    return {
      conflictType: conflict.type,
      conflictId: conflict.id,
      authoritative: {
        source: winner.label,
        value: winner.value,
        score: winner.adjustedScore,
        reason: winner.reason
      },
      alternatives: [
        ...ranked
          .filter((score) => score !== winner)
          .map((score) => ({
            source: score.label,
            value: score.value,
            score: score.adjustedScore
          })),
        ...(options.extraAlternatives ?? [])
      ],
      recommendation: options.recommendation,
      actionRequired: options.actionRequired,
      severity: conflict.severity,
      resolvedAt: this.now()
    };
  }
}

export function resolveOwnership(sources: Record<string, unknown>): ConflictResolution {
  return resolveLooseSources(ConflictType.OWNERSHIP_MISMATCH, sources, "ownership");
}

export function resolveDecision(sources: Record<string, unknown>): ConflictResolution {
  return resolveLooseSources(ConflictType.DECISION_CONTRADICTION, sources, "decision");
}

export function resolveDocumentation(sources: Record<string, unknown>): ConflictResolution {
  return resolveLooseSources(ConflictType.DOCUMENTATION_STALE, sources, "documentation");
}

export function summarizeResolution(conflict: DetectedConflict, resolution: ConflictResolution): string {
  return `${conflict.type}: ${resolution.authoritative.source} wins with score ${resolution.authoritative.score}. ${resolution.recommendation}`;
}

function resolveLooseSources(
  conflictType: ConflictType,
  sources: Record<string, unknown>,
  category: DetectedConflict["category"]
): ConflictResolution {
  const conflict: DetectedConflict = {
    id: `${conflictType.toLowerCase()}-loose`,
    type: conflictType,
    category,
    severity: "medium",
    message: "Conflict resolved from loose source map.",
    suggestedResolution: "Review authoritative source and alternatives.",
    detectedAt: new Date(),
    sources: Object.entries(sources).map(([source, value]) => looseSourceRecord(source, value))
  };
  return new ConflictResolutionStrategy().resolve(conflict);
}

function looseSourceRecord(source: string, value: unknown): ConflictSourceRecord {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    source,
    label: humanizeSource(source),
    value: "value" in record ? record.value : value,
    score: typeof record.score === "number" ? record.score : undefined,
    lastUpdated: record.lastUpdated instanceof Date ? record.lastUpdated : undefined,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined
  };
}

function findScore(scores: AuthorityScore[], source: string): AuthorityScore | undefined {
  return scores.find((score) => normalizeComparable(score.source) === normalizeComparable(source));
}

function sameResolvedValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function fallbackScore(record: ConflictSourceRecord | undefined): AuthorityScore {
  return {
    source: record?.source ?? "unknown",
    label: record?.label ?? humanizeSource(record?.source ?? "unknown"),
    value: record?.value,
    baseScore: record?.score ?? 0,
    freshnessMultiplier: 1,
    adjustedScore: record?.score ?? 0,
    lastUpdated: record?.lastUpdated,
    reason: "No ranked source was available; using first source as fallback.",
    record: record ?? { source: "unknown", value: undefined }
  };
}

function decisionRecommendation(
  discussion: AuthorityScore | undefined,
  pr: AuthorityScore | undefined,
  code: AuthorityScore | undefined,
  winner: AuthorityScore
): string {
  if (pr && code) {
    const discussionText = discussion ? `${discussion.label} says "${discussion.value}" but ` : "";
    return `${discussionText}PR context says "${pr.value}" and code implements "${code.value}". ${winner.label} is treated as authoritative, so older discussion may be superseded.`;
  }
  if (code) {
    return `Code implements "${code.value}". Confirm whether discussion should be updated to match implementation.`;
  }
  return `${winner.label} is the highest-scoring decision source; confirm alternatives before changing implementation.`;
}
