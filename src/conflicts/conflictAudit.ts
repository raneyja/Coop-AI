import type { ConflictSeverity, ConflictSourceRecord, ConflictType, DetectedConflict } from "./conflictDetector";
import type { ConflictResolution } from "./resolutionStrategy";

export type ConflictUserAction = "accepted" | "dismissed" | "escalated";

export interface ConflictAudit {
  conflictId: string;
  type: ConflictType;
  detected: Date;
  sources: Array<{ source: string; value: unknown; score: number }>;
  resolution: ConflictResolution;
  userAction?: ConflictUserAction;
  actionDate?: Date;
}

export type ConflictAuditRecord = ConflictAudit & {
  repoId?: string;
  file?: string;
  severity?: ConflictSeverity;
  message?: string;
};

export type ConflictAuditStoreOptions = {
  maxRecords?: number;
  now?: () => Date;
};

export class ConflictAuditStore {
  private readonly records: ConflictAuditRecord[] = [];
  private readonly maxRecords: number;
  private readonly now: () => Date;

  public constructor(options: ConflictAuditStoreOptions = {}) {
    this.maxRecords = options.maxRecords ?? 1000;
    this.now = options.now ?? (() => new Date());
  }

  public record(conflict: DetectedConflict, resolution: ConflictResolution): ConflictAuditRecord {
    const record: ConflictAuditRecord = {
      conflictId: conflict.id,
      type: conflict.type,
      detected: conflict.detectedAt,
      repoId: conflict.repoId,
      file: conflict.file,
      severity: conflict.severity,
      message: conflict.message,
      sources: conflict.sources.map((source) => auditSource(source)),
      resolution
    };
    this.records.push(record);
    this.trim();
    return cloneAuditRecord(record);
  }

  public recordMany(conflicts: DetectedConflict[], resolutions: ConflictResolution[]): ConflictAuditRecord[] {
    const byId = new Map(resolutions.map((resolution) => [resolution.conflictId, resolution]));
    return conflicts.flatMap((conflict) => {
      const resolution = byId.get(conflict.id);
      return resolution ? [this.record(conflict, resolution)] : [];
    });
  }

  public recordUserAction(conflictId: string, userAction: ConflictUserAction): ConflictAuditRecord | undefined {
    const record = [...this.records].reverse().find((item) => item.conflictId === conflictId);
    if (!record) {
      return undefined;
    }
    record.userAction = userAction;
    record.actionDate = this.now();
    return cloneAuditRecord(record);
  }

  public list(filter: {
    repoId?: string;
    type?: ConflictType;
    severity?: ConflictSeverity;
    userAction?: ConflictUserAction;
    limit?: number;
  } = {}): ConflictAuditRecord[] {
    const limit = filter.limit ?? 100;
    return this.records
      .filter((record) => !filter.repoId || record.repoId === filter.repoId)
      .filter((record) => !filter.type || record.type === filter.type)
      .filter((record) => !filter.severity || record.severity === filter.severity)
      .filter((record) => !filter.userAction || record.userAction === filter.userAction)
      .slice(-limit)
      .map(cloneAuditRecord);
  }

  public get(conflictId: string): ConflictAuditRecord | undefined {
    const record = [...this.records].reverse().find((item) => item.conflictId === conflictId);
    return record ? cloneAuditRecord(record) : undefined;
  }

  public clear(): void {
    this.records.length = 0;
  }

  public size(): number {
    return this.records.length;
  }

  private trim(): void {
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }
}

export function serializeAuditRecord(record: ConflictAuditRecord): Record<string, unknown> {
  return {
    ...record,
    detected: record.detected.toISOString(),
    actionDate: record.actionDate?.toISOString(),
    resolution: {
      ...record.resolution,
      resolvedAt: record.resolution.resolvedAt.toISOString()
    }
  };
}

function auditSource(source: ConflictSourceRecord): { source: string; value: unknown; score: number } {
  return {
    source: source.label ?? String(source.source),
    value: source.value,
    score: source.score ?? source.confidence ?? 0
  };
}

function cloneAuditRecord(record: ConflictAuditRecord): ConflictAuditRecord {
  return {
    ...record,
    detected: new Date(record.detected),
    actionDate: record.actionDate ? new Date(record.actionDate) : undefined,
    sources: record.sources.map((source) => ({ ...source })),
    resolution: {
      ...record.resolution,
      authoritative: { ...record.resolution.authoritative },
      alternatives: record.resolution.alternatives.map((alternative) => ({ ...alternative })),
      resolvedAt: new Date(record.resolution.resolvedAt)
    }
  };
}
