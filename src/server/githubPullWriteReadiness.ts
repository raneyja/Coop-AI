import { codeHostRequest } from "../api/codeHosts/codeHostHttp";
import {
  GITHUB_NOT_CONNECTED_MESSAGE,
  GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
  githubAppNotInstalledOnAccountMessage,
  githubInstallationAcceptMessage,
  githubRepoNotInInstallationMessage,
  githubTokenHasWriteScopes
} from "../api/codeHosts/pullRequestWrite";
import { CodeHostError } from "../api/codeHosts/types";
import { isGithubOAuthInstallation } from "./codeHostConnectors/githubOAuthConnector";
import type { GitHubAppService } from "./githubAppService";
import type { OrgStore } from "./orgStore";

const GITHUB_API = "https://api.github.com";

export type GithubPullWriteReason =
  | "ready"
  | "not_connected"
  | "app_permissions_not_accepted"
  | "oauth_token_cannot_write"
  | "repo_not_in_installation";

export type GithubTokenKind = "github_app" | "oauth" | "pat" | "none";

export type GithubPullWriteReadiness = {
  ok: boolean;
  reason: GithubPullWriteReason;
  /** Distinct per reason so a screenshot alone identifies the cause. */
  message: string;
  tokenKind: GithubTokenKind;
  installationId?: number;
  /** The account that owns the installation Coop is using. */
  accountLogin?: string;
  /** Exact page where the pending permission request must be approved. */
  installationUrl?: string;
  grantedPermissions?: Record<string, string>;
  /** Set when Coop switched to a different installation of the same App that does have write. */
  switchedFromInstallationId?: number;
  /** GitHub's own wording, when GitHub gave one. */
  githubDetail?: string;
};

export type GithubPullWriteInspection = GithubPullWriteReadiness & {
  /** Present only when ok — never returned over HTTP. */
  token?: string;
};

export type InspectGithubPullWriteOptions = {
  orgId: string;
  owner: string;
  repo: string;
  orgStore: Pick<OrgStore, "getCodeHostInstallation" | "getInstallationToken" | "upsertCodeHostInstallation" | "getCredential">;
  githubApp?: Pick<
    GitHubAppService,
    "tryCreatePullWriteAccessToken" | "getInstallation" | "getRepositoryInstallation" | "listAppInstallations"
  >;
  allowPatFallback?: boolean;
};

/**
 * Single source of truth for "can Coop open a PR on this GitHub repo right now".
 * Used by Create PR and by the pull-write-check diagnostic so both agree.
 */
export async function inspectGithubPullWrite(
  options: InspectGithubPullWriteOptions
): Promise<GithubPullWriteInspection> {
  const installation = await options.orgStore.getCodeHostInstallation(options.orgId, "github");
  const isApp =
    installation != null &&
    options.githubApp != null &&
    !isGithubOAuthInstallation(options.orgId, installation.installationId);

  if (isApp && installation) {
    return inspectAppInstallation(options, installation.installationId);
  }

  const token = installation
    ? await options.orgStore.getInstallationToken(options.orgId, "github")
    : options.allowPatFallback
      ? await options.orgStore.getCredential(options.orgId, "github")
      : undefined;
  if (!token) {
    return {
      ok: false,
      reason: "not_connected",
      message: GITHUB_NOT_CONNECTED_MESSAGE,
      tokenKind: "none"
    };
  }

  const tokenKind: GithubTokenKind = installation ? "oauth" : "pat";
  const probe = await probeRepository(options.owner, options.repo, token);
  if (probe.status === "denied") {
    return {
      ok: false,
      reason: "oauth_token_cannot_write",
      message: GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
      tokenKind,
      githubDetail: probe.githubDetail
    };
  }
  if (probe.status === "missing") {
    return {
      ok: false,
      reason: "repo_not_in_installation",
      message: githubRepoNotInInstallationMessage(options.owner, options.repo),
      tokenKind,
      githubDetail: probe.githubDetail
    };
  }
  if (githubTokenHasWriteScopes(probe.oauthScopes) === false) {
    return {
      ok: false,
      reason: "oauth_token_cannot_write",
      message: GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
      tokenKind,
      githubDetail: probe.oauthScopes ? `Token scopes: ${probe.oauthScopes}.` : undefined
    };
  }
  return { ok: true, reason: "ready", message: "GitHub can create pull requests.", tokenKind, token };
}

