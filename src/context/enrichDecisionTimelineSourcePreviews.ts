/**
 * Attach short AI/deterministic overviews onto a DecisionTimeline for Sources UI.
 * Never blocks Trace on failure — fail-open to deterministic excerpts.
 */
import type { DecisionTimeline } from "../types/decisionTimeline";
import { buildDeterministicEvidencePreview, shouldRequestEvidenceAiPreview } from "./evidenceBodyPreview";
import {
  summarizeEvidenceBody,
  type EvidencePreviewCompleteFn
} from "./evidencePreviewModel";

export async function enrichDecisionTimelineSourcePreviews(
  timeline: DecisionTimeline,
  complete: EvidencePreviewCompleteFn,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<DecisionTimeline> {
  const tasks: Array<Promise<void>> = [];

  const focus = timeline.focusCommit ?? timeline.originalCommit;
  if (focus?.message && shouldRequestEvidenceAiPreview(focus.message)) {
    tasks.push(
      summarizeEvidenceBody({
        kind: "commit",
        text: focus.message,
        complete,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs
      }).then((overview) => {
        focus.overview = overview;
      })
    );
  } else if (focus?.message && !focus.overview) {
    focus.overview = buildDeterministicEvidencePreview(focus.message);
  }

  if (
    timeline.originalCommit &&
    timeline.focusCommit &&
    timeline.originalCommit.sha !== timeline.focusCommit.sha &&
    shouldRequestEvidenceAiPreview(timeline.originalCommit.message)
  ) {
    const intro = timeline.originalCommit;
    tasks.push(
      summarizeEvidenceBody({
        kind: "commit",
        text: intro.message,
        complete,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs
      }).then((overview) => {
        intro.overview = overview;
      })
    );
  } else if (timeline.originalCommit?.message && !timeline.originalCommit.overview) {
    timeline.originalCommit.overview = buildDeterministicEvidencePreview(
      timeline.originalCommit.message
    );
  }

  if (timeline.linkedPR?.description && shouldRequestEvidenceAiPreview(timeline.linkedPR.description)) {
    const pr = timeline.linkedPR;
    tasks.push(
      summarizeEvidenceBody({
        kind: "pull_request",
        text: pr.description,
        title: pr.title,
        complete,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs
      }).then((overview) => {
        pr.overview = overview;
      })
    );
  } else if (timeline.linkedPR?.description && !timeline.linkedPR.overview) {
    timeline.linkedPR.overview = buildDeterministicEvidencePreview(timeline.linkedPR.description);
  }

  if (timeline.slackThread?.messages?.length) {
    const joined = timeline.slackThread.messages
      .slice(0, 12)
      .map((message) => `${message.user}: ${message.text}`)
      .join("\n");
    if (shouldRequestEvidenceAiPreview(joined)) {
      tasks.push(
        summarizeEvidenceBody({
          kind: "slack",
          text: joined,
          complete,
          signal: options?.signal,
          timeoutMs: options?.timeoutMs
        }).then((overview) => {
          if (timeline.slackThread) {
            timeline.slackThread.overview = overview;
          }
        })
      );
    } else if (!timeline.slackThread.overview) {
      timeline.slackThread.overview = buildDeterministicEvidencePreview(joined);
    }
  }

  if (timeline.teamsThread?.messages?.length) {
    const joined = timeline.teamsThread.messages
      .slice(0, 12)
      .map((message) => `${message.user}: ${message.text}`)
      .join("\n");
    if (shouldRequestEvidenceAiPreview(joined)) {
      tasks.push(
        summarizeEvidenceBody({
          kind: "teams",
          text: joined,
          complete,
          signal: options?.signal,
          timeoutMs: options?.timeoutMs
        }).then((overview) => {
          if (timeline.teamsThread) {
            timeline.teamsThread.overview = overview;
          }
        })
      );
    } else if (!timeline.teamsThread.overview) {
      timeline.teamsThread.overview = buildDeterministicEvidencePreview(joined);
    }
  }

  for (const ticket of timeline.jiraTickets ?? []) {
    if (ticket.description && shouldRequestEvidenceAiPreview(ticket.description)) {
      tasks.push(
        summarizeEvidenceBody({
          kind: "jira",
          text: ticket.description,
          title: ticket.summary,
          complete,
          signal: options?.signal,
          timeoutMs: options?.timeoutMs
        }).then((overview) => {
          ticket.overview = overview;
        })
      );
    } else if (ticket.description && !ticket.overview) {
      ticket.overview = buildDeterministicEvidencePreview(ticket.description);
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
  return timeline;
}
