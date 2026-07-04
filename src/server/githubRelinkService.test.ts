import assert from "node:assert/strict";
import test from "node:test";
import {
  tryRelinkGithubInstallation,
  storeGithubInstallHint,
  resolveOrgIdForGithubCallback,
  findOrgIdByInstallHint
} from "./githubRelinkService";

test("tryRelinkGithubInstallation links a stored install hint without GitHub UI", async () => {
  const orgId = "org-1";
  const installationId = 144402900;
  const hints = new Map<string, string>();
  const installations = new Map<string, { installationId: number; token: string; expiresAt: Date }>();

  const orgStore = {
    async getCodeHostInstallation(_org: string, provider: string) {
      return installations.get(`${_org}:${provider}`);
    },
    async getCredential(_org: string, provider: string) {
      return hints.get(`${_org}:${provider}`);
    },
    async deleteCredential(_org: string, provider: string) {
      hints.delete(`${_org}:${provider}`);
    },
    async storeCredential(_org: string, provider: string, value: string) {
      hints.set(`${_org}:${provider}`, value);
    },
    async upsertCodeHostInstallation(
      _org: string,
      provider: string,
      id: number,
      token: string,
      expiresAt: Date
    ) {
      installations.set(`${_org}:${provider}`, { installationId: id, token, expiresAt });
    }
  };

  const githubApp = {
    async getInstallation(id: number) {
      return id === installationId ? { id, htmlUrl: "https://github.com/settings/installations/144402900" } : undefined;
    },
    async createInstallationAccessToken(id: number) {
      assert.equal(id, installationId);
      return { token: "ghs_test", expiresAt: new Date(Date.now() + 3_600_000) };
    }
  };

  await storeGithubInstallHint({ orgStore }, orgId, installationId);

  const result = await tryRelinkGithubInstallation({ orgStore, githubApp, jobQueue: undefined }, orgId);

  assert.deepEqual(result, { outcome: "linked", installationId, relinked: true });
  assert.ok(installations.has(`${orgId}:github`));
  assert.equal(hints.has(`${orgId}:github:install-hint`), false);
});

test("resolveOrgIdForGithubCallback falls back to install hint when state is missing", async () => {
  const orgId = "org-2";
  const installationId = 144419007;

  const orgStore = {
    async findOrgIdByCredentialValue(provider: string, value: string) {
      assert.equal(provider, "github:install-hint");
      assert.equal(value, String(installationId));
      return orgId;
    }
  };

  const githubApp = {
    verifyAndParseState: () => undefined
  };

  const resolved = await resolveOrgIdForGithubCallback(
    { orgStore, githubApp },
    "",
    installationId
  );
  assert.equal(resolved, orgId);

  const fromHint = await findOrgIdByInstallHint(orgStore, installationId);
  assert.equal(fromHint, orgId);
});

test("tryRelinkGithubInstallation discovers a sole organization installation", async () => {
  const orgId = "org-corp";
  const installationId = 900001;
  const installations = new Map<string, { installationId: number; token: string; expiresAt: Date }>();

  const orgStore = {
    async getCodeHostInstallation(_org: string, provider: string) {
      return installations.get(`${_org}:${provider}`);
    },
    async getCredential() {
      return undefined;
    },
    async deleteCredential() {},
    async storeCredential() {},
    async upsertCodeHostInstallation(
      _org: string,
      provider: string,
      id: number,
      token: string,
      expiresAt: Date
    ) {
      installations.set(`${_org}:${provider}`, { installationId: id, token, expiresAt });
    }
  };

  const githubApp = {
    async listAppInstallations() {
      return [{ id: installationId, accountLogin: "CoopAI-Corp", accountType: "Organization" }];
    },
    async getInstallation(id: number) {
      return id === installationId
        ? { id, accountLogin: "CoopAI-Corp", accountType: "Organization" }
        : undefined;
    },
    async createInstallationAccessToken(id: number) {
      assert.equal(id, installationId);
      return { token: "ghs_test", expiresAt: new Date(Date.now() + 3_600_000) };
    }
  };

  const result = await tryRelinkGithubInstallation({ orgStore, githubApp, jobQueue: undefined }, orgId);

  assert.deepEqual(result, { outcome: "linked", installationId, relinked: true });
  assert.ok(installations.has(`${orgId}:github`));
});

test("tryRelinkGithubInstallation prefers org install over stale personal install hint", async () => {
  const orgId = "org-corp";
  const stalePersonalId = 111;
  const orgInstallationId = 900002;
  const hints = new Map<string, string>();
  const installations = new Map<string, { installationId: number; token: string; expiresAt: Date }>();

  const orgStore = {
    async getCodeHostInstallation(_org: string, provider: string) {
      return installations.get(`${_org}:${provider}`);
    },
    async getCredential(_org: string, provider: string) {
      return hints.get(`${_org}:${provider}`);
    },
    async deleteCredential(_org: string, provider: string) {
      hints.delete(`${_org}:${provider}`);
    },
    async storeCredential(_org: string, provider: string, value: string) {
      hints.set(`${_org}:${provider}`, value);
    },
    async upsertCodeHostInstallation(
      _org: string,
      provider: string,
      id: number,
      token: string,
      expiresAt: Date
    ) {
      installations.set(`${_org}:${provider}`, { installationId: id, token, expiresAt });
    }
  };

  hints.set(`${orgId}:github:install-hint`, String(stalePersonalId));

  const githubApp = {
    async listAppInstallations() {
      return [{ id: orgInstallationId, accountLogin: "CoopAI-Corp", accountType: "Organization" }];
    },
    async getInstallation(id: number) {
      if (id === orgInstallationId) {
        return { id, accountLogin: "CoopAI-Corp", accountType: "Organization" };
      }
      if (id === stalePersonalId) {
        return { id, accountLogin: "raneyja", accountType: "User" };
      }
      return undefined;
    },
    async createInstallationAccessToken(id: number) {
      assert.equal(id, orgInstallationId);
      return { token: "ghs_test", expiresAt: new Date(Date.now() + 3_600_000) };
    }
  };

  const result = await tryRelinkGithubInstallation({ orgStore, githubApp, jobQueue: undefined }, orgId);

  assert.deepEqual(result, { outcome: "linked", installationId: orgInstallationId, relinked: true });
  assert.equal(installations.get(`${orgId}:github`)?.installationId, orgInstallationId);
});
