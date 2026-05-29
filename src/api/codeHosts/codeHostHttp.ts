import { RateLimitTracker } from "../rateLimitTracker";
import {
  fetchWithTimeout,
  isRetryableStatus,
  NetworkResilienceError,
  runResilientRequest
} from "../networkResilience";
import type { CodeHostProvider } from "./types";
import { CodeHostError } from "./types";

export type CodeHostRateLimitProvider = CodeHostProvider;

export type HttpRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export type PaginatedFetchOptions<T> = {
  firstUrl: string;
  headers: Record<string, string>;
  provider: CodeHostProvider;
  rateLimitTracker?: RateLimitTracker;
  timeoutMs?: number;
  maxPages?: number;
  mapPage: (payload: unknown) => T[];
  nextUrl?: (payload: unknown, response: Response) => string | undefined;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 1_024 * 1_024;

export async function codeHostRequestJson<T>(
  url: string,
  options: HttpRequestOptions & {
    provider: CodeHostProvider;
    rateLimitTracker?: RateLimitTracker;
  }
): Promise<T> {
  const response = await codeHostRequest(url, options);
  if (!response.ok) {
    throw mapHttpError(response, options.provider);
  }
  return (await response.json()) as T;
}

export async function codeHostRequest(
  url: string,
  options: HttpRequestOptions & {
    provider: CodeHostProvider;
    rateLimitTracker?: RateLimitTracker;
  }
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return runResilientRequest({
    timeoutMs,
    shouldRetryError: (error) => {
      if (error instanceof CodeHostError) {
        return error.code === "rate_limit" || error.code === "network";
      }
      if (error instanceof NetworkResilienceError) {
        return error.timeout || (error.status !== undefined && isRetryableStatus(error.status));
      }
      return false;
    },
    run: async (signal) => {
      const result = await fetchWithTimeout(
        url,
        {
          method: options.method ?? "GET",
          headers: options.headers,
          body: options.body,
          signal
        },
        timeoutMs
      );
      if ("timeout" in result) {
        throw new CodeHostError(result.message, "network", undefined, options.provider);
      }
      options.rateLimitTracker?.updateFromHeaders(options.provider, headersToRecord(result.headers));
      if (result.status === 401 || result.status === 403) {
        throw new CodeHostError("Authentication failed. Update your token in settings.", "auth", result.status, options.provider);
      }
      if (result.status === 429) {
        throw new CodeHostError("Rate limit exceeded. Requests will retry shortly.", "rate_limit", result.status, options.provider);
      }
      if (result.status === 404) {
        throw new CodeHostError("Resource not found.", "not_found", result.status, options.provider);
      }
      return result;
    }
  });
}

export async function paginatedCodeHostFetch<T>(options: PaginatedFetchOptions<T>): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = options.firstUrl;
  let page = 0;
  const maxPages = options.maxPages ?? 10;
  while (url && page < maxPages) {
    const response = await codeHostRequest(url, {
      headers: options.headers,
      provider: options.provider,
      rateLimitTracker: options.rateLimitTracker,
      timeoutMs: options.timeoutMs
    });
    if (!response.ok) {
      throw mapHttpError(response, options.provider);
    }
    const payload = (await response.json()) as unknown;
    items.push(...options.mapPage(payload));
    url = options.nextUrl?.(payload, response) ?? parseLinkNext(response.headers.get("link"));
    page += 1;
  }
  return items;
}

export function parseLinkNext(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1];
}

export function decodeContent(
  content: string,
  encoding: string | undefined,
  maxBytes = MAX_FILE_BYTES
): { text: string; truncated: boolean } {
  if (encoding === "base64") {
    const buffer = Buffer.from(content, "base64");
    const truncated = buffer.length > maxBytes;
    const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
    return { text: slice.toString("utf-8"), truncated };
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > maxBytes) {
    return { text: content.slice(0, maxBytes), truncated: true };
  }
  return { text: content, truncated: false };
}

export function linesFromText(text: string): Array<{ number: number; text: string }> {
  const parts = text.split(/\r?\n/);
  return parts.map((line, index) => ({ number: index + 1, text: line }));
}

function mapHttpError(response: Response, provider: CodeHostProvider): CodeHostError {
  if (response.status === 401 || response.status === 403) {
    return new CodeHostError("Authentication failed. Update your token in settings.", "auth", response.status, provider);
  }
  if (response.status === 429) {
    return new CodeHostError("Rate limit exceeded.", "rate_limit", response.status, provider);
  }
  if (response.status === 404) {
    return new CodeHostError("Resource not found.", "not_found", response.status, provider);
  }
  return new CodeHostError(`Request failed (${response.status}).`, "network", response.status, provider);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