async function inspectAppInstallation(
  options: InspectGithubPullWriteOptions,
  storedInstallationId: number
): Promise<GithubPullWriteInspection> {
  const covering = await lookupRepositoryInstallation(options);
  if (covering.status === "found") {
    return finishCoveringInstallation(options, storedInstallationId, covering.installation);
  }
  if (covering.status === "missing") {
    return missingRepoInstallation(options, storedInstallationId);
  }

  const storedAttempt = await options.githubApp!.tryCreatePullWriteAccessToken(storedInstallationId);
  if (storedAttempt.ok) {
    const stored = await finishAppInstallation(options, storedInstallationId, storedAttempt, {
      persist: true
    });
    if (stored.ok) {
      return stored;
    }
  }

  const alternate = await findWritableInstallation(options, storedInstallationId);
  if (alternate?.ok) {
    return { ...alternate, switchedFromInstallationId: storedInstallationId };
  }
  if (alternate && !alternate.ok) {
    return alternate;
  }

  const identity = await describeInstallation(options, storedInstallationId);
  if (!storedAttempt.ok) {
    return {
      ok: false,
      reason: "app_permissions_not_accepted",
      message: githubInstallationAcceptMessage({
        accountLogin: identity?.accountLogin,
        installationId: storedInstallationId,
        installationUrl: identity?.htmlUrl
      }),
      tokenKind: "github_app",
      installationId: storedInstallationId,
      accountLogin: identity?.accountLogin,
      installationUrl: identity?.htmlUrl,
      grantedPermissions: storedAttempt.permissions ?? identity?.permissions,
      githubDetail: storedAttempt.githubMessage
    };
  }

  return {
    ok: false,
    reason: "repo_not_in_installation",
    message: githubRepoNotInInstallationMessage(options.owner, options.repo),
    tokenKind: "github_app",
    installationId: storedInstallationId,
    accountLogin: identity?.accountLogin,
    installationUrl: identity?.htmlUrl,
    grantedPermissions: storedAttempt.permissions,
    githubDetail: undefined
  };
}

async function finishCoveringInstallation(
  options: InspectGithubPullWriteOptions,
  storedInstallationId: number,
  covering: {
    id: number;
    htmlUrl?: string;
    accountLogin?: string;
    permissions?: Record<string, string>;
  }
): Promise<GithubPullWriteInspection> {
  const attempt = await options.githubApp!.tryCreatePullWriteAccessToken(covering.id);
  if (!attempt.ok) {
    return {
      ok: false,
      reason: "app_permissions_not_accepted",
      message: githubInstallationAcceptMessage({
        accountLogin: covering.accountLogin,
        installationId: covering.id,
        installationUrl: covering.htmlUrl
      }),
      tokenKind: "github_app",
      installationId: covering.id,
      accountLogin: covering.accountLogin,
      installationUrl: covering.htmlUrl,
      grantedPermissions: attempt.permissions ?? covering.permissions,
      githubDetail: attempt.githubMessage
    };
  }
  const persist = covering.id === storedInstallationId;
  const finished = await finishAppInstallation(options, covering.id, attempt, { persist });
  if (finished.ok && !persist) {
    return { ...finished, switchedFromInstallationId: storedInstallationId };
  }
  return finished;
}

