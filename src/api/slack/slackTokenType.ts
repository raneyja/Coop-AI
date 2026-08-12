/** True for user access tokens (`xoxp-` / rotated `xoxe.xoxp-`). */
export function isSlackUserAccessToken(token: string): boolean {
  const t = token.trim();
  return t.startsWith("xoxp-") || t.startsWith("xoxe.xoxp-");
}

/** True for bot access tokens (`xoxb-` / rotated `xoxe.xoxb-`). */
export function isSlackBotAccessToken(token: string): boolean {
  const t = token.trim();
  return t.startsWith("xoxb-") || t.startsWith("xoxe.xoxb-");
}

/** Shown in Test Slack / Sources when the org Slack connection cannot search messages. */
export const SLACK_BOT_TOKEN_SEARCH_MESSAGE =
  "Slack search isn’t ready yet. Clear any pasted Slack token under Settings → Tools → Slack (developer fallback), then Refresh status and Test Slack. If that still fails: admin portal → Disconnect → Connect Slack.";
