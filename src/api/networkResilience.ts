export type RetryPolicy = {
  maxRetries: number;
  backoffMs: number;
  exponentialBackoff: boolean;
  retryOn: number[];
  dontRetryOn: number[];
};

export type TimeoutResult = {
  timeout: true;
  message: string;
};

export type ResilientRequestOptions<T> = {
  policy?: Partial<RetryPolicy>;
  timeoutMs?: number;
  shouldRetryError?: (error: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, error?: unknown) => void;
  run: (signal?: AbortSignal) => Promise<T>;
};

export const RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 1_000,
  exponentialBackoff: true,
  retryOn: [408, 429, 500, 502, 503, 504],
  dontRetryOn: [401, 403]
};

export class NetworkResilienceError extends Error {
  public constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number,
    public readonly timeout = false
  ) {
    super(message);
    this.name = "NetworkResilienceError";
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5_000
): Promise<Response | TimeoutResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      return {
        timeout: true,
        message: `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  shouldRetry: (error: unknown) => boolean = () => true,
  onRetry?: (attempt: number, delayMs: number, error?: unknown) => void
): Promise<T> {
  const merged = mergeRetryPolicy(policy);
  let lastError: unknown;
  for (let attempt = 0; attempt <= merged.maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= merged.maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = retryDelayMs(attempt, merged);
      onRetry?.(attempt + 1, delayMs, error);
      await delay(delayMs);
    }
  }
  throw lastError;
}

export async function runResilientRequest<T>({
  policy,
  timeoutMs,
  shouldRetryError,
  onRetry,
  run
}: ResilientRequestOptions<T>): Promise<T> {
  return retryWithBackoff(
    async () => {
      if (!timeoutMs || timeoutMs <= 0) {
        return run();
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await run(controller.signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw new NetworkResilienceError(
            `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
            error,
            undefined,
            true
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    policy,
    (error) => shouldRetryError?.(error) ?? isRetryableError(error, policy),
    onRetry
  );
}

export function isRetryableStatus(status: number, policy: Partial<RetryPolicy> = {}): boolean {
  const merged = mergeRetryPolicy(policy);
  if (merged.dontRetryOn.includes(status)) {
    return false;
  }
  return merged.retryOn.includes(status);
}

export function isRetryableError(error: unknown, policy: Partial<RetryPolicy> = {}): boolean {
  if (error instanceof NetworkResilienceError) {
    return error.timeout || (error.status !== undefined && isRetryableStatus(error.status, policy));
  }
  const status = statusFromError(error);
  if (status !== undefined) {
    return isRetryableStatus(status, policy);
  }
  return isTransientNetworkError(error);
}

export function statusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const response = "response" in error ? (error as { response?: { status?: unknown } }).response : undefined;
  if (typeof response?.status === "number") {
    return response.status;
  }
  const status = "status" in error ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : undefined;
}

export function retryDelayMs(attempt: number, policy: Partial<RetryPolicy> = {}): number {
  const merged = mergeRetryPolicy(policy);
  const multiplier = merged.exponentialBackoff ? 2 ** attempt : 1;
  return merged.backoffMs * multiplier;
}

export function mergeRetryPolicy(policy: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    ...RETRY_POLICY,
    ...policy,
    retryOn: policy.retryOn ?? RETRY_POLICY.retryOn,
    dontRetryOn: policy.dontRetryOn ?? RETRY_POLICY.dontRetryOn
  };
}

function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED"].includes(code);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