async function missingRepoInstallation(
  options: InspectGithubPullWriteOptions,
  storedInstallationId: number
): Promise<GithubPullWriteInspection> {
  const identity = await describeInstallation(options, storedInstallationId);
  let ownerInstall: { id: number; accountLogin: string } | undefined;
  try {
    const installations = (await options.githubApp?.listAppInstallations()) ?? [];
    const ownerLc = options.owner.toLowerCase();
    ownerInstall = installations.find((row) => row.accountLogin.toLowerCase() === ownerLc);
  } catch {
    ownerInstall = undefined;
  }
  const message = ownerInstall
    ? githubRepoNotInInstallationMessage(options.owner, options.repo)
    : githubAppNotInstalledOnAccountMessage(options.owner, options.repo);
  return {
    ok: false,
    reason: "repo_not_in_installation",
    message,
    tokenKind: "github_app",
    installationId: ownerInstall?.id ?? storedInstallationId,
    accountLogin: ownerInstall?.accountLogin ?? identity?.accountLogin,
    installationUrl: identity?.htmlUrl,
    githubDetail: undefined
  };
}

type RepositoryInstallationLookup =
  | {
      status: "found";
      installation: {
        id: number;
        htmlUrl?: string;
        accountLogin?: string;
        accountType?: string;
        permissions?: Record<string, string>;
      };
    }
  | { status: "missing" }
  | { status: "unknown" };

async function lookupRepositoryInstallation(
  options: InspectGithubPullWriteOptions
): Promise<RepositoryInstallationLookup> {
  if (!options.githubApp?.getRepositoryInstallation) {
    return { status: "unknown" };
  }
  try {
    const installation = await options.githubApp.getRepositoryInstallation(options.owner, options.repo);
    return installation ? { status: "found", installation } : { status: "missing" };
  } catch {
    return { status: "unknown" };
  }
}

async function finishAppInstallation(
  options: InspectGithubPullWriteOptions,
  installationId: number,
  attempt: { ok: true; token: string; expiresAt: Date; permissions?: Record<string, string> },
  persist: { persist: boolean }
): Promise<GithubPullWriteInspection> {
  const covering = await lookupRepositoryInstallation(options);
  if (covering.status === "found" && covering.installation.id !== installationId) {
    const identity = await describeInstallation(options, installationId);
    return {
      ok: false,
      reason: "repo_not_in_installation",
      message: githubRepoNotInInstallationMessage(options.owner, options.repo),
      tokenKind: "github_app",
      installationId,
      accountLogin: identity?.accountLogin,
      installationUrl: identity?.htmlUrl,
      grantedPermissions: attempt.permissions
    };
  }
  if (covering.status === "missing") {
    const identity = await describeInstallation(options, installationId);
    return {
      ok: false,
      reason: "repo_not_in_installation",
      message: githubRepoNotInInstallationMessage(options.owner, options.repo),
      tokenKind: "github_app",
      installationId,
      accountLogin: identity?.accountLogin,
      installationUrl: identity?.htmlUrl,
      grantedPermissions: attempt.permissions
    };
  }
  if (covering.status === "unknown") {
    const probe = await probeRepository(options.owner, options.repo, attempt.token);
    if (probe.status !== "ok") {
      const identity = await describeInstallation(options, installationId);
      return {
        ok: false,
        reason: "repo_not_in_installation",
        message: githubRepoNotInInstallationMessage(options.owner, options.repo),
        tokenKind: "github_app",
        installationId,
        accountLogin: identity?.accountLogin,
        installationUrl: identity?.htmlUrl,
        grantedPermissions: attempt.permissions,
        githubDetail: probe.githubDetail
      };
    }
  }

  if (persist.persist) {
    await options.orgStore.upsertCodeHostInstallation(
      options.orgId,
      "github",
      installationId,
      attempt.token,
      attempt.expiresAt
    );
  }

  const identity = await describeInstallation(options, installationId);
  return {
    ok: true,
    reason: "ready",
    message: "GitHub can create pull requests.",
    tokenKind: "github_app",
    installationId,
    accountLogin: identity?.accountLogin,
    installationUrl: identity?.htmlUrl,
    grantedPermissions: attempt.permissions,
    token: attempt.token
  };
}

