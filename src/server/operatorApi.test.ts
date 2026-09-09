import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { resolveAuthContextDetailed, writeOrgSuspended } from "./authMiddleware";
import { handleOperatorApiRequest } from "./operatorApi";
import type { OperatorApiDeps } from "./operatorApi";
import type { OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { OperatorStore } from "./operators/operatorStore";
import type { OperatorAuthConfig } from "./operators/operatorAuthConfig";
import type { OperatorContext as OpCtx } from "./operators/operatorStore";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

function baseDeps(overrides: Partial<OperatorApiDeps> = {}): OperatorApiDeps {
  const serverConfig = { requireApiAuth: true, legacyApiToken: undefined } as ServerConfig;
  const operatorAuthConfig: OperatorAuthConfig = {
    allowlistEmails: new Set(["ops@coop-ai.dev"]),
    opsPortalUrl: "http://localhost:3003",
    sessionTtlMs: 3600000,
    oauthStateSecret: "test",
    defaultRole: "super_admin"
  };
  return {
    serverConfig,
    operatorAuthConfig,
    ...overrides
  };
}

void (async () => {
  // Org-admin session must not access operator routes.
  const denied = mockResponse();
  const handled = await handleOperatorApiRequest(
    {
      method: "GET",
      pathname: "/v1/operator/me",
      headers: { authorization: "Bearer org-admin-session" },
      body: {}
    },
    denied,
    baseDeps({
      operatorStore: {
        resolveSession: async () => undefined
      } as unknown as OperatorStore
    })
  );
  assert.equal(handled, true);
  assert.equal(denied.statusCode, 401);

  // Viewer cannot suspend.
  const viewer: OpCtx = {
    operatorId: "op-viewer",
    email: "viewer@coop-ai.dev",
    role: "viewer"
  };
  const suspendDenied = mockResponse();
  const suspendHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/suspend",
      headers: { authorization: "Bearer ops-token" },
      body: { reason: "abuse", confirmName: "Acme" }
    },
    suspendDenied,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", repoAccessMode: "all_indexed", createdAt: new Date() })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => viewer,
        recordAudit: async () => {
          throw new Error("audit should not run");
        }
      } as unknown as OperatorStore
    })
  );
  assert.equal(suspendHandled, true);
  assert.equal(suspendDenied.statusCode, 403);
  assert.match(suspendDenied.body ?? "", /operator_role_required/);

  // Super-admin suspend requires confirm name and writes audit before 200.
  let auditAction = "";
  const superAdmin: OpCtx = {
    operatorId: "op-super",
    email: "super@coop-ai.dev",
    role: "super_admin"
  };
  const suspendOk = mockResponse();
  const suspendOkHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/suspend",
      headers: { authorization: "Bearer ops-token" },
      body: { reason: "policy violation", confirmName: "Acme Corp" }
    },
    suspendOk,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "enterprise",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrgOperatorMetadata: async () => ({
          operatorStatus: "active",
          provenance: "manual_enterprise"
        }),
        suspendOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "enterprise",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => superAdmin,
        recordAudit: async (input: { action: string }) => {
          auditAction = input.action;
          return {
            id: "1",
            operatorId: superAdmin.operatorId,
            action: input.action,
            metadata: {},
            createdAt: new Date()
          };
        }
      } as unknown as OperatorStore
    })
  );
  assert.equal(suspendOkHandled, true);
  assert.equal(suspendOk.statusCode, 200);
  assert.equal(auditAction, "operator.org.suspend");

  // Support can patch support metadata fields.
  const support: OpCtx = {
    operatorId: "op-support",
    email: "support@coop-ai.dev",
    role: "support"
  };
  let patchedMetadata: Record<string, unknown> | undefined;
  const supportPatchRes = mockResponse();
  const supportPatchHandled = await handleOperatorApiRequest(
    {
      method: "PATCH",
      pathname: "/v1/operator/organizations/org-1",
      headers: { authorization: "Bearer ops-token" },
      body: { notes: "Needs follow-up", crmExternalId: "crm-123", assigneeOperatorId: "op-support" }
    },
    supportPatchRes,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "enterprise",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrganizationBilling: async () => ({
          seatCount: 10,
          billingStatus: "active"
        }),
        getOrgOperatorMetadata: async () => ({
          operatorStatus: "active",
          provenance: "manual_enterprise"
        }),
        updateOrgOperatorMetadata: async (_orgId: string, patch: Record<string, unknown>) => {
          patchedMetadata = patch;
        },
        getCodeHostInstallation: async () => undefined,
        listOrgRepos: async () => []
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => support,
        recordAudit: async (input: { action: string }) => ({
          id: "2",
          operatorId: support.operatorId,
          action: input.action,
          metadata: {},
          createdAt: new Date()
        })
      } as unknown as OperatorStore
    })
  );
  assert.equal(supportPatchHandled, true);
  assert.equal(supportPatchRes.statusCode, 200);
  assert.deepEqual(patchedMetadata, {
    operatorNotes: "Needs follow-up",
    crmExternalId: "crm-123",
    assigneeOperatorId: "op-support"
  });

  // Support cannot patch billing fields (seats/plan).
  const supportBillingPatchRes = mockResponse();
  const supportBillingPatchHandled = await handleOperatorApiRequest(
    {
      method: "PATCH",
      pathname: "/v1/operator/organizations/org-1",
      headers: { authorization: "Bearer ops-token" },
      body: { seats: 25 }
    },
    supportBillingPatchRes,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "enterprise",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => support
      } as unknown as OperatorStore
    })
  );
  assert.equal(supportBillingPatchHandled, true);
  assert.equal(supportBillingPatchRes.statusCode, 403);
  assert.match(supportBillingPatchRes.body ?? "", /operator_role_required/);

  // Stripe-managed org cannot PATCH seats directly.
  const billingOp: OpCtx = {
    operatorId: "op-billing",
    email: "billing@coop-ai.dev",
    role: "billing"
  };
  const stripePatchRes = mockResponse();
  const stripePatchHandled = await handleOperatorApiRequest(
    {
      method: "PATCH",
      pathname: "/v1/operator/organizations/org-1",
      headers: { authorization: "Bearer ops-token" },
      body: { seats: 5 }
    },
    stripePatchRes,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrganizationBilling: async () => ({
          seatCount: 1,
          billingStatus: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123"
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => billingOp
      } as unknown as OperatorStore
    })
  );
  assert.equal(stripePatchHandled, true);
  assert.equal(stripePatchRes.statusCode, 409);
  assert.match(stripePatchRes.body ?? "", /stripe_managed/);

  // Seat-change link returns Stripe portal URL without mutating Coop seats (additive).
  const seatLinkRes = mockResponse();
  let seatCountUpdated = false;
  let sentQuantity: number | undefined;
  const seatLinkHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/seat-change-link",
      headers: { authorization: "Bearer ops-token" },
      body: { addSeats: 2 }
    },
    seatLinkRes,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrganizationBilling: async () => ({
          seatCount: 1,
          billingStatus: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123"
        }),
        updateOrganizationBilling: async () => {
          seatCountUpdated = true;
        }
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => billingOp,
        recordAudit: async () => undefined
      } as unknown as OperatorStore,
      stripeService: {
        isConfigured: () => true,
        retrieveSubscription: async () => ({ id: "sub_123", status: "active", quantity: 1, itemId: "si_123" }),
        createBillingPortalSession: async (_customerId: string, options?: { quantity?: number }) => {
          sentQuantity = options?.quantity;
          return { url: "https://billing.stripe.com/session/test" };
        }
      } as never
    })
  );
  assert.equal(seatLinkHandled, true);
  assert.equal(seatLinkRes.statusCode, 200);
  assert.match(seatLinkRes.body ?? "", /billing\.stripe\.com/);
  const seatPayload = JSON.parse(seatLinkRes.body ?? "{}");
  assert.equal(seatPayload.currentSeats, 1);
  assert.equal(seatPayload.addedSeats, 2);
  assert.equal(seatPayload.requestedSeats, 3);
  assert.equal(sentQuantity, 3);
  assert.equal(seatCountUpdated, false);

  // Viewer cannot cancel a customer.
  const cancelDenied = mockResponse();
  const cancelDeniedHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/cancel",
      headers: { authorization: "Bearer ops-token" },
      body: { confirmName: "Acme Corp" }
    },
    cancelDenied,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => viewer,
        recordAudit: async () => {
          throw new Error("audit should not run");
        }
      } as unknown as OperatorStore
    })
  );
  assert.equal(cancelDeniedHandled, true);
  assert.equal(cancelDenied.statusCode, 403);
  assert.match(cancelDenied.body ?? "", /operator_role_required/);

  // Confirm-name mismatch does not cancel.
  const cancelMismatch = mockResponse();
  const cancelMismatchHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/cancel",
      headers: { authorization: "Bearer ops-token" },
      body: { confirmName: "Wrong Name" }
    },
    cancelMismatch,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => superAdmin,
        recordAudit: async () => {
          throw new Error("audit should not run");
        }
      } as unknown as OperatorStore
    })
  );
  assert.equal(cancelMismatchHandled, true);
  assert.equal(cancelMismatch.statusCode, 400);
  assert.match(cancelMismatch.body ?? "", /confirm_name_mismatch/);

  // Stripe failure aborts before Coop offboard.
  let cancelledOrg = false;
  let deactivatedUsers = false;
  const stripeFail = mockResponse();
  const stripeFailHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/cancel",
      headers: { authorization: "Bearer ops-token" },
      body: { confirmName: "Acme Corp" }
    },
    stripeFail,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrgOperatorMetadata: async () => ({
          operatorStatus: "active",
          provenance: "stripe_checkout"
        }),
        getOrganizationBilling: async () => ({
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          billingStatus: "active"
        }),
        cancelOrganization: async () => {
          cancelledOrg = true;
          return {
            id: "org-1",
            name: "Acme Corp",
            plan: "pro",
            repoAccessMode: "all_indexed",
            createdAt: new Date()
          };
        }
      } as unknown as OrgStore,
      userStore: {
        deactivateOrgUsers: async () => {
          deactivatedUsers = true;
          return 1;
        }
      } as never,
      authIdentityStore: {
        deleteIdentitiesForOrg: async () => 1
      } as never,
      operatorStore: {
        resolveSession: async () => superAdmin,
        recordAudit: async () => {
          throw new Error("audit should not run");
        }
      } as unknown as OperatorStore,
      stripeService: {
        isConfigured: () => true,
        cancelSubscription: async () => {
          throw new Error("Stripe is down");
        }
      } as never
    })
  );
  assert.equal(stripeFailHandled, true);
  assert.equal(stripeFail.statusCode, 502);
  assert.match(stripeFail.body ?? "", /Stripe is down/);
  assert.equal(cancelledOrg, false);
  assert.equal(deactivatedUsers, false);

  // Super-admin cancel offboards users, unlinks logins, cancels Stripe, and audits.
  let cancelAudit = "";
  let stripeCancelledId = "";
  let billingCleared = false;
  const cancelOk = mockResponse();
  const cancelOkHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/cancel",
      headers: { authorization: "Bearer ops-token" },
      body: { confirmName: "Acme Corp", reason: "churn" }
    },
    cancelOk,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "pro",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrgOperatorMetadata: async () => ({
          operatorStatus: "active",
          provenance: "stripe_checkout"
        }),
        getOrganizationBilling: async () => ({
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          billingStatus: "active"
        }),
        setOrganizationPlan: async () => undefined,
        updateOrganizationBilling: async () => {
          billingCleared = true;
        },
        revokeAllApiKeys: async () => 2,
        cancelOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "free",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        })
      } as unknown as OrgStore,
      userStore: {
        deactivateOrgUsers: async () => 3
      } as never,
      authIdentityStore: {
        deleteIdentitiesForOrg: async () => 2
      } as never,
      authTokenStore: {
        revokeUnusedTokensForOrg: async () => 4
      } as never,
      operatorStore: {
        resolveSession: async () => superAdmin,
        recordAudit: async (input: { action: string }) => {
          cancelAudit = input.action;
          return {
            id: "3",
            operatorId: superAdmin.operatorId,
            action: input.action,
            metadata: {},
            createdAt: new Date()
          };
        }
      } as unknown as OperatorStore,
      stripeService: {
        isConfigured: () => true,
        cancelSubscription: async (id: string) => {
          stripeCancelledId = id;
          return { id, status: "canceled" };
        }
      } as never
    })
  );
  assert.equal(cancelOkHandled, true);
  assert.equal(cancelOk.statusCode, 200);
  assert.equal(cancelAudit, "operator.org.cancel");
  assert.equal(stripeCancelledId, "sub_123");
  assert.equal(billingCleared, true);
  const cancelPayload = JSON.parse(cancelOk.body ?? "{}");
  assert.equal(cancelPayload.operatorStatus, "cancelled");
  assert.equal(cancelPayload.deactivatedUsers, 3);
  assert.equal(cancelPayload.deletedIdentities, 2);

  // Cancelled orgs cannot be activated back into the same tenant.
  const activateCancelled = mockResponse();
  const activateCancelledHandled = await handleOperatorApiRequest(
    {
      method: "POST",
      pathname: "/v1/operator/organizations/org-1/activate",
      headers: { authorization: "Bearer ops-token" },
      body: {}
    },
    activateCancelled,
    baseDeps({
      orgStore: {
        getOrganization: async () => ({
          id: "org-1",
          name: "Acme Corp",
          plan: "free",
          repoAccessMode: "all_indexed",
          createdAt: new Date()
        }),
        getOrgOperatorMetadata: async () => ({
          operatorStatus: "cancelled",
          provenance: "stripe_checkout"
        })
      } as unknown as OrgStore,
      operatorStore: {
        resolveSession: async () => superAdmin,
        recordAudit: async () => {
          throw new Error("audit should not run");
        }
      } as unknown as OperatorStore
    })
  );
  assert.equal(activateCancelledHandled, true);
  assert.equal(activateCancelled.statusCode, 409);
  assert.match(activateCancelled.body ?? "", /cancelled_not_restored/);

  // Suspended org returns org_suspended via auth middleware.
  const suspendedStore = {
    resolveAuth: async () => ({
      orgId: "org-suspended",
      orgName: "Suspended Org",
      plan: "pro",
      apiKeyId: "key-1"
    }),
    isOrgSuspended: async (orgId: string) => orgId === "org-suspended"
  } as unknown as OrgStore;
  const suspendedResult = await resolveAuthContextDetailed(
    { authorization: "Bearer coop_api_key" },
    suspendedStore,
    undefined,
    true
  );
  assert.equal(suspendedResult.orgSuspended, true);
  assert.equal(suspendedResult.auth?.orgId, "org-suspended");

  const suspendedRes = mockResponse();
  writeOrgSuspended(suspendedRes, { orgId: "org-suspended", orgName: "Suspended Org" });
  assert.equal(suspendedRes.statusCode, 403);
  assert.match(suspendedRes.body ?? "", /org_suspended/);
  assert.match(suspendedRes.body ?? "", /Suspended Org/);

  console.log("operatorApi.test.ts: ok");
})();
