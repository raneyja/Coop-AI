import * as vscode from "vscode";
import type { IndexBackend } from "../indexing/indexBackend";
import { isCoopDevMode, readLightningConfiguration } from "../config/lightningConfig";
import type { LightningModeState, LightningRepoState } from "../indexing/lightningTypes";
import { canUseLightningMode, resolveLicenseStatus } from "../license/licenseChecker";

export class LightningStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private currentRepoId?: string;

  public constructor(
    private readonly indexBackend: IndexBackend,
    private readonly getApiBaseUrl: () => string,
    private readonly secrets: vscode.SecretStorage
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.command = "coopAI.openLightningMode";
    this.item.tooltip = "CoopAI indexing mode";
    this.refresh();
  }

  public setCurrentRepo(repoId?: string): void {
    this.currentRepoId = repoId;
    this.refresh();
  }

  public async refresh(): Promise<void> {
    const state = await this.buildState();
    const showLocalIndexing = isCoopDevMode() && this.indexBackend.kind === "local";
    if (!state.canUseLightning) {
      this.item.text = "$(cloud) CoopAI: Zero-Clone";
      this.item.tooltip =
        "Zero-Clone: remote graph from code hosts; connect Slack, Jira, Notion, and more in Settings. Pro adds Lightning Mode.";
    } else if (!state.globalEnabled) {
      this.item.text = "$(cloud) CoopAI: Zero-Clone";
      this.item.tooltip = showLocalIndexing
        ? "Remote code graph. Click to enable Lightning (local graph index)."
        : "Remote code graph. Click to enable Lightning (Coop cloud index).";
    } else if (state.indexingRepos > 0) {
      this.item.text = "$(zap) CoopAI: Lightning · indexing";
      this.item.tooltip = showLocalIndexing
        ? "Building local code graph index…"
        : "Building cloud code graph index…";
    } else {
      this.item.text = `$(zap) CoopAI: Lightning · ${state.readyRepos} ready`;
      this.item.tooltip = showLocalIndexing
        ? "Local code graph index ready. Click to manage."
        : "Coop cloud index ready. Click to manage.";
    }
    this.item.show();
  }

  public async buildState(): Promise<LightningModeState> {
    const license = await resolveLicenseStatus(this.secrets, this.getApiBaseUrl());
    const config = readLightningConfiguration();
    const summary = await this.indexBackend.summarize(config);
    const statuses = await this.indexBackend.listRepoStatuses(config);
    const repoConfigs = new Map(config.repos.map((repo) => [repo.repoId, repo]));

    const repos: LightningRepoState[] = statuses.map((status) => {
      const [owner, name] = parseRepoId(status.repoId);
      return {
        repoId: status.repoId,
        owner,
        repo: name,
        enabled: repoConfigs.get(status.repoId)?.enabled ?? status.enabled,
        status: status.status === "queued" ? "indexing" : status.status,
        localPath: status.localPath,
        lastIndexedAt: status.lastIndexedAt,
        diskUsageBytes: status.diskUsageBytes,
        zoektAvailable: status.zoektAvailable,
        scipAvailable: status.scipAvailable,
        error: status.error
      };
    });

    for (const repo of config.repos) {
      if (repos.some((entry) => entry.repoId === repo.repoId)) {
        continue;
      }
      const [owner, name] = parseRepoId(repo.repoId);
      repos.push({
        repoId: repo.repoId,
        owner,
        repo: name,
        enabled: repo.enabled,
        status: repo.enabled ? "idle" : "disabled",
        localPath: repo.localPath
      });
    }

    if (this.currentRepoId && !repos.some((entry) => entry.repoId === this.currentRepoId)) {
      const [owner, name] = parseRepoId(this.currentRepoId);
      repos.unshift({
        repoId: this.currentRepoId,
        owner,
        repo: name,
        enabled: false,
        status: "disabled"
      });
    }

    return {
      plan: license.plan,
      canUseLightning: canUseLightningMode(license),
      globalEnabled: config.globalEnabled,
      maxDiskGb: config.maxDiskGb,
      totalDiskBytes: summary.totalDiskBytes,
      enabledRepos: summary.enabledRepos,
      readyRepos: summary.readyRepos,
      indexingRepos: summary.indexingRepos,
      repos,
      currentRepoId: this.currentRepoId,
      backend: config.backend
    };
  }

  public dispose(): void {
    this.item.dispose();
  }
}

function parseRepoId(repoId: string): [string, string] {
  const slash = repoId.includes(":") ? repoId.split(":")[1] : repoId;
  const parts = (slash ?? repoId).split("/");
  return [parts[0] ?? "unknown", parts[1] ?? "repo"];
}
