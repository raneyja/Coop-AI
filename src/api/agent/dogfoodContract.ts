/**
 * Test fixture — the exact hunt Jon runs in the Extension Host.
 * Shared by honesty gates, hunt ranking, and routing tests so docs and tests
 * cannot drift to a friendlier question. Not imported by product code, and
 * deliberately free of any one repository's folder names.
 */
export const DOGFOOD_HUNT_QUESTION =
  "Where is requireAuth or authentication middleware defined in this repo?";

/** An exact symbol the user named beats a prose phrase as an index query. */
export const DOGFOOD_HUNT_SEARCH_QUERY = "requireAuth";
