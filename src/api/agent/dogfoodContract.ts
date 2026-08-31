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

/** Copilot inner-loop C1 — locate with no file chip. Must not hunt `Authorization`. */
export const COPILOT_C1_ASK =
  'Where do we parse the Authorization Bearer token? Don\'t write a new helper — point me at the existing function.';

/** Copilot inner-loop C2 — on-call on a repo you don't clone. Must not hunt `Users`. */
export const COPILOT_C2_ASK =
  "Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?";

/** Same job as C2, different field — must not canned-miss or latch `issue_id`. */
export const COPILOT_T2_ASK =
  "A client sent a parent that isn’t in this project — the API returns an error. I don’t have this repo cloned. Where does the API reject a bad parent issue_id?";

/** Third-field fixture so hunt cannot overfit to parent or state. */
export const COPILOT_ASSIGNEE_REJECT_ASK =
  "A client sent an assignee that isn’t on the team — the API returns an error. Where does the API reject a bad assignee_id?";

/** Copilot inner-loop C4 — PR review of the open function, not A8 status playbook. */
export const COPILOT_C4_ASK =
  "Review requireAuth as if this were a PR touching production auth. What would you block, what's fine, and what would you ask the author? Stay specific to this code.";
export const COPILOT_C5_ASK =
  'Add two tests to src/server/authMiddleware.test.ts for extractBearerToken: (1) missing Authorization header returns undefined, (2) "Bearer abc" returns abc. Match this file\'s node:test style. Do not rewrite the existing suite.';
