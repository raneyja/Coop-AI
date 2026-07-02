import type { JobQueue } from "../jobs/jobQueue";
import type { GitHubAppService } from "./githubAppService";
import type { OrgStore } from "./orgStore";
import { registerDiscoveredRepos } from "./catalogSyncService";

export type EstateSyncResult = {
  discovered: number;
  queued: number;
  skipped: number;
};

export class EstateSyncService {
  public constructor(
    private readonly orgStore: OrgStore,
    private readonly githubApp: GitHubAppService,
    private readonly _jobQueue: JobQueue
  ) {}

  public async syncInstallation(
    orgId: string,
    installationId: number,
    _options?: { force?: boolean }
  ): Promise<EstateSyncResult> {
    const org = await this.orgStore.getOrganization(orgId);
    if (!org || (org.plan !== "enterprise" && org.plan !== "pro" && org.plan !== "free")) {
      return { discovered: 0, queued: 0, skipped: 0 };
    }

    const repoIds = await this.githubApp.listInstallationRepositories(installationId);
    const result = await registerDiscoveredRepos(orgId, repoIds, { orgStore: this.orgStore });
    console.log(
      `[estate-sync] org=${orgId} installation=${installationId} discovered=${result.discovered} registered=${result.queued} skipped=${result.skipped}`
    );
    return result;
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
