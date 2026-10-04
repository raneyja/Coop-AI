/**
 * Frozen live-shaped reject-hunt fixtures.
 * Hit content must appear in `planeIssueSerializer.validate.py` when used for jump tests.
 * Do not invent class names absent from that body.
 */
import * as fs from "fs";
import * as path from "path";
import { COPILOT_T2_ASK, LIVE_PARENT_PASS_ASK } from "../dogfoodContract";

export { COPILOT_T2_ASK, LIVE_PARENT_PASS_ASK };

/** Exact quoted Parent ask — same string as LIVE_PARENT_PASS_ASK. */
export const EXACT_PARENT_REJECT_ASK = LIVE_PARENT_PASS_ASK;

/** Live Zoekt fragment shape: quoted message only, no raise / ValidationError. */
export const ZOEKT_PARENT_MESSAGE_ONLY =
  '"Parent is not valid issue_id please pass a valid issue_id"';

/** Bare message line (no surrounding quotes in the hit). */
export const ZOEKT_PARENT_BARE =
  "Parent is not valid issue_id please pass a valid issue_id";

/** Control — full raise line (must still Pass). */
export const ZOEKT_PARENT_FULL_RAISE =
  'raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")';

/** Sibling field — must not attach on Parent asks. */
export const ZOEKT_STATE_MESSAGE_ONLY =
  '"State is not valid please pass a valid state_id"';

export const PLANE_ISSUE_SERIALIZER_PATH =
  "apps/api/plane/app/serializers/issue.py";

/** Wrong-floor open target that actually exists in the fixture body. */
export const WRONG_FLOOR_HIT_CONTENT = "class IssueCreateSerializer";

let cachedBody: string | undefined;

/** Canonical body for wrong-floor / jump — always the frozen fixture. */
export function loadPlaneIssueSerializerValidateBody(): string {
  if (cachedBody !== undefined) {
    return cachedBody;
  }
  cachedBody = fs.readFileSync(
    path.join(__dirname, "planeIssueSerializer.validate.py"),
    "utf8"
  );
  return cachedBody;
}

/** Assert hit content is a substring of the fixture body (fidelity guard). */
export function assertHitAppearsInFixtureBody(hitContent: string): void {
  const body = loadPlaneIssueSerializerValidateBody();
  if (!body.includes(hitContent.replace(/^["']|["']$/g, "")) && !body.includes(hitContent)) {
    // Message-only / bare lines appear inside the raise in the fixture.
    const needle = hitContent.replace(/^["']|["']$/g, "");
    if (!body.includes(needle)) {
      throw new Error(
        `rejectHuntLiveShapes: hit content not found in planeIssueSerializer.validate.py: ${hitContent.slice(0, 80)}`
      );
    }
  }
}
