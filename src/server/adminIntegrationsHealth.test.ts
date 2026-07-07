import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleAdminIntegrationsRequest } from "./adminIntegrationsApi";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";
import type { ServerConfig } from "./serverConfig";

const testServerConfig: ServerConfig = {
  nodeEnv: "test",
  requireApiAuth: true,
  jobsWorkersEnabled: false,
  devMode: false
};

function mockResponse(): ServerResponse & { statusCode?: number; body?: unknown } {
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    writeHead(statusCode: number) {
      this.statusCode = statusCode;
    },
    end(payload: string) {
      this.body = JSON.parse(payload);
    }
  };
  return response as ServerResponse & { statusCode?: number; body?: unknown };
}

const auth = {
  orgId: "org-1",
  orgName: "Acme",
  plan: "enterprise" as const,
  apiKeyId: "key-1"
};

test("integrations health returns gates for disconnected org", async () => {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "enterprise", createdAt: new Date() }),
    getCodeHostInstallation: async () => undefined
  };
  const integrationStore = {
    get: async () => undefined
  };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    { method: "GET", pathname: "/v1/admin/integrations/health" },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      serverConfig: testServerConfig
    },
    auth
  );
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  const body = response.body as {
    onboardingGates: { canCompleteOnboarding: boolean };
    integrations: Array<{ provider: string; health: string }>;
  };
  assert.equal(body.onboardingGates.canCompleteOnboarding, false);
  assert.ok(body.integrations.some((entry) => entry.provider === "slack" && entry.health === "not_connected"));
});

test("integrations health marks slack scope required on enterprise", async () => {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "enterprise", createdAt: new Date() }),
    getCodeHostInstallation: async () => undefined
  };
  const integrationStore = {
    get: async (_orgId: string, provider: string) =>
      provider === "slack"
        ? {
            metadata: { encryptedBotToken: "enc" },
            tokenExpiresAt: undefined,
            updatedAt: new Date()
          }
        : undefined
  };
  const scopePolicyStore = {
    get: async () => undefined
  };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    { method: "GET", pathname: "/v1/admin/integrations/health" },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      scopePolicyStore: scopePolicyStore as never,
      serverConfig: testServerConfig
    },
    auth
  );
  assert.equal(handled, true);
  const body = response.body as {
    onboardingGates: { scopableToolsActive: boolean; canCompleteOnboarding: boolean };
    integrations: Array<{ provider: string; health: string }>;
  };
  assert.equal(body.onboardingGates.scopableToolsActive, false);
  assert.equal(body.onboardingGates.canCompleteOnboarding, false);
  const slack = body.integrations.find((entry) => entry.provider === "slack");
  assert.equal(slack?.health, "scope_required");
});

test("integrations health marks slack scope required on pro", async () => {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async () => undefined
  };
  const integrationStore = {
    get: async (_orgId: string, provider: string) =>
      provider === "slack"
        ? {
            metadata: { encryptedBotToken: "enc" },
            tokenExpiresAt: undefined,
            updatedAt: new Date()
          }
        : undefined
  };
  const scopePolicyStore = {
    get: async () => undefined
  };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    { method: "GET", pathname: "/v1/admin/integrations/health" },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      scopePolicyStore: scopePolicyStore as never,
      serverConfig: testServerConfig
    },
    { ...auth, plan: "pro" }
  );
  assert.equal(handled, true);
  const body = response.body as {
    onboardingGates: { scopableToolsActive: boolean; canCompleteOnboarding: boolean };
    integrations: Array<{ provider: string; health: string }>;
  };
  assert.equal(body.onboardingGates.scopableToolsActive, false);
  assert.equal(body.onboardingGates.canCompleteOnboarding, false);
  const slack = body.integrations.find((entry) => entry.provider === "slack");
  assert.equal(slack?.health, "scope_required");
});

test("integrations list includes github connectionKind metadata", async () => {
  const oauthInstallationId = githubOAuthSyntheticInstallationId("org-1");
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async (_orgId: string, provider: string) =>
      provider === "github"
        ? {
            installationId: oauthInstallationId,
            tokenExpiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date()
          }
        : undefined,
    getCredential: async () => undefined
  };
  const integrationStore = { get: async () => undefined };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    { method: "GET", pathname: "/v1/admin/integrations" },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      serverConfig: testServerConfig
    },
    auth
  );
  assert.equal(handled, true);
  const body = response.body as {
    integrations: Array<{ provider: string; metadata?: { connectionKind?: string } }>;
  };
  const github = body.integrations.find((entry) => entry.provider === "github");
  assert.equal(github?.metadata?.connectionKind, "oauth");
});

test("integrations list refresh marks github needsReconnect when live test fails", async () => {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async (_orgId: string, provider: string) =>
      provider === "github"
        ? {
            installationId: 42_001,
            tokenExpiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date()
          }
        : undefined,
    getCredential: async () => undefined,
    getInstallationToken: async () => undefined
  };
  const integrationStore = { get: async () => undefined };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    { method: "GET", pathname: "/v1/admin/integrations", query: new URLSearchParams({ refresh: "true" }) },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      serverConfig: testServerConfig
    },
    auth
  );
  assert.equal(handled, true);
  const body = response.body as {
    integrations: Array<{ provider: string; needsReconnect?: boolean; liveTestOk?: boolean }>;
  };
  const github = body.integrations.find((entry) => entry.provider === "github");
  assert.equal(github?.liveTestOk, false);
  assert.equal(github?.needsReconnect, true);
});

test("integrations health refresh marks github degraded and blocks onboarding", async () => {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async (_orgId: string, provider: string) =>
      provider === "github"
        ? {
            installationId: 42_001,
            tokenExpiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date()
          }
        : undefined,
    getCredential: async () => undefined,
    getInstallationToken: async () => undefined
  };
  const integrationStore = { get: async () => undefined };
  const response = mockResponse();
  const handled = await handleAdminIntegrationsRequest(
    {
      method: "GET",
      pathname: "/v1/admin/integrations/health",
      query: new URLSearchParams({ refresh: "true" })
    },
    response,
    {
      orgStore: orgStore as never,
      integrationStore: integrationStore as never,
      serverConfig: testServerConfig
    },
    auth
  );
  assert.equal(handled, true);
  const body = response.body as {
    onboardingGates: { githubOrToolConnected: boolean; canCompleteOnboarding: boolean };
    integrations: Array<{ provider: string; health: string; message?: string }>;
  };
  const github = body.integrations.find((entry) => entry.provider === "github");
  assert.equal(github?.health, "degraded");
  assert.equal(github?.message, "Reconnect required.");
  assert.equal(body.onboardingGates.githubOrToolConnected, false);
  assert.equal(body.onboardingGates.canCompleteOnboarding, false);
});
