import { DEFAULT_INTENT_CONFIG, IntentBatchingConfig } from "../config/intentConfig";
import { ContextRequestType, IntentCost, IntentEvent } from "./intentDetector";
import { toRepositoryRelativePath } from "./repoFilePath";

export type ContextRequestParams = {
  file?: string;
  repoId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  languageId?: string;
  lines?: {
    start: number;
    end: number;
  };
  quickAction?: string;
  fileSource?: string;
  integrationProvider?: import("../chat/types").IntegrationChatProvider;
  [key: string]: unknown;
};

export interface ContextFetchRequest<TParams extends ContextRequestParams = ContextRequestParams> {
  id: string;
  type: ContextRequestType;
  params: TParams;
  intent: IntentEvent;
  cost: IntentCost;
  createdAt: Date;
  cacheKey?: string;
}

export type ContextFetchResult<TData = unknown> = {
  requestId: string;
  type: ContextRequestType;
  data?: TData;
  error?: string;
  stale?: boolean;
  message?: string;
  fetchedAt: Date;
};

export type BatchRequest = {
  requests: ContextFetchRequest[];
  deadline: Date;
  callbacks: Array<(result: ContextFetchResult) => void>;
};

export type BatchExecutionResult =
  | Map<string, ContextFetchResult>
  | Record<string, ContextFetchResult>
  | ContextFetchResult[];

export type BatchExecutor = (requests: ContextFetchRequest[]) => Promise<BatchExecutionResult>;

type PendingBatch = {
  key: string;
  requests: ContextFetchRequest[];
  callbacks: Array<{
    resolve: (result: ContextFetchResult) => void;
    reject: (error: unknown) => void;
  }>;
  timer?: ReturnType<typeof setTimeout>;
  deadline: Date;
};

export type RequestBatcherOptions = {
  config?: Partial<IntentBatchingConfig>;
  groupKey?: (request: ContextFetchRequest) => string;
  onBatchStart?: (batch: BatchRequest) => void;
  onBatchComplete?: (batch: BatchRequest, results: ContextFetchResult[]) => void;
};

export class RequestBatcher {
  private readonly config: IntentBatchingConfig;
  private readonly batches = new Map<string, PendingBatch>();
  private readonly groupKey: (request: ContextFetchRequest) => string;
  private readonly onBatchStart?: RequestBatcherOptions["onBatchStart"];
  private readonly onBatchComplete?: RequestBatcherOptions["onBatchComplete"];

  public constructor(
    private readonly executeBatch: BatchExecutor,
    options: RequestBatcherOptions = {}
  ) {
    this.config = {
      ...DEFAULT_INTENT_CONFIG.batching,
      ...options.config
    };
    this.groupKey = options.groupKey ?? defaultBatchGroupKey;
    this.onBatchStart = options.onBatchStart;
    this.onBatchComplete = options.onBatchComplete;
  }

  public enqueue(request: ContextFetchRequest): Promise<ContextFetchResult> {
    if (!this.config.enabled || this.config.window <= 0 || request.intent.costEstimate === "expensive") {
      return this.executeSingle(request);
    }

    const key = this.groupKey(request);
    const batch = this.batches.get(key) ?? this.createBatch(key);
    batch.requests.push(request);

    const promise = new Promise<ContextFetchResult>((resolve, reject) => {
      batch.callbacks.push({ resolve, reject });
    });

    if (batch.requests.length >= this.config.maxRequests) {
      this.executePending(key);
    } else if (!batch.timer) {
      batch.timer = setTimeout(() => this.executePending(key), this.config.window);
    }

    return promise;
  }

  public flush(): Promise<void[]> {
    return Promise.all([...this.batches.keys()].map((key) => this.executePending(key)));
  }

  public cancelAll(reason = "Batch request cancelled."): void {
    for (const [key, batch] of this.batches) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      for (const callback of batch.callbacks) {
        callback.resolve({
          requestId: "cancelled",
          type: "chat_context",
          error: reason,
          fetchedAt: new Date()
        });
      }
      this.batches.delete(key);
    }
  }

  public pendingCount(): number {
    return [...this.batches.values()].reduce((total, batch) => total + batch.requests.length, 0);
  }

  private createBatch(key: string): PendingBatch {
    const batch: PendingBatch = {
      key,
      requests: [],
      callbacks: [],
      deadline: new Date(Date.now() + this.config.window)
    };
    this.batches.set(key, batch);
    return batch;
  }

  private async executeSingle(request: ContextFetchRequest): Promise<ContextFetchResult> {
    const results = normalizeBatchResults(await this.executeBatch([request]));
    return results.get(request.id) ?? missingResult(request);
  }

  private async executePending(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }
    this.batches.delete(key);
    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    const publicBatch: BatchRequest = {
      requests: [...batch.requests],
      deadline: batch.deadline,
      callbacks: batch.callbacks.map((callback) => callback.resolve)
    };
    this.onBatchStart?.(publicBatch);

    try {
      const results = normalizeBatchResults(await this.executeBatch(batch.requests));
      const resolved: ContextFetchResult[] = [];
      for (let index = 0; index < batch.requests.length; index += 1) {
        const request = batch.requests[index];
        const result = results.get(request.id) ?? missingResult(request);
        resolved.push(result);
        batch.callbacks[index]?.resolve(result);
      }
      this.onBatchComplete?.(publicBatch, resolved);
    } catch (error) {
      for (const callback of batch.callbacks) {
        callback.reject(error);
      }
    }
  }
}

export function buildContextRequests(event: IntentEvent, types: ContextRequestType[]): ContextFetchRequest[] {
  const file = event.context.file ? toRepositoryRelativePath(event.context.file) : undefined;
  return types.map((type, index) => ({
    id: `${event.id}:${type}:${index}`,
    type,
    params: {
      file,
      repoId: event.context.repoId,
      owner: event.context.owner,
      repo: event.context.repo,
      branch: event.context.branch,
      languageId: event.context.languageId,
      lines: event.context.lines,
      quickAction: event.context.buttonClicked,
      fileSource: event.context.fileSource,
      integrationProvider: event.context.integrationProvider,
      openEditors: event.context.openEditors
    },
    intent: event,
    cost: event.costEstimate,
    createdAt: new Date(),
    cacheKey: cacheKeyForRequest(type, event)
  }));
}

export function cacheKeyForRequest(type: ContextRequestType, event: IntentEvent): string {
  const context = event.context;
  const lines = context.lines ? `${context.lines.start}-${context.lines.end}` : "none";
  return [
    type,
    context.repoId ?? "repo",
    context.file ?? "workspace",
    lines,
    context.buttonClicked ?? "no-action"
  ].join(":");
}

export function defaultBatchGroupKey(request: ContextFetchRequest): string {
  const repo = request.params.repoId ?? "repo";
  const file = request.params.file ?? "workspace";
  return `${repo}:${file}`;
}

export function normalizeBatchResults(results: BatchExecutionResult): Map<string, ContextFetchResult> {
  if (results instanceof Map) {
    return results;
  }
  if (Array.isArray(results)) {
    return new Map(results.map((result) => [result.requestId, result]));
  }
  return new Map(Object.entries(results));
}

function missingResult(request: ContextFetchRequest): ContextFetchResult {
  return {
    requestId: request.id,
    type: request.type,
    error: "No result returned for context request.",
    fetchedAt: new Date()
  };
}
