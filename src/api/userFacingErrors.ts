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

export type CoopApiErrorBody = {
  error?: string;
  message?: string;
};

const API_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Sign in to Coop first (API key or SSO).",
  admin_required: "Only your organization admin can connect GitHub. Ask IT to install the GitHub App.",
  plan_required: "This feature requires an Enterprise plan.",
  sso_not_configured: "SSO is not configured for your organization yet. Ask your admin to finish setup.",
  sso_unavailable: "Enterprise SSO is not available on this Coop environment.",
  missing_org: "Enter your organization name to sign in with SSO.",
  "GitHub App is not configured on this server":
    "GitHub integration is not configured on the Coop server. Contact your Coop administrator."
};

export function formatCoopApiError(
  status: number,
  body?: { error?: string; message?: string } | null
): string {
  const errorCode = body?.error?.trim();
  const serverMessage = body?.message?.trim();
  if (errorCode && API_ERROR_MESSAGES[errorCode]) {
    return API_ERROR_MESSAGES[errorCode];
  }
  if (serverMessage && API_ERROR_MESSAGES[serverMessage]) {
    return API_ERROR_MESSAGES[serverMessage];
  }
  if (serverMessage) {
    return serverMessage;
  }
  if (status === 503) {
    return "Coop service is unavailable. Contact your administrator.";
  }
  if (status === 403) {
    return "You do not have permission for this action.";
  }
  if (status === 401) {
    return "Sign in to Coop first (API key or SSO).";
  }
  return `Request failed (${status}).`;
}
