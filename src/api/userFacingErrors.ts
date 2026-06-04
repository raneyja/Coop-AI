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

const SETUP_REQUIRED_PATTERNS = [
  "api key is missing",
  "chat api returned 401",
  "chat api returned 403",
  "must use https"
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

  if (SETUP_REQUIRED_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "Coop isn't connected yet. Open Coop settings to finish setup, then try again.";
  }

  if (TRANSIENT_NETWORK_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "Coop isn't connected yet. Open Coop settings to finish setup, then try again.";
  }

  if (normalized.includes("chat api returned")) {
    return "Coop isn't ready yet. Please try again in a moment.";
  }

  return error.message;
}
