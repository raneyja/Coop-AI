import * as vscode from "vscode";
import type { LicenseStatus } from "../license/licenseChecker";
import { canUseLightningMode, usesOrgManagedDeepIndex } from "../license/licenseChecker";

/**
 * Internal-only flag (`coopAI.devMode`, default false).
 * When false, Lightning always uses the cloud backend and local indexing UI is hidden.
 * Enable only for local indexing experiments — not for production users.
 */
export function isCoopDevMode(): boolean {
  return vscode.workspace.getConfiguration("coopAI").get<boolean>("devMode", false);
}

export type LightningRepoConfig = {
  repoId: string;
  enabled: boolean;
  localPath?: string;
};

export type LightningConfiguration = {
  globalEnabled: boolean;
  repos: LightningRepoConfig[];
  maxDiskGb: number;
  autoIndexOnEnable: boolean;
  backend: "local" | "cloud";
};

export function readLightningBackend(): "local" | "cloud" {
  if (!isCoopDevMode()) {
    return "cloud";
  }
  const value = vscode.workspace.getConfiguration("coopAI.lightning").get<string>("backend", "cloud");
  return value === "local" ? "local" : "cloud";
}

export function readLightningConfiguration(): LightningConfiguration {
  const config = vscode.workspace.getConfiguration("coopAI.lightning");
  const repos = config.get<LightningRepoConfig[]>("repos", []);
  return {
    globalEnabled: config.get<boolean>("enabled", false),
    repos: Array.isArray(repos) ? repos : [],
    maxDiskGb: config.get<number>("maxDiskGb", 10),
    autoIndexOnEnable: config.get<boolean>("autoIndexOnEnable", true),
    backend: readLightningBackend()
  };
}

export function isLightningEnabledForRepo(
  repoId: string | undefined,
  license: LicenseStatus,
  config: LightningConfiguration = readLightningConfiguration()
): boolean {
  if (!repoId || !canUseLightningMode(license)) {
    return false;
  }
  if (usesOrgManagedDeepIndex(license.plan, config.backend)) {
    return true;
  }
  if (!config.globalEnabled) {
    return false;
  }
  const entry = config.repos.find((repo) => repo.repoId === repoId);
  return entry?.enabled === true;
}

export async function updateLightningConfiguration(
  updates: Partial<Pick<LightningConfiguration, "globalEnabled" | "repos" | "maxDiskGb" | "autoIndexOnEnable">>
): Promise<void> {
  const config = vscode.workspace.getConfiguration("coopAI.lightning");
  if (updates.globalEnabled !== undefined) {
    await config.update("enabled", updates.globalEnabled, vscode.ConfigurationTarget.Global);
  }
  if (updates.repos !== undefined) {
    await config.update("repos", updates.repos, vscode.ConfigurationTarget.Global);
  }
  if (updates.maxDiskGb !== undefined) {
    await config.update("maxDiskGb", updates.maxDiskGb, vscode.ConfigurationTarget.Global);
  }
  if (updates.autoIndexOnEnable !== undefined) {
    await config.update("autoIndexOnEnable", updates.autoIndexOnEnable, vscode.ConfigurationTarget.Global);
  }
}

export async function setRepoLightningEnabled(
  repoId: string,
  enabled: boolean,
  localPath?: string
): Promise<void> {
  const config = readLightningConfiguration();
  const existing = config.repos.find((repo) => repo.repoId === repoId);
  const repos = config.repos.filter((repo) => repo.repoId !== repoId);
  repos.push({
    repoId,
    enabled,
    localPath: localPath ?? existing?.localPath
  });
  await updateLightningConfiguration({ repos });
}
