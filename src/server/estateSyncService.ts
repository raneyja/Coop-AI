import type { JobQueue } from "../jobs/jobQueue";
import type { GitHubAppService } from "./githubAppService";
import type { OrgStore } from "./orgStore";
import { queueOrgRepoIndex } from "./queueOrgRepoIndex";

export type EstateSyncResult = {
  discovered: number;
  queued: number;
  skipped: number;
};

export class EstateSyncService {
  public constructor(
    private readonly orgStore: OrgStore,
    private readonly githubApp: GitHubAppService,
    private readonly jobQueue: JobQueue
  ) {}

  public async syncInstallation(
    orgId: string,
    installationId: number,
    options?: { force?: boolean }
  ): Promise<EstateSyncResult> {
    const org = await this.orgStore.getOrganization(orgId);
    if (!org || (org.plan !== "enterprise" && org.plan !== "pro")) {
      return { discovered: 0, queued: 0, skipped: 0 };
    }

    const repoIds = await this.githubApp.listInstallationRepositories(installationId);
    let queued = 0;
    let skipped = 0;

    for (const repoId of repoIds) {
      const existing = await this.orgStore.getOrgRepo(orgId, repoId);
      if (
        !options?.force &&
        existing?.lightningEnabled &&
        (existing.indexStatus === "indexing" || existing.indexStatus === "queued")
      ) {
        skipped += 1;
        continue;
      }

      const queueResult = await queueOrgRepoIndex(orgId, repoId, {
        orgStore: this.orgStore,
        jobQueue: this.jobQueue,
        bypassRateLimit: true
      });
      if (queueResult.outcome === "skipped") {
        skipped += 1;
        continue;
      }
      if (queueResult.outcome === "failed") {
        console.error(`[estate-sync] failed to queue ${repoId}: ${queueResult.message}`);
        skipped += 1;
        continue;
      }

      queued += 1;
    }

    console.log(
      `[estate-sync] org=${orgId} installation=${installationId} discovered=${repoIds.length} queued=${queued} skipped=${skipped}`
    );

    return { discovered: repoIds.length, queued, skipped };
  }
}

export function createEstateSyncService(deps: {
  orgStore?: OrgStore;
  githubApp?: GitHubAppService;
  jobQueue?: JobQueue;
}): EstateSyncService | undefined {
  if (!deps.orgStore || !deps.githubApp || !deps.jobQueue) {
    return undefined;
  }
  return new EstateSyncService(deps.orgStore, deps.githubApp, deps.jobQueue);
}
