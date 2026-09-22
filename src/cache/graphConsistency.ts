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

  public isStale(orgId: string, repoId: string): boolean {
    const graph = orgId ? this.cache.getGraph(orgId, repoId) : undefined;
    if (!graph) {
      return true;
    }
    return Date.now() - graph.lastUpdated.getTime() > this.staleAfterMs;
  }

  public rollback(orgId: string, repoId: string, version?: number): RepositoryGraph | undefined {
    if (!orgId) {
      return undefined;
    }
    const snapshots = this.snapshots.get(repoId) ?? [];
    const target = version === undefined
      ? snapshots[snapshots.length - 1]
      : snapshots.find((snapshot) => snapshot.version === version);
    if (!target) {
      return undefined;
    }
    this.cache.setGraph(orgId, target.graph);
    return this.cache.getGraph(orgId, repoId);
  }

  public recoverCorruptGraph(
    orgId: string,
    repoId: string,
    fallback?: RepositoryGraph
  ): RepositoryGraph | undefined {
    if (!orgId) {
      return undefined;
    }
    if (fallback) {
      this.cache.setGraph(orgId, fallback);
      return this.cache.getGraph(orgId, repoId);
    }
    return this.rollback(orgId, repoId);
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
    // Webhook deliveries do not carry org id. Do not write a shared graph row
    // or fan the event out to every tenant that indexed this slug.
    this.recordAudit(event, repoId, undefined, undefined, "skipped: no org id");
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
