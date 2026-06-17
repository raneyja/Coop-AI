import type { OrgStore } from "../server/orgStore";
import type { JobQueue } from "../jobs/jobQueue";
import type { NormalizedWebhookEvent } from "./types";

/** @deprecated Zero-Clone manifest crawl removed — kept for webhook wiring compatibility. */
export function shouldTriggerManifestCrawl(_event: NormalizedWebhookEvent): boolean {
  return false;
}

export async function maybeEnqueueStructureManifest(
  _jobQueue: JobQueue | undefined,
  _orgStore: OrgStore | undefined,
  _event: NormalizedWebhookEvent
): Promise<void> {
  return;
}
