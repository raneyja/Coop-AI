const TRANSIENT_NETWORK_PATTERNS = [
  "fetch failed",
  "network error",
  "network request failed",
  "failed to fetch",
  "econnrefused",
  "enotfound",
  "eai_again",
  "etimedout",
  "econnreset",
  "socket hang up"
];

/**
 * Turn low-level fetch/network errors into actionable chat UI copy.
 */
export function formatUserFacingNetworkError(error: unknown, fallback = "Chat request failed."): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.name === "AbortError") {
    return "Request cancelled.";
  }

  const normalized = error.message.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (TRANSIENT_NETWORK_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "Couldn't reach the Coop API. Check your API key and base URL in CoopAI settings.";
  }

  return error.message;
}
