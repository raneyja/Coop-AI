import type { ContextFetchResult } from "./requestBatcher";
import {
  attachLocalFilesToData,
  localFilesFromContextData,
  type LocalFileContextPayload
} from "./localFileContext";

export function applyLocalFallbackToResult(
  result: ContextFetchResult,
  local: LocalFileContextPayload | undefined
): ContextFetchResult {
  if (!local) {
    return result;
  }

  const data = attachLocalFilesToData(
    typeof result.data === "object" && result.data !== null ? (result.data as Record<string, unknown>) : undefined,
    local
  );

  if (result.error) {
    return {
      ...result,
      error: undefined,
      data,
      message: localFallbackMessage(result.message),
      stale: true
    };
  }

  return {
    ...result,
    data,
    stale: Boolean(result.stale)
  };
}

export function contextResultHasLocalFiles(result: ContextFetchResult | undefined): boolean {
  if (!result) {
    return false;
  }
  return localFilesFromContextData(result.data).length > 0;
}

function localFallbackMessage(existing?: string): string {
  if (existing && /offline/i.test(existing)) {
    return existing.replace(/Context unavailable\.?/i, "").trim() || "Analyzing from local workspace.";
  }
  return "GitHub offline — analyzing from local workspace.";
}
