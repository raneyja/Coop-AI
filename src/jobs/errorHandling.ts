export type ErrorClass = "transient" | "permanent" | "cancelled";

export type RetryPolicy = {
  maxRetries: number;
  backoffMs: number;
};

export type PartialFailureResult = {
  status: "partial";
  completedRepos: string[];
  failedRepos: string[];
  results: Record<string, unknown>;
  error: string;
};

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /econnreset/i,
  /econnrefused/i,
  /network/i,
  /429/,
  /rate limit/i,
  /503/,
  /502/,
  /504/,
  /temporary/i,
  /unavailable/i
];

const PERMANENT_PATTERNS = [
  /invalid/i,
  /unauthorized/i,
  /403/,
  /404/,
  /not found/i,
  /bad request/i,
  /400/,
  /cancelled/i,
  /canceled/i
];

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof JobCancelledError) {
    return "cancelled";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (PERMANENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "permanent";
  }
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "transient";
  }
  return "transient";
}

export function shouldRetry(error: unknown, retryCount: number, policy: RetryPolicy): boolean {
  const classification = classifyError(error);
  if (classification === "permanent" || classification === "cancelled") {
    return false;
  }
  return retryCount < policy.maxRetries;
}

export function backoffDelayMs(retryCount: number, policy: RetryPolicy): number {
  return policy.backoffMs * Math.pow(2, retryCount);
}

export function normalizeJobError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function buildPartialFailure(
  completedRepos: string[],
  failedRepos: string[],
  results: Record<string, unknown>,
  error: string
): PartialFailureResult {
  return {
    status: "partial",
    completedRepos,
    failedRepos,
    results,
    error
  };
}

export class JobCancelledError extends Error {
  public constructor(message = "Job cancelled by user") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export class JobTimeoutError extends Error {
  public constructor(maxDurationMs: number) {
    super(`Job exceeded maximum duration of ${maxDurationMs}ms`);
    this.name = "JobTimeoutError";
  }
}
