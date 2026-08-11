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

export const SLACK_BOT_TOKEN_SEARCH_MESSAGE =
  "Slack is using a bot token. Message search needs a user token — disconnect Slack and Connect again (do not paste a bot token).";
