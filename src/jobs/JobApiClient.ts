import axios, { AxiosInstance } from "axios";
import { runResilientRequest, isRetryableError } from "../api/networkResilience";
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
      timeout: 120_000
    });
  }

  public setBaseUrl(baseUrl: string): void {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      timeout: 120_000
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

  public async getJob(
    jobId: string,
    requestTimeoutMs?: number
  ): Promise<Record<string, unknown>> {
    const response = await this.request({
      method: "GET",
      url: `/api/jobs/${encodeURIComponent(jobId)}`,
      timeoutMs: requestTimeoutMs
    });
    return response.data as Record<string, unknown>;
  }

  public async getJobResult(
    jobId: string,
    requestTimeoutMs?: number
  ): Promise<Record<string, unknown>> {
    const response = await this.request({
      method: "GET",
      url: `/api/jobs/${encodeURIComponent(jobId)}/result`,
      timeoutMs: requestTimeoutMs
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
    options: { intervalMs?: number; timeoutMs?: number; requestTimeoutMs?: number } = {}
  ): Promise<Record<string, unknown>> {
    const intervalMs = options.intervalMs ?? 1500;
    const timeoutMs = options.timeoutMs ?? 600_000;
    const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const job = await this.getJob(jobId, requestTimeoutMs);
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
        return this.getJobResult(jobId, requestTimeoutMs);
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(String(job.error ?? `Job ${status}`));
      }
      await delay(intervalMs);
    }
    throw new Error("Job polling timed out");
  }

  private async request(config: {
    method: string;
    url: string;
    data?: unknown;
    timeoutMs?: number;
  }): Promise<{ data: unknown; status: number }> {
    const headers = await this.authHeaders();
    const response = await runResilientRequest({
      timeoutMs: config.timeoutMs ?? 120_000,
      shouldRetryError: (error) => isRetryableError(error),
      run: async () =>
        this.http.request({
          method: config.method,
          url: config.url,
          data: config.data,
          headers,
          timeout: config.timeoutMs ?? 120_000,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