/**
 * Use an installation that can write this repo. Prefer the GitHub account that
 * owns the repo so a company install is not used for a personal repo.
 * Never overwrite the org's stored installation with a different one.
 */
async function findWritableInstallation(
  options: InspectGithubPullWriteOptions,
  skipInstallationId: number
): Promise<GithubPullWriteInspection | undefined> {
  const app = options.githubApp;
  if (!app?.listAppInstallations) {
    return undefined;
  }
  let installations: Array<{ id: number; accountLogin: string; accountType: string }>;
  try {
    installations = await app.listAppInstallations();
  } catch {
    return undefined;
  }

  const ownerLc = options.owner.toLowerCase();
  const ranked = installations
    .filter((row) => row.id !== skipInstallationId)
    .sort((a, b) => {
      const aMatch = a.accountLogin.toLowerCase() === ownerLc ? 0 : 1;
      const bMatch = b.accountLogin.toLowerCase() === ownerLc ? 0 : 1;
      return aMatch - bMatch;
    });

  let ownerRefusal: GithubPullWriteInspection | undefined;
  for (const candidate of ranked) {
    let attempt: Awaited<ReturnType<typeof app.tryCreatePullWriteAccessToken>>;
    try {
      attempt = await app.tryCreatePullWriteAccessToken(candidate.id);
    } catch {
      continue;
    }
    if (!attempt.ok) {
      if (candidate.accountLogin.toLowerCase() === ownerLc && !ownerRefusal) {
        const identity = await describeInstallation(options, candidate.id);
        ownerRefusal = {
          ok: false,
          reason: "app_permissions_not_accepted",
          message: githubInstallationAcceptMessage({
            accountLogin: identity?.accountLogin ?? candidate.accountLogin,
            installationId: candidate.id,
            installationUrl: identity?.htmlUrl
          }),
          tokenKind: "github_app",
          installationId: candidate.id,
          accountLogin: identity?.accountLogin ?? candidate.accountLogin,
          installationUrl: identity?.htmlUrl,
          grantedPermissions: attempt.permissions ?? identity?.permissions,
          githubDetail: attempt.githubMessage
        };
      }
      continue;
    }
    const resolved = await finishAppInstallation(options, candidate.id, attempt, { persist: false });
    if (resolved.ok) {
      return resolved;
    }
  }
  return ownerRefusal;
}

async function describeInstallation(
  options: InspectGithubPullWriteOptions,
  installationId: number
): Promise<
  { accountLogin?: string; htmlUrl?: string; permissions?: Record<string, string> } | undefined
> {
  if (!options.githubApp?.getInstallation) {
    return undefined;
  }
  try {
    const installation = await options.githubApp.getInstallation(installationId);
    if (!installation) {
      return undefined;
    }
    return {
      accountLogin: installation.accountLogin,
      htmlUrl: installation.htmlUrl,
      permissions: installation.permissions
    };
  } catch {
    return undefined;
  }
}

type RepoProbe = {
  status: "ok" | "denied" | "missing";
  oauthScopes?: string | null;
  githubDetail?: string;
};

async function probeRepository(owner: string, repo: string, token: string): Promise<RepoProbe> {
  try {
    const response = await codeHostRequest(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coop-ai-backend"
        },
        provider: "github"
      }
    );
    const oauthScopes = response.headers.get("x-oauth-scopes");
    await response.json().catch(() => undefined);
    return { status: response.ok ? "ok" : "denied", oauthScopes };
  } catch (error) {
    if (error instanceof CodeHostError && error.code === "not_found") {
      return { status: "missing", githubDetail: error.message };
    }
    if (error instanceof CodeHostError && error.code === "auth") {
      return { status: "denied", githubDetail: error.message };
    }
    // Network trouble is not a permission answer — let the write attempt decide.
    return { status: "ok" };
  }
}

export function httpStatusForPullWriteReason(reason: GithubPullWriteReason): number {
  return reason === "not_connected" ? 401 : 403;
}
