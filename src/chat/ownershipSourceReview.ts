import type { OwnershipReport } from "../types/ownership";
import type { SlackSearchEvidence } from "../context/contextBundleEvidence";
import { snapshotOwnershipClaimEvidence } from "../context/ownershipClaimEvidence";
import { streamSourceReviewedEvidence } from "./sourceBackedActionReview";

/** One frozen typed ownership sample and admitted remote source windows feed
 * synthesis, private claim review and the exact final publication body. */
export function streamSourceReviewedOwnership(options:
  Omit<Parameters<typeof streamSourceReviewedEvidence>[0], "facts"> & {
    report?: OwnershipReport; slackSearch?: SlackSearchEvidence;
  }
): ReturnType<typeof streamSourceReviewedEvidence> {
  return streamSourceReviewedEvidence({ ...options,
    ...snapshotOwnershipClaimEvidence(options.report, options.windows, options.request.context, options.slackSearch) });
}
