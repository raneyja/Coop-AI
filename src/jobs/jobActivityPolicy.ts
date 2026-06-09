export type JobActivityDeliverable = "chat" | "standalone";

export type JobActivityStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "partial";

export type JobActivityState = {
  status: JobActivityStatus;
  deliverable?: JobActivityDeliverable;
  showViewResults?: boolean;
};

/** Quick actions that enqueue a background job then synthesize a chat answer. */
export const CHAT_DELIVERABLE_QUICK_ACTIONS = new Set(["knowledge-gaps", "blast-radius"]);

export function deliverableForQuickAction(actionId: string): JobActivityDeliverable {
  return CHAT_DELIVERABLE_QUICK_ACTIONS.has(actionId) ? "chat" : "standalone";
}

export function isActiveJobStatus(status: JobActivityStatus): boolean {
  return status === "queued" || status === "running";
}

/** Activity strip shows in-progress jobs; terminal rows only for standalone deliverables. */
export function shouldShowJobActivityLine(job: JobActivityState): boolean {
  if (isActiveJobStatus(job.status)) {
    return true;
  }
  if (job.deliverable === "standalone") {
    return (
      job.status === "completed" ||
      job.status === "partial" ||
      job.status === "failed" ||
      job.status === "cancelled"
    );
  }
  return false;
}

/** Raw JSON job output is a dev-only tool — never for chat-deliverable actions. */
export function shouldShowViewResultsButton(job: JobActivityState): boolean {
  if (!job.showViewResults || job.deliverable === "chat") {
    return false;
  }
  return job.status === "completed" || job.status === "partial";
}

export function shouldClearJobActivityOnChatComplete(deliverable?: JobActivityDeliverable): boolean {
  return deliverable !== "standalone";
}

/** Map terminal backend statuses to in-progress UI while chat synthesis runs. */
export function displayStatusForChatDeliverable(status: JobActivityStatus): JobActivityStatus {
  return isActiveJobStatus(status) ? status : "running";
}
