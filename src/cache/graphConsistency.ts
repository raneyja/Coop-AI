import { GraphCache, RepositoryGraph } from "./graphCache";
import type { NormalizedWebhookEvent } from "../webhooks/types";

export type GraphAuditRecord = {
  id: string;
  repoId?: string;
  provider: NormalizedWebhookEvent["provider"];
  eventType: NormalizedWebhookEvent["eventType"];
  deliveryId: string;
  receivedAt: Date;
  appliedAt: Date;
  versionBefore?: number;
  versionAfter?: number;
  reason: string;
};

export type GraphSnapshot = {
  repoId: string;
  version: number;
  capturedAt: Date;
  graph: RepositoryGraph;
};

export type ConsistencyOptions = {
  maxSnapshotsPerRepo?: number;
  maxAuditRecords?: number;
  staleAfterMs?: number;
};

type QueuedEvent = {
  event: NormalizedWebhookEvent;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const DEFAULT_MAX_SNAPSHOTS = 10;
const DEFAULT_MAX_AUDIT = 1000;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export class GraphConsistencyManager {
  private readonly queues = new Map<string, QueuedEvent[]>();
  private readonly processing = new Set<string>();
  private readonly snapshots = new Map<string, GraphSnapshot[]>();
  private readonly auditTrail: GraphAuditRecord[] = [];
  private readonly maxSnapshotsPerRepo: number;
  private readonly maxAuditRecords: number;
  private readonly staleAfterMs: number;

  public constructor(
    private readonly cache: GraphCache,
    options: ConsistencyOptions = {}
  ) {
    this.maxSnapshotsPerRepo = options.maxSnapshotsPerRepo ?? DEFAULT_MAX_SNAPSHOTS;
    this.maxAuditRecords = options.maxAuditRecords ?? DEFAULT_MAX_AUDIT;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  public async enqueue(event: NormalizedWebhookEvent): Promise<void> {
    const repoId = event.provider === "slack" ? this.repoIdFromSlack(event) : event.repository.repoId;
    if (!repoId) {
      this.recordAudit(event, undefined, undefined, undefined, "ignored: no repository target");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(repoId) ?? [];
      queue.push({ event, resolve, reject });
      this.queues.set(repoId, queue);
      void this.drain(repoId);
    });
  }

  public getAuditTrail(repoId?: string, limit = 100): GraphAuditRecord[] {
    return this.auditTrail
      .filter((record) => !repoId || record.repoId === repoId)
      .slice(-limit)
      .map((record) => ({ ...record, receivedAt: new Date(record.receivedAt), appliedAt: new Date(record.appliedAt) }));
  }

  public getSnapshots(repoId: string): GraphSnapshot[] {
    return (this.snapshots.get(repoId) ?? []).map((snapshot) => ({
      ...snapshot,
      capturedAt: new Date(snapshot.capturedAt),
      graph: snapshot.graph
    }));
  }

  public isStale(repoId: string): boolean {
    const graph = this.cache.getGraph(repoId);
    if (!graph) {
      return true;
    }
    return Date.now() - graph.lastUpdated.getTime() > this.staleAfterMs;
  }

  public rollback(repoId: string, version?: number): RepositoryGraph | undefined {
    const snapshots = this.snapshots.get(repoId) ?? [];
    const target = version === undefined
      ? snapshots[snapshots.length - 1]
      : snapshots.find((snapshot) => snapshot.version === version);
    if (!target) {
      return undefined;
    }
    this.cache.setGraph(target.graph);
    return this.cache.getGraph(repoId);
  }

  public recoverCorruptGraph(repoId: string, fallback?: RepositoryGraph): RepositoryGraph | undefined {
    if (fallback) {
      this.cache.setGraph(fallback);
      return this.cache.getGraph(repoId);
    }
    return this.rollback(repoId);
  }

  private async drain(repoId: string): Promise<void> {
    if (this.processing.has(repoId)) {
      return;
    }
    this.processing.add(repoId);
    try {
      let queue = this.queues.get(repoId) ?? [];
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) {
          continue;
        }
        try {
          this.applyEvent(repoId, item.event);
          item.resolve();
        } catch (error) {
          item.reject(error);
        }
        queue = this.queues.get(repoId) ?? [];
      }
    } finally {
      this.processing.delete(repoId);
      if ((this.queues.get(repoId) ?? []).length === 0) {
        this.queues.delete(repoId);
      }
    }
  }

  private applyEvent(repoId: string, event: NormalizedWebhookEvent): void {
    const before = this.cache.getGraph(repoId);
    if (before) {
      this.captureSnapshot(before);
    }

    switch (event.eventType) {
      case "push":
        this.cache.addCommits(event.repository, event.commits);
        this.cache.updateFiles(event.repository, event.changedFiles);
        break;
      case "pull_request":
      case "merge_request":
        this.cache.upsertPullRequest(event.repository, event.pullRequest);
        if (event.changedFiles.length > 0) {
          this.cache.updateFiles(event.repository, event.changedFiles);
        }
        break;
      case "pull_request_review":
        this.cache.upsertReview(event.repository, event.review);
        break;
      case "issues":
      case "issue":
        if (event.issue) {
          this.cache.upsertIssue(event.repository, event.issue);
        } else {
          this.cache.upsertRepository(event.repository);
        }
        break;
      case "repository":
      case "wiki":
        this.cache.upsertRepository(event.repository);
        break;
      case "message":
      case "app_mention":
      case "reaction":
        this.applySlackDecision(event);
        break;
    }

    const after = this.cache.getGraph(repoId);
    this.recordAudit(
      event,
      repoId,
      before?.metadata.indexVersion,
      after?.metadata.indexVersion,
      "applied webhook update"
    );
  }

  private applySlackDecision(event: Extract<NormalizedWebhookEvent, { provider: "slack" }>): void {
    for (const ref of event.decision.linkedRefs) {
      if (!ref.owner || !ref.repo) {
        continue;
      }
      const repoId = `${ref.provider}:${ref.owner}/${ref.repo}`;
      this.cache.addSlackDecision(repoId, event.decision);
    }
  }

  private repoIdFromSlack(event: Extract<NormalizedWebhookEvent, { provider: "slack" }>): string | undefined {
    const ref = event.decision.linkedRefs.find((item) => item.owner && item.repo);
    return ref ? `${ref.provider}:${ref.owner}/${ref.repo}` : undefined;
  }

  private captureSnapshot(graph: RepositoryGraph): void {
    const snapshots = this.snapshots.get(graph.repoId) ?? [];
    snapshots.push({
      repoId: graph.repoId,
      version: graph.metadata.indexVersion,
      capturedAt: new Date(),
      graph
    });
    this.snapshots.set(graph.repoId, snapshots.slice(-this.maxSnapshotsPerRepo));
  }

  private recordAudit(
    event: NormalizedWebhookEvent,
    repoId: string | undefined,
    versionBefore: number | undefined,
    versionAfter: number | undefined,
    reason: string
  ): void {
    this.auditTrail.push({
      id: `${event.deliveryId}:${Date.now()}:${this.auditTrail.length}`,
      repoId,
      provider: event.provider,
      eventType: event.eventType,
      deliveryId: event.deliveryId,
      receivedAt: event.receivedAt,
      appliedAt: new Date(),
      versionBefore,
      versionAfter,
      reason
    });
    if (this.auditTrail.length > this.maxAuditRecords) {
      this.auditTrail.splice(0, this.auditTrail.length - this.maxAuditRecords);
    }
  }
}
