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
