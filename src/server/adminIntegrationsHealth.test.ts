import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleAdminIntegrationsRequest } from "./adminIntegrationsApi";
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
    onboardingGates: { slackScopeActive: boolean; canCompleteOnboarding: boolean };
    integrations: Array<{ provider: string; health: string }>;
  };
  assert.equal(body.onboardingGates.slackScopeActive, false);
  assert.equal(body.onboardingGates.canCompleteOnboarding, false);
  const slack = body.integrations.find((entry) => entry.provider === "slack");
  assert.equal(slack?.health, "scope_required");
});
