/** Hang ceiling for vendor HTTP (Notion, Slack, Jira, …). Not a Talk-track timer. */
export const INTEGRATION_HTTP_TIMEOUT_MS = 15_000;

/** Opened page/ticket/thread body shown to Interpret / Talk track. */
export const OPENED_ARTIFACT_BODY_CHARS = 8_000;

/** Ceiling on parallel Opens — a max, not “always Open the first three rows.” */
export const MAX_VENDOR_OPENS = 3;

export function integrationAuthFailureMessage(status: number): string | undefined {
  if (status === 401 || status === 403) {
    return "Couldn't sign in to that tool.";
  }
  return undefined;
}
