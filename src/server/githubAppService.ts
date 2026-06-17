import { createHmac, createSign, timingSafeEqual } from "node:crypto";

const GITHUB_API = "https://api.github.com";

export type InstallationTokenResponse = {
  token: string;
  expiresAt: Date;
};

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

  public async createInstallationAccessToken(installationId: number): Promise<InstallationTokenResponse> {
    const jwt = this.createAppJwt();
    const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "coop-ai-backend"
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub installation token exchange failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { token?: string; expires_at?: string };
    if (!data.token || !data.expires_at) {
      throw new Error("GitHub installation token response missing fields");
    }
    return {
      token: data.token,
      expiresAt: new Date(data.expires_at)
    };
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
          defaultBranch: repo.default_branch?.trim() || "main",
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
