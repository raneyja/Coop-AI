import type { ResponseTimingEvent } from "./chatResponseTiming";
import { validDisplayElapsed } from "./chatResponseTiming";
import { MAX_USER_FACING_RESPONSE_MS } from "../config/responseDeadline";

export type QualityVerdict = "pass" | "fail" | "not-reviewed";
/** Categorical reviewer findings. Citation-byte checks do not set any semantic
 * verdict. No metric is a useful-answer success until all relevant checks pass. */
export type ResponseQualityReview = {
  sourceRef: QualityVerdict;
  citationIntegrity: QualityVerdict;
  supportedClaims: QualityVerdict;
  truthfulUnknowns: QualityVerdict;
  requestedTask: QualityVerdict;
  firstVisibleContentUseful: QualityVerdict;
};

export function summarizeResponseMeasurement(events: readonly ResponseTimingEvent[], quality: ResponseQualityReview) {
  const identity = events[0]?.traceId;
  if (!identity || events.length > 96 || events.some(e => e.traceId !== identity)) throw new Error("Invalid bounded response trace");
  const terminal = events.find(event => event.event === "turn-end");
  const display = (milestone: string) => {
    const event = events.find(item => item.event === "display" && item.milestone === milestone && item.clock === "webview-monotonic");
    return validDisplayElapsed(event?.clientElapsedMs) ? event.clientElapsedMs : null;
  };
  const firstVisibleAnswerContentMs = display("first-answer-content");
  const displayCompletionMs = display("complete");
  const passed = Object.values(quality).every(verdict => verdict === "pass");
  const firstUsefulSupportedAnswerMs = terminal?.outcome === "completed" && passed ? firstVisibleAnswerContentMs : null;
  return {
    traceId: identity,
    outcome: terminal?.outcome ?? "incomplete",
    repaired: terminal?.repaired ?? false,
    hostCompletionMs: terminal?.elapsedMs ?? null,
    firstVisibleAnswerContentMs,
    displayCompletionMs,
    firstUsefulSupportedAnswerMs,
    usefulAnswerTarget: firstUsefulSupportedAnswerMs === null ? "unqualified" : firstUsefulSupportedAnswerMs <= MAX_USER_FACING_RESPONSE_MS ? "within-guideline" : "over-guideline",
    quality,
    // Inclusive work intervals can overlap (parallel retrieval, preparation and
    // planner AI). They must never be summed as a wall-time decomposition.
    phaseIntervals: events.filter(e => e.event === "phase-end").map(e => ({ phase: e.phase,
      callId: e.callId, durationMs: e.durationMs, endedAtHostMs: e.elapsedMs, outcome: e.outcome })),
    backendCalls: events.filter(e => e.event === "backend").map(e => ({ callId: e.callId,
      requestId: e.requestId, event: e.backendEvent, backendElapsedMs: e.backendElapsedMs }))
  };
}
