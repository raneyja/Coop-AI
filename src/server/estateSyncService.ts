import type { JobQueue } from "../jobs/jobQueue";
import type { GitHubAppService } from "./githubAppService";
import type { OrgStore } from "./orgStore";
import { queueOrgRepoIndex } from "./queueOrgRepoIndex";
import { autoIndexOnCatalogSync, countLightningEnabledRepos, indexedRepoLimitForPlan } from "./indexedRepoQuota";

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
    if (!org || (org.plan !== "enterprise" && org.plan !== "pro" && org.plan !== "free")) {
      return { discovered: 0, queued: 0, skipped: 0 };
    }

    const repoIds = await this.githubApp.listInstallationRepositories(installationId);
    const autoIndex = autoIndexOnCatalogSync(org.plan);

    if (!autoIndex) {
      let registered = 0;
      let skipped = 0;
      for (const repoId of repoIds) {
        const existing = await this.orgStore.getOrgRepo(orgId, repoId);
        if (!existing) {
          await this.orgStore.upsertOrgRepo(orgId, repoId, {
            lightningEnabled: false,
            indexStatus: "idle"
          });
          registered += 1;
        } else {
          skipped += 1;
        }
      }
      console.log(
        `[estate-sync] org=${orgId} installation=${installationId} discovered=${repoIds.length} registered=${registered} skipped=${skipped} (catalog only)`
      );
      return { discovered: repoIds.length, queued: 0, skipped };
    }

    const repoLimit = indexedRepoLimitForPlan(org.plan);
    let enabledCount = repoLimit !== null ? await countLightningEnabledRepos(this.orgStore, orgId) : 0;
    let queued = 0;
    let skipped = 0;

    for (const repoId of repoIds) {
      const existing = await this.orgStore.getOrgRepo(orgId, repoId);
      const wouldEnableNew = !existing?.lightningEnabled;

      if (repoLimit !== null && !existing) {
        await this.orgStore.upsertOrgRepo(orgId, repoId, {
          lightningEnabled: false,
          indexStatus: "idle"
        });
      }

      if (repoLimit !== null && wouldEnableNew && enabledCount >= repoLimit) {
        skipped += 1;
        continue;
      }

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

      if (wouldEnableNew && repoLimit !== null) {
        enabledCount += 1;
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
