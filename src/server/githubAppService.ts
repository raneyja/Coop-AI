import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { githubAppInstallationHasPullWrite } from "../api/codeHosts/pullRequestWrite";

const GITHUB_API = "https://api.github.com";

export const GITHUB_APP_PULL_WRITE_PERMISSIONS = {
  contents: "write",
  pull_requests: "write"
} as const;

export type InstallationTokenResponse = {
  token: string;
  expiresAt: Date;
  permissions?: Record<string, string>;
};

export type PullWriteTokenAttempt =
  | { ok: true; token: string; expiresAt: Date; permissions?: Record<string, string> }
  | { ok: false; githubMessage?: string; permissions?: Record<string, string> };

/** GitHub 422 on a scoped token mint: the installation has not accepted these permissions. */
class PullWritePermissionRefused extends Error {
  public constructor(public readonly githubMessage?: string) {
    super(githubMessage ?? "GitHub refused the requested installation permissions");
    this.name = "PullWritePermissionRefused";
  }
}

async function readGithubMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : undefined;
  } catch {
    return undefined;
  }
}

export type GitHubAppServiceOptions = {
  appId: string;
  privateKeyPem: string;
  stateSecret: string;
};

export class GitHubAppService {
  public constructor(private readonly options: GitHubAppServiceOptions) {}

  public buildInstallUrl(slug: string, orgId: string): string {
    const state = this.signState(orgId);
    return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
  }

  public verifyAndParseState(state: string): string | undefined {
    const parts = state.split(".");
    if (parts.length !== 3) {
      return undefined;
    }
    const [orgId, issuedAt, signature] = parts;
    if (!orgId || !issuedAt || !signature) {
      return undefined;
    }
    const ageMs = Date.now() - Number(issuedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60 * 60 * 1000) {
      return undefined;
    }
    const expected = this.stateSignature(orgId, issuedAt);
    if (!safeEqual(signature, expected)) {
      return undefined;
    }
    return orgId;
  }

  public signState(orgId: string): string {
    const issuedAt = String(Date.now());
    const signature = this.stateSignature(orgId, issuedAt);
    return `${orgId}.${issuedAt}.${signature}`;
  }

