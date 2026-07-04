import type { GitHubAppApiDeps } from "./githubAppApi";
import type { OrgStore } from "./orgStore";
import { isGithubOAuthInstallation } from "./codeHostConnectors/githubOAuthConnector";
import { createEstateSyncService } from "./estateSyncService";

const INSTALL_HINT_PROVIDER = "github:install-hint";

export type GithubRelinkResult =
  | { outcome: "linked"; installationId: number; relinked: true }
  | { outcome: "none" };

export async function storeGithubInstallHint(
  deps: Pick<GitHubAppApiDeps, "orgStore">,
  orgId: string,
  installationId: number
): Promise<void> {
  if (!deps.orgStore || !Number.isFinite(installationId)) {
    return;
  }
  await deps.orgStore.storeCredential(orgId, INSTALL_HINT_PROVIDER, String(installationId));
}

export async function clearGithubInstallHint(
  deps: Pick<GitHubAppApiDeps, "orgStore">,
  orgId: string
): Promise<void> {
  await deps.orgStore?.deleteCredential(orgId, INSTALL_HINT_PROVIDER);
}

export async function readGithubInstallHint(
  deps: Pick<GitHubAppApiDeps, "orgStore">,
  orgId: string
): Promise<number | undefined> {
  const raw = await deps.orgStore?.getCredential(orgId, INSTALL_HINT_PROVIDER);
  if (!raw?.trim()) {
    return undefined;
  }
  const installationId = Number(raw.trim());
  return Number.isFinite(installationId) ? installationId : undefined;
}

export async function findOrgIdByInstallHint(
  orgStore: OrgStore | undefined,
  installationId: number
): Promise<string | undefined> {
  if (!orgStore || !Number.isFinite(installationId)) {
    return undefined;
  }
  return orgStore.findOrgIdByCredentialValue(INSTALL_HINT_PROVIDER, String(installationId));
}

export async function resolveOrgIdForGithubCallback(
  deps: GitHubAppApiDeps,
  state: string,
  installationId: number
): Promise<string | undefined> {
  const fromState = deps.githubApp?.verifyAndParseState(state);
  if (fromState) {
    return fromState;
  }
  return findOrgIdByInstallHint(deps.orgStore, installationId);
}

export async function linkGithubInstallation(
  deps: GitHubAppApiDeps,
  orgId: string,
  installationId: number
): Promise<void> {
  if (!deps.orgStore || !deps.githubApp) {
    throw new Error("GitHub App integration is not configured.");
  }
  const token = await deps.githubApp.createInstallationAccessToken(installationId);
  await deps.orgStore.upsertCodeHostInstallation(
    orgId,
    "github",
    installationId,
    token.token,
    token.expiresAt
  );
  await runCatalogSync(deps, orgId, installationId);
  await clearGithubInstallHint(deps, orgId);
}

export async function tryRelinkGithubInstallation(
  deps: GitHubAppApiDeps,
  orgId: string
): Promise<GithubRelinkResult> {
  if (!deps.orgStore || !deps.githubApp) {
    return { outcome: "none" };
  }

  const existing = await deps.orgStore.getCodeHostInstallation(orgId, "github");
  if (existing) {
    return { outcome: "none" };
  }

  const candidates = await resolveRelinkInstallationCandidates(deps, orgId);
  for (const installationId of candidates) {
    if (isGithubOAuthInstallation(orgId, installationId)) {
      continue;
    }

    let installation: { id: number } | undefined;
    try {
      installation = await deps.githubApp.getInstallation(installationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[github-relink] org=${orgId} installation=${installationId} lookup failed: ${message}`);
      continue;
    }

    if (!installation) {
      continue;
    }

    try {
      await linkGithubInstallation(deps, orgId, installationId);
      return { outcome: "linked", installationId, relinked: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[github-relink] org=${orgId} installation=${installationId} failed: ${message}`);
    }
  }

  await clearGithubInstallHint(deps, orgId);
  return { outcome: "none" };
}

async function resolveRelinkInstallationCandidates(
  deps: GitHubAppApiDeps,
  orgId: string
): Promise<number[]> {
  const ordered: number[] = [];
  const seen = new Set<number>();

  const push = (installationId: number | undefined) => {
    if (!installationId || !Number.isFinite(installationId) || seen.has(installationId)) {
      return;
    }
    seen.add(installationId);
    ordered.push(installationId);
  };

  // Prefer GitHub Organization installs (company flow) over stale personal install hints.
  for (const row of await listOrganizationInstallations(deps)) {
    push(row.id);
  }

  const hint = await readGithubInstallHint(deps, orgId);
  if (hint) {
    let installation:
      | { id: number; accountType?: string; accountLogin?: string }
      | undefined;
    try {
      installation = await deps.githubApp?.getInstallation(hint);
    } catch {
      installation = undefined;
    }
    if (installation?.accountType === "Organization") {
      push(installation.id);
    } else if (installation) {
      push(installation.id);
    }
  }

  return ordered;
}

async function listOrganizationInstallations(
  deps: GitHubAppApiDeps
): Promise<Array<{ id: number; accountLogin: string }>> {
  if (!deps.githubApp) {
    return [];
  }
  try {
    const installations = await deps.githubApp.listAppInstallations();
    return installations
      .filter((row) => row.accountType === "Organization")
      .map((row) => ({ id: row.id, accountLogin: row.accountLogin }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[github-relink] list app installations failed: ${message}`);
    return [];
  }
}

async function runCatalogSync(
  deps: GitHubAppApiDeps,
  orgId: string,
  installationId: number
): Promise<void> {
  const estateSync =
    deps.estateSync ??
    createEstateSyncService({
      orgStore: deps.orgStore,
      githubApp: deps.githubApp,
      jobQueue: deps.jobQueue
    });
  if (!estateSync) {
    return;
  }
  try {
    await estateSync.syncInstallation(orgId, installationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[github-relink] catalog sync failed for org=${orgId}: ${message}`);
  }
}
