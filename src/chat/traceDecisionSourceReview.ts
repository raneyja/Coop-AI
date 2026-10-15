import type { DecisionTimeline } from "../types/decisionTimeline";
import { normalizeRelativePath } from "../context/localFileContext";
import { snapshotTraceClaimEvidence } from "../context/traceDecisionClaimEvidence";
import { streamSourceReviewedEvidence } from "./sourceBackedActionReview";

/** Trace uses only frozen original history fields and current admitted code. */
export function streamSourceReviewedTraceDecision(options:
  Omit<Parameters<typeof streamSourceReviewedEvidence>[0], "facts"> & { timeline?: DecisionTimeline }
): ReturnType<typeof streamSourceReviewedEvidence> {
  const selectedFile = options.request.context.file?.trim();
  const windows = options.windows.filter(window => !selectedFile ||
    normalizeRelativePath(window.path) === normalizeRelativePath(selectedFile));
  const timeline = options.timeline && (!selectedFile ||
    normalizeRelativePath(options.timeline.file) === normalizeRelativePath(selectedFile))
    ? options.timeline : undefined;
  const snapshot = timeline
    ? snapshotTraceClaimEvidence(timeline, windows)
    : { windows: windows.map(window => ({ ...window })), facts: [] };
  return streamSourceReviewedEvidence({ ...options, ...snapshot });
}
