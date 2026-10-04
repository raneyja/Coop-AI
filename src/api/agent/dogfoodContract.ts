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

/**
 * Plane / enterprise Monday locate — auth + work-item states in one ask.
 * Must NOT enter the API-reject ValidationError scavenger hunt.
 */
export const PLANE_LOCATE_AUTH_AND_STATE_ASK =
  "Where is API key / request authentication defined, and where do work-item states live in the backend?";

/** Calm work-item locate — “states live” is not “API rejects bad transition”. */
export const WORK_ITEM_STATE_LOCATE_ASK =
  "Where do work-item states live in the backend?";

/** Calm API-key / request-auth locate — not live secret gates or config catalogs. */
export const API_KEY_AUTH_LOCATE_ASK =
  "Where is API key / request authentication defined in this repo?";

/** Compound auth + states locate — both halves must open real server evidence. */
export const API_AUTH_AND_STATE_SERVER_LOCATE_ASK =
  "Where does the API authenticate requests with an API key, and where are issue/work-item states defined on the server?";

/** Calm create locate — ViewSet/create serializer, not reject hunt or “open the file”. */
export const API_CREATE_ISSUE_LOCATE_ASK = "Where does the API create an issue?";

/** Copilot inner-loop C2 — on-call on a repo you don't clone. Must not hunt `Users`. */
export const COPILOT_C2_ASK =
  "Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?";

/**
 * Live Extension Host ship gate for Parent reject (plane / preview / no chip).
 * Soft `COPILOT_T2_ASK` is a regression only — never a substitute for this ask.
 *
 * ## Rigorous Pass / Fail (Gate C) — all Pass rows required; any Fail row = Fail
 *
 * | Pass (must all be true) | Fail (any one = Fail) |
 * |---|---|
 * | Answer cites the Parent ValidationError (exact or near-exact quote) | Canned `API_REJECT_HUNT_MISS` / “couldn't find where the API rejects…” |
 * | Evidence path is the raise site under `serializers/…/issue.py` (or attached snippet from that file) | Only opened `utils/error_codes.py`, UI, types, or migrations |
 * | Tool activity shows a read/attach of that raise (not search-only) | 5+ searches + 0 reads of a write-reject body |
 * | Answer stops after citing the raise — no padded “backend probably…” essay | Speculative path with no attached reject |
 *
 * Automated green ≠ Pass. Do not call this fixed until Gate C live Pass.
 */
export const LIVE_PARENT_PASS_ASK =
  'In Plane issue create/update, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent isn\'t in the project. Where is that raised?';

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
