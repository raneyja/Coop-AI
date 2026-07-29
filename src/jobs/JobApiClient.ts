import axios, { AxiosInstance } from "axios";
import { runResilientRequest, isRetryableError } from "../api/networkResilience";
import { MAX_USER_FACING_RESPONSE_MS } from "../config/responseDeadline";
import { JobType, type JobProgressEvent, type JobSubmitResponse } from "./types";

export type JobApiClientOptions = {
  baseUrl: string;
  getToken?: () => Promise<string | undefined>;
};

export class JobApiClient {
  private http: AxiosInstance;

  public constructor(private readonly options: JobApiClientOptions) {
    this.http = axios.create({
      baseURL: options.baseUrl.replace(/\/$/, ""),
      timeout: MAX_USER_FACING_RESPONSE_MS
    });
  }

  public setBaseUrl(baseUrl: string): void {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      timeout: MAX_USER_FACING_RESPONSE_MS
    });
  }

  public async submitJob(input: {
    type: JobType;
    priority?: "high" | "normal" | "low";
    params: Record<string, unknown>;
    userId?: string;
  }): Promise<JobSubmitResponse> {
    const response = await this.request({
      method: "POST",
      url: "/api/jobs",
      data: input
    });
    return response.data as JobSubmitResponse;
  }

  public async getJob(jobId: string): Promise<Record<string, unknown>> {
    const response = await this.request({
      method: "GET",
      url: `/api/jobs/${encodeURIComponent(jobId)}`
    });
    return response.data as Record<string, unknown>;
  }

  public async getJobResult(jobId: string): Promise<Record<string, unknown>> {
    const response = await this.request({
      method: "GET",
      url: `/api/jobs/${encodeURIComponent(jobId)}/result`
    });
    return response.data as Record<string, unknown>;
  }

  public async cancelJob(jobId: string): Promise<Record<string, unknown>> {
    const response = await this.request({
      method: "DELETE",
      url: `/api/jobs/${encodeURIComponent(jobId)}`
    });
    return response.data as Record<string, unknown>;
  }

  public async pollUntilComplete(
    jobId: string,
    onProgress: (event: JobProgressEvent) => void,
    options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<Record<string, unknown>> {
    const intervalMs = options.intervalMs ?? 1500;
    const timeoutMs = options.timeoutMs ?? MAX_USER_FACING_RESPONSE_MS;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (options.signal?.aborted) {
        throw new Error("Job aborted");
      }
      const job = await this.getJob(jobId);
      const status = String(job.status ?? "queued");
      const progress = Number(job.progress ?? 0);
      onProgress({
        jobId,
        status: status as JobProgressEvent["status"],
        progress,
        etaMs: typeof job.etaMs === "number" ? job.etaMs : undefined,
        message: typeof job.error === "string" ? job.error : undefined
      });

      if (status === "completed" || status === "partial") {
        return this.getJobResult(jobId);
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(String(job.error ?? `Job ${status}`));
      }
      await delay(intervalMs, options.signal);
    }
    throw new Error("Job polling timed out");
  }

  private async request(config: { method: string; url: string; data?: unknown }): Promise<{ data: unknown; status: number }> {
    const headers = await this.authHeaders();
    const response = await runResilientRequest({
      // Soft gather: poll within remaining prepare budget, then synthesize (never abort the turn).
      timeoutMs: MAX_USER_FACING_RESPONSE_MS,
      policy: { maxRetries: 0 },
      shouldRetryError: (error) => isRetryableError(error),
      run: async () =>
        this.http.request({
          method: config.method,
          url: config.url,
          data: config.data,
          headers,
          validateStatus: () => true
        })
    });

    if (response.status === 429) {
      const body = response.data as Record<string, unknown>;
      throw new Error(String(body.error ?? "Rate limit exceeded"));
    }
    if (response.status < 200 || response.status >= 300) {
      const body = response.data as Record<string, unknown>;
      throw new Error(String(body.error ?? `Jobs API returned ${response.status}`));
    }
    return { data: response.data, status: response.status };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.options.getToken?.();
    if (!token) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Job aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Job aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function jobTypeForQuickAction(actionId: string): JobType | undefined {
  switch (actionId) {
    case "knowledge-gaps":
      return JobType.SCAN_KNOWLEDGE_GAPS;
    case "blast-radius":
      return JobType.BUILD_DEPENDENCY_GRAPH;
    default:
      return undefined;
  }
}

export function shouldUseAsyncJob(actionId: string): boolean {
  return jobTypeForQuickAction(actionId) !== undefined;
}
