import { codeHostRequest } from "../api/codeHosts/codeHostHttp";
import {
  GITHUB_NOT_CONNECTED_MESSAGE,
  GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE,
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
  grantedPermissions?: Record<string, string>;
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
  githubApp?: Pick<GitHubAppService, "tryCreatePullWriteAccessToken">;
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
  installationId: number
): Promise<GithubPullWriteInspection> {
  const attempt = await options.githubApp!.tryCreatePullWriteAccessToken(installationId);
  if (!attempt.ok) {
    return {
      ok: false,
      reason: "app_permissions_not_accepted",
      message: GITHUB_WRITE_PERMISSION_MESSAGE,
      tokenKind: "github_app",
      installationId,
      grantedPermissions: attempt.permissions,
      githubDetail: attempt.githubMessage
    };
  }

  await options.orgStore.upsertCodeHostInstallation(
    options.orgId,
    "github",
    installationId,
    attempt.token,
    attempt.expiresAt
  );

  const probe = await probeRepository(options.owner, options.repo, attempt.token);
  if (probe.status !== "ok") {
    return {
      ok: false,
      reason: "repo_not_in_installation",
      message: githubRepoNotInInstallationMessage(options.owner, options.repo),
      tokenKind: "github_app",
      installationId,
      grantedPermissions: attempt.permissions,
      githubDetail: probe.githubDetail
    };
  }

  return {
    ok: true,
    reason: "ready",
    message: "GitHub can create pull requests.",
    tokenKind: "github_app",
    installationId,
    grantedPermissions: attempt.permissions,
    token: attempt.token
  };
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
