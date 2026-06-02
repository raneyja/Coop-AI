import { getDbPool } from "../server/db";
import type { OrgStore } from "../server/orgStore";
import { listOrgIdsForRepo } from "../jobs/buildStructureManifest";
import type { JobQueue } from "../jobs/jobQueue";
import { JobType } from "../jobs/types";
import type { NormalizedWebhookEvent } from "./types";

export function shouldTriggerManifestCrawl(event: NormalizedWebhookEvent): boolean {
  if (event.provider === "slack") {
    return false;
  }
  if (event.eventType === "repository") {
    const action = event.repositoryAction ?? "";
    return action === "created" || action === "publicized";
  }
  return false;
}

export async function maybeEnqueueStructureManifest(
  jobQueue: JobQueue | undefined,
  orgStore: OrgStore | undefined,
  event: NormalizedWebhookEvent
): Promise<void> {
  if (!jobQueue || !orgStore || !shouldTriggerManifestCrawl(event)) {
    return;
  }
  if (event.provider === "slack") {
    return;
  }

  const repoId = event.repository.repoId;
  const pool = await getDbPool();
  if (!pool) {
    console.warn(`[manifest] DATABASE_URL not configured; skipping manifest crawl for ${repoId}`);
    return;
  }

  const orgIds = await listOrgIdsForRepo(pool, repoId);
  if (orgIds.length === 0) {
    console.warn(
      `[manifest] no org_repos row for repoId=${repoId}; skipping structure manifest job`
    );
    return;
  }

  for (const orgId of orgIds) {
    try {
      const submit = await jobQueue.createJob({
        type: JobType.BUILD_STRUCTURE_MANIFEST,
        priority: "high",
        userId: `manifest:${orgId}:${repoId}`,
        params: { repoId, orgId }
      });
      console.log(
        `[manifest] enqueued build_structure_manifest for orgId=${orgId} repoId=${repoId} jobId=${submit.jobId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[manifest] failed to enqueue build_structure_manifest for orgId=${orgId} repoId=${repoId}: ${message}`
      );
    }
  }
}
