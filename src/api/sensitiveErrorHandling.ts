import { sanitizeErrorText, sanitizeHeaders, sanitizePlainText } from "./dataSanitization";

export type SafeErrorContext = {
  requestId?: string;
  provider?: string;
  model?: string;
  operation?: string;
  statusCode?: number;
  headers?: Record<string, unknown>;
};

export type SafeErrorLogEntry = {
  level: "error" | "warn" | "info";
  message: string;
  timestamp: Date;
  context: Omit<SafeErrorContext, "headers"> & {
    headers?: Record<string, unknown>;
  };
};

export interface SafeLogger {
  log(entry: SafeErrorLogEntry): void | Promise<void>;
}

export class SensitiveError extends Error {
  public readonly safeMessage: string;
  public readonly context: SafeErrorContext;

  public constructor(message: string, context: SafeErrorContext = {}) {
    super(sanitizeErrorText(message));
    this.name = "SensitiveError";
    this.safeMessage = this.message;
    this.context = sanitizeContext(context);
  }
}

export function toSafeError(error: unknown, fallback = "Error processing code context (sanitized)"): SensitiveError {
  if (error instanceof SensitiveError) {
    return error;
  }
  if (error instanceof Error) {
    return new SensitiveError(error.message || fallback);
  }
  return new SensitiveError(fallback);
}

export async function logSafeError(
  logger: SafeLogger,
  error: unknown,
  context: SafeErrorContext = {},
  level: SafeErrorLogEntry["level"] = "error"
): Promise<SafeErrorLogEntry> {
  const safeError = toSafeError(error);
  const entry: SafeErrorLogEntry = {
    level,
    message: safeError.safeMessage,
    timestamp: new Date(),
    context: {
      ...safeError.context,
      ...sanitizeContext(context)
    }
  };
  await logger.log(entry);
  return entry;
}

export function safeErrorResponse(error: unknown, statusCode = 500): { statusCode: number; body: { error: string } } {
  const safeError = toSafeError(error);
  return {
    statusCode,
    body: {
      error: safeError.safeMessage || "Error processing code context (sanitized)"
    }
  };
}

export function sanitizeCrashDumpMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const blockedKeys = new Set(["body", "requestBody", "responseBody", "prompt", "completion", "apiKey", "authorization"]);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !blockedKeys.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? sanitizePlainText(value) : sanitizeValue(value)])
  );
}

export function redactStackTrace(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  return sanitizeErrorText(stack)
    .split("\n")
    .filter((line) => !/authorization|api[_-]?key|password|secret|token/i.test(line))
    .join("\n");
}

export class InMemorySafeLogger implements SafeLogger {
  private readonly entries: SafeErrorLogEntry[] = [];

  public log(entry: SafeErrorLogEntry): void {
    this.entries.push({
      ...entry,
      timestamp: new Date(entry.timestamp),
      context: { ...entry.context }
    });
  }

  public list(): SafeErrorLogEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
      context: { ...entry.context }
    }));
  }
}

function sanitizeContext(context: SafeErrorContext): SafeErrorContext {
  return {
    requestId: context.requestId ? sanitizePlainText(context.requestId) : undefined,
    provider: context.provider ? sanitizePlainText(context.provider) : undefined,
    model: context.model ? sanitizePlainText(context.model) : undefined,
    operation: context.operation ? sanitizePlainText(context.operation) : undefined,
    statusCode: context.statusCode,
    headers: context.headers ? sanitizeHeaders(context.headers) : undefined
  };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePlainText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeCrashDumpMetadata(value as Record<string, unknown>);
  }
  return value;
}
