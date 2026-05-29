import { DEFAULT_INTENT_CONFIG, IntentPrioritizationConfig } from "../config/intentConfig";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import { UserIntent } from "./intentDetector";

export enum RequestPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3
}

export type PriorityRateLimitState = {
  remaining: number;
  limit: number;
  percentageRemaining: number;
};

export type PriorityDecision = {
  priority: RequestPriority;
  reason: string;
};

export type PrioritizedRequest = ContextFetchRequest & {
  priority: RequestPriority;
};

export type PrioritizedExecutor = (request: PrioritizedRequest) => Promise<ContextFetchResult>;

type QueueTask = {
  request: PrioritizedRequest;
  execute: PrioritizedExecutor;
  resolve: (result: ContextFetchResult) => void;
  reject: (error: unknown) => void;
};

export type RequestPrioritizerOptions = {
  config?: Partial<IntentPrioritizationConfig>;
  getRateLimitState?: () => PriorityRateLimitState | undefined;
  expensiveLowQuotaThreshold?: number;
  lowQueueQuotaThreshold?: number;
};

export class RequestPrioritizer {
  private readonly config: IntentPrioritizationConfig;
  private readonly queues = new Map<RequestPriority, QueueTask[]>([
    [RequestPriority.CRITICAL, []],
    [RequestPriority.HIGH, []],
    [RequestPriority.NORMAL, []],
    [RequestPriority.LOW, []]
  ]);
  private running = false;
  private readonly getRateLimitState?: () => PriorityRateLimitState | undefined;
  private readonly expensiveLowQuotaThreshold: number;
  private readonly lowQueueQuotaThreshold: number;

  public constructor(options: RequestPrioritizerOptions = {}) {
    this.config = {
      ...DEFAULT_INTENT_CONFIG.prioritization,
      ...options.config
    };
    this.getRateLimitState = options.getRateLimitState;
    this.expensiveLowQuotaThreshold = options.expensiveLowQuotaThreshold ?? 0.2;
    this.lowQueueQuotaThreshold = options.lowQueueQuotaThreshold ?? 0.5;
  }

  public enqueue(request: ContextFetchRequest, execute: PrioritizedExecutor): Promise<ContextFetchResult> {
    const prioritized = this.prioritize(request);
    if (!this.config.enabled || !this.config.useQueueSystem || prioritized.priority === RequestPriority.CRITICAL) {
      return execute(prioritized);
    }

    return new Promise<ContextFetchResult>((resolve, reject) => {
      this.queues.get(prioritized.priority)?.push({
        request: prioritized,
        execute,
        resolve,
        reject
      });
      this.scheduleDrain();
    });
  }

  public prioritize(request: ContextFetchRequest): PrioritizedRequest {
    return {
      ...request,
      priority: this.decisionFor(request).priority
    };
  }

  public decisionFor(request: ContextFetchRequest): PriorityDecision {
    const intent = request.intent.intent;
    if (intent === UserIntent.QUICK_ACTION_CLICKED) {
      return { priority: RequestPriority.CRITICAL, reason: "Explicit quick action is waiting on the result." };
    }
    if (intent === UserIntent.MANUAL_CHAT_SUBMIT || intent === UserIntent.HOTKEY_TRIGGERED) {
      return { priority: RequestPriority.CRITICAL, reason: "Explicit chat or command submit is waiting on the result." };
    }
    if (request.cost === "expensive" && this.isLowQuota()) {
      return { priority: RequestPriority.LOW, reason: "Expensive request deferred because quota is low." };
    }
    if (intent === UserIntent.SELECTION_CHANGE) {
      return { priority: RequestPriority.HIGH, reason: "Stable selection can enrich the current work." };
    }
    if (intent === UserIntent.FILE_SWITCHED || intent === UserIntent.EDITOR_OPENED) {
      return { priority: RequestPriority.NORMAL, reason: "Editor context enhancement can run after active work." };
    }
    return { priority: RequestPriority.NORMAL, reason: "Default context request priority." };
  }

  public queueSizes(): Record<"critical" | "high" | "normal" | "low", number> {
    return {
      critical: this.queues.get(RequestPriority.CRITICAL)?.length ?? 0,
      high: this.queues.get(RequestPriority.HIGH)?.length ?? 0,
      normal: this.queues.get(RequestPriority.NORMAL)?.length ?? 0,
      low: this.queues.get(RequestPriority.LOW)?.length ?? 0
    };
  }

  public clear(reason = "Request queue cleared."): void {
    for (const queue of this.queues.values()) {
      while (queue.length > 0) {
        const task = queue.shift();
        task?.resolve({
          requestId: task.request.id,
          type: task.request.type,
          error: reason,
          fetchedAt: new Date()
        });
      }
    }
  }

  private scheduleDrain(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    queueMicrotask(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.hasWork()) {
        const task = this.nextTask();
        if (!task) {
          return;
        }
        try {
          task.resolve(await task.execute(task.request));
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private nextTask(): QueueTask | undefined {
    const critical = this.queues.get(RequestPriority.CRITICAL)?.shift();
    if (critical) {
      return critical;
    }
    const high = this.queues.get(RequestPriority.HIGH)?.shift();
    if (high) {
      return high;
    }
    const normal = this.queues.get(RequestPriority.NORMAL)?.shift();
    if (normal && !this.shouldPauseNormal()) {
      return normal;
    }
    if (normal) {
      this.queues.get(RequestPriority.NORMAL)?.unshift(normal);
      return undefined;
    }
    const low = this.queues.get(RequestPriority.LOW)?.shift();
    if (low && this.canRunLowPriority()) {
      return low;
    }
    if (low) {
      this.queues.get(RequestPriority.LOW)?.unshift(low);
    }
    return undefined;
  }

  private hasWork(): boolean {
    return [...this.queues.values()].some((queue) => queue.length > 0);
  }

  private isLowQuota(): boolean {
    const state = this.getRateLimitState?.();
    return Boolean(state && state.percentageRemaining < this.expensiveLowQuotaThreshold);
  }

  private shouldPauseNormal(): boolean {
    const state = this.getRateLimitState?.();
    return Boolean(state && state.percentageRemaining <= 0.1);
  }

  private canRunLowPriority(): boolean {
    const state = this.getRateLimitState?.();
    return !state || state.percentageRemaining > this.lowQueueQuotaThreshold;
  }
}