  public async createInstallationAccessToken(
    installationId: number,
    options?: { permissions?: Record<string, "read" | "write"> }
  ): Promise<InstallationTokenResponse> {
    const jwt = this.createAppJwt();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "coop-ai-backend"
    };
    const body = options?.permissions ? JSON.stringify({ permissions: options.permissions }) : undefined;
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers,
      body
    });
    if (response.status === 422 && options?.permissions) {
      throw new PullWritePermissionRefused(await readGithubMessage(response));
    }
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub installation token exchange failed (${response.status}): ${errorBody}`);
    }
    const data = (await response.json()) as {
      token?: string;
      expires_at?: string;
      permissions?: Record<string, string>;
    };
    if (!data.token || !data.expires_at) {
      throw new Error("GitHub installation token response missing fields");
    }
    return {
      token: data.token,
      expiresAt: new Date(data.expires_at),
      permissions: data.permissions
    };
  }

  /**
   * Ask GitHub for a token scoped to Contents + Pull requests write. GitHub answers
   * 422 when the installation has not accepted those permissions, which is the only
   * trustworthy “Accept the App update” signal.
   */
  public async tryCreatePullWriteAccessToken(
    installationId: number
  ): Promise<PullWriteTokenAttempt> {
    let minted: InstallationTokenResponse;
    try {
      minted = await this.createInstallationAccessToken(installationId, {
        permissions: { ...GITHUB_APP_PULL_WRITE_PERMISSIONS }
      });
    } catch (error) {
      if (error instanceof PullWritePermissionRefused) {
        return { ok: false, githubMessage: error.githubMessage };
      }
      throw error;
    }
    if (minted.permissions && !githubAppInstallationHasPullWrite(minted.permissions)) {
      return {
        ok: false,
        githubMessage: `Installation ${installationId} granted contents=${minted.permissions.contents ?? "none"}, pull_requests=${minted.permissions.pull_requests ?? "none"}.`,
        permissions: minted.permissions
      };
    }
    return { ok: true, token: minted.token, expiresAt: minted.expiresAt, permissions: minted.permissions };
  }

  /** Paginate GET /installation/repositories — returns normalized github:owner/repo ids. */
  public async listInstallationRepositories(installationId: number): Promise<string[]> {
    const catalog = await this.listInstallationRepositoryCatalog(installationId);
    return catalog.map((entry) => entry.repoId);
  }

  /** Paginate GET /installation/repositories with owner, branch, and visibility metadata. */
  public async listInstallationRepositoryCatalog(
    installationId: number
  ): Promise<
    Array<{
      repoId: string;
      owner: string;
      name: string;
      defaultBranch: string;
      isPrivate: boolean;
      htmlUrl?: string;
    }>
  > {
    const { token } = await this.createInstallationAccessToken(installationId);
    const catalog: Array<{
      repoId: string;
      owner: string;
      name: string;
      defaultBranch: string;
      isPrivate: boolean;
      htmlUrl?: string;
    }> = [];
    let page = 1;

    while (true) {
      const url = new URL(`${GITHUB_API}/installation/repositories`);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coop-ai-backend"
        }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub list installation repositories failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        repositories?: Array<{
          full_name?: string;
          default_branch?: string;
          private?: boolean;
          html_url?: string;
        }>;
      };
      const batch = data.repositories ?? [];
      for (const repo of batch) {
        if (!repo.full_name) {
          continue;
        }
        const slash = repo.full_name.indexOf("/");
        if (slash <= 0) {
          continue;
        }
        catalog.push({
          repoId: `github:${repo.full_name}`,
          owner: repo.full_name.slice(0, slash),
          name: repo.full_name.slice(slash + 1),
          defaultBranch: repo.default_branch?.trim() || "",
          isPrivate: Boolean(repo.private),
          htmlUrl: repo.html_url
        });
      }

      if (batch.length < 100) {
        break;
      }
      page += 1;
    }

    return catalog;
  }

  public async getInstallation(installationId: number): Promise<
    | {
        id: number;
        htmlUrl?: string;
        suspendedAt?: string | null;
        accountLogin?: string;
        accountType?: string;
        permissions?: Record<string, string>;
        repositorySelection?: string;
      }
    | undefined
  > {
    const jwt = this.createAppJwt();
    const response = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coop-ai-backend"
      }
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub get installation failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as {
      id?: number;
      html_url?: string;
      suspended_at?: string | null;
      account?: { login?: string; type?: string };
      permissions?: Record<string, string>;
      repository_selection?: string;
    };
    if (!data.id) {
      return undefined;
    }
    return {
      id: data.id,
      htmlUrl: data.html_url,
      suspendedAt: data.suspended_at ?? null,
      accountLogin: data.account?.login,
      accountType: data.account?.type,
      permissions: data.permissions,
      repositorySelection: data.repository_selection
    };
  }

  /** Paginate GET /app/installations for this GitHub App (JWT auth). */
  public async listAppInstallations(): Promise<
    Array<{ id: number; accountLogin: string; accountType: string }>
  > {
    const jwt = this.createAppJwt();
    const installations: Array<{ id: number; accountLogin: string; accountType: string }> = [];
    let page = 1;

    while (true) {
      const url = new URL(`${GITHUB_API}/app/installations`);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coop-ai-backend"
        }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub list app installations failed (${response.status}): ${body}`);
      }

      const batch = parseGithubAppInstallationList(await response.json());
      installations.push(...batch);

      if (batch.length < 100) {
        break;
      }
      page += 1;
    }

    return installations;
  }

  public createAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
    const payload = base64UrlJson({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: this.options.appId
    });
    const signingInput = `${header}.${payload}`;
    const sign = createSign("RSA-SHA256");
    sign.update(signingInput);
    sign.end();
    const signature = sign
      .sign(this.options.privateKeyPem)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return `${signingInput}.${signature}`;
  }

  private stateSignature(orgId: string, issuedAt: string): string {
    return createHmac("sha256", this.options.stateSecret)
      .update(`${orgId}:${issuedAt}`)
      .digest("hex");
  }
}

/**
 * GitHub GET /app/installations returns a JSON array, not `{ installations: [...] }`.
 * Treat both shapes so a parser bug cannot hide every other install of the App.
 */
export function parseGithubAppInstallationList(
  payload: unknown
): Array<{ id: number; accountLogin: string; accountType: string }> {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { installations?: unknown }).installations)
      ? ((payload as { installations: unknown[] }).installations)
      : [];
  const installations: Array<{ id: number; accountLogin: string; accountType: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as { id?: unknown; account?: { login?: unknown; type?: unknown } };
    const id = typeof record.id === "number" ? record.id : Number(record.id);
    const accountLogin = typeof record.account?.login === "string" ? record.account.login : "";
    const accountType = typeof record.account?.type === "string" ? record.account.type : "";
    if (!Number.isFinite(id) || id <= 0 || !accountLogin || !accountType) {
      continue;
    }
    installations.push({ id, accountLogin, accountType });
  }
  return installations;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
