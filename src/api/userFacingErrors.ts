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

const QUOTA_LIMIT_PATTERNS = [
  "daily ai limit",
  "daily_limit_reached",
  "quota_limit_reached",
  "free daily ai limit",
  "free ai credits",
  "5-hour window"
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

  if (QUOTA_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return error.message;
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
  repo_limit:
    "You've reached the Pro limit of 3 Deep-Indexed Repos per seat. Upgrade to Enterprise for estate-wide indexing.",
  plan_required: "This feature requires an Enterprise plan.",
  code_host_plan_required:
    "Code host connections require Pro. The free plan uses local workspace files only. See https://coop-ai.dev/pricing",
  remote_code_plan_required:
    "Remote code graph requires Pro. The free plan is limited to local workspace files.",
  team_not_available:
    "The free plan is individual only — one seat per account. Upgrade to Pro to invite teammates.",
  quota_limit_reached:
    "You've used your free AI credits for this 5-hour window. Upgrade to Pro for unlimited usage at https://coop-ai.dev/pricing",
  daily_limit_reached:
    "You've used your free AI credits for this 5-hour window. Upgrade to Pro for unlimited usage at https://coop-ai.dev/pricing",
  sso_not_configured: "SSO is not configured for your organization yet. Ask your admin to finish setup.",
  sso_unavailable: "Enterprise SSO is not available on this Coop environment.",
  missing_org: "Enter your organization name to sign in with SSO.",
  "GitHub App is not configured on this server":
    "GitHub integration is not configured on the Coop server. Contact your Coop administrator.",
  github_not_configured:
    "GitHub is not configured on the Coop server. Ask your admin to add GitHub OAuth or GitHub App credentials.",
  github_not_installed:
    "GitHub is not connected for your organization. Ask your org admin to connect GitHub in the admin portal (Integrations).",
  github_auth_expired:
    "GitHub access expired. Ask your org admin to reconnect GitHub in the admin portal (Integrations → GitHub).",
  github_list_failed:
    "Could not load repositories from GitHub. Ask your org admin to reconnect GitHub in the admin portal.",
  "Teams App is not configured on this server":
    "Microsoft Teams is not configured on the Coop server. Ask your admin to add TEAMS_APP_CLIENT_ID and TEAMS_APP_CLIENT_SECRET on the API host.",
  "Slack App is not configured on this server":
    "Slack is not configured on the Coop server. Ask your admin to add SLACK_APP_CLIENT_ID and SLACK_APP_CLIENT_SECRET on the API host."
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
