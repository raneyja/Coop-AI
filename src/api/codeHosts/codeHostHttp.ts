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
  body?: string | FormData;
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

export async function codeHostRequestOk(
  url: string,
  options: HttpRequestOptions & {
    provider: CodeHostProvider;
    rateLimitTracker?: RateLimitTracker;
  }
): Promise<Response> {
  const response = await codeHostRequest(url, options);
  if (!response.ok) {
    throw await mapHttpError(response, options.provider);
  }
  return response;
}

/** Empty 201 bodies (Bitbucket src commit) must not throw SyntaxError. */
export async function parseResponseJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function codeHostRequestJson<T>(
  url: string,
  options: HttpRequestOptions & {
    provider: CodeHostProvider;
    rateLimitTracker?: RateLimitTracker;
  }
): Promise<T> {
  const response = await codeHostRequestOk(url, options);
  const parsed = await parseResponseJson<T>(response);
  if (parsed === undefined) {
    throw new CodeHostError(
      "The code host returned an empty response.",
      "network",
      response.status,
      options.provider
    );
  }
  return parsed;
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
        throw await authErrorFromResponse(result, options.provider);
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
      throw await mapHttpError(response, options.provider);
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

async function authErrorFromResponse(response: Response, provider: CodeHostProvider): Promise<CodeHostError> {
  const detail = await readJsonErrorMessage(response);
  const base = "Authentication failed. Update your token in settings.";
  return new CodeHostError(detail ? `${base} ${detail}` : base, "auth", response.status, provider);
}

async function readJsonErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return undefined;
    }
    const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    const nested = parsed.error?.message;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function mapHttpError(response: Response, provider: CodeHostProvider): Promise<CodeHostError> {
  if (response.status === 401 || response.status === 403) {
    return new CodeHostError("Authentication failed. Update your token in settings.", "auth", response.status, provider);
  }
  if (response.status === 429) {
    return new CodeHostError("Rate limit exceeded.", "rate_limit", response.status, provider);
  }
  if (response.status === 404) {
    return new CodeHostError("Resource not found.", "not_found", response.status, provider);
  }
  const detail = await readJsonErrorMessage(response);
  return new CodeHostError(
    detail ? `Request failed (${response.status}). ${detail}` : `Request failed (${response.status}).`,
    "network",
    response.status,
    provider
  );
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
