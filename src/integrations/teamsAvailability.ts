/**
 * Teams is not offered in the product yet (Microsoft auth is unreliable).
 * Keep clients, OAuth, and scope. Flip this and `comingSoon` on the Teams
 * entry in `admin/src/lib/integrations.ts` to turn Teams back on.
 */
export const TEAMS_COMING_SOON = true;

export function isTeamsComingSoon(): boolean {
  return TEAMS_COMING_SOON;
}

/** Slash and settings copy. Do not tell the user to Connect. */
export const TEAMS_UNAVAILABLE_MESSAGE = "Teams isn't available yet.";

export function omitTeamsWhileComingSoon<T extends string>(tools: readonly T[]): T[] {
  if (!TEAMS_COMING_SOON) {
    return [...tools];
  }
  return tools.filter((tool) => tool !== "teams");
}
