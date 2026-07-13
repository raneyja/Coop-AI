import type { ServerResponse } from "node:http";
import { extractBearerToken } from "./authMiddleware";
import { writeJson } from "./adminApiShared";
import type { AuditLogger } from "./audit/auditLogger";
import type { AuthTokenStore } from "./auth/authTokenStore";
import type { EmailService } from "./email/emailService";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { JobQueue } from "../jobs/jobQueue";
import type { OrgPlan, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { UserStore } from "./users/userStore";
import { inviteOrgUser, isSeatLimitError } from "./users/inviteOrgUser";
import { adminPortalAcceptInviteUrl } from "./billing/adminPortalUrl";
import { loadBillingConfig } from "./billing/billingConfig";
import { StripeService } from "./billing/stripeService";
import { syncOrgCatalog } from "./catalogSyncService";
import { clampSeatCountForPlan } from "./planGates";
import type { OperatorAuthConfig } from "./operators/operatorAuthConfig";
import {
  allowedOperatorGoogleRedirectUris,
  isAllowedOperatorGoogleRedirectUri
} from "./operators/operatorAuthConfig";
import {
  requireOperator,
  requireOperatorRole,
  resolveOperatorContext
} from "./operators/operatorAuthMiddleware";
import { OperatorGoogleAuthService } from "./operators/operatorGoogleAuth";
import type { OperatorStore, OperatorContext } from "./operators/operatorStore";
import type { OrgRepoAccessMode } from "./repoAccessTypes";

export type OperatorApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  operatorStore?: OperatorStore;
  authTokenStore?: AuthTokenStore;
  integrationStore?: IntegrationConnectionStore;
  serverConfig: ServerConfig;
  operatorAuthConfig: OperatorAuthConfig;
  operatorGoogleAuth?: OperatorGoogleAuthService;
  emailService?: EmailService;
  auditLogger?: AuditLogger;
  jobQueue?: JobQueue;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

const TRACKED_PROVIDERS = [
  "github",
  "gitlab",
  "bitbucket",
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
] as const;

export async function handleOperatorApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/operator/")) {
    return false;
  }

  if (!deps.operatorStore) {
    writeJson(response, 503, { error: "operator_unavailable" });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/operator/auth/google/exchange") {
    return handleGoogleExchange(parsed, response, deps);
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/operator/auth/google/start") {
    return handleGoogleStart(parsed, response, deps);
  }

  const operator = await resolveOperatorContext(parsed.headers, deps.operatorStore);
  if (!requireOperator(operator, response)) {
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/operator/me") {
    writeJson(response, 200, {
      id: operator.operatorId,
      email: operator.email,
      name: operator.name,
      role: operator.role
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/operator/auth/logout") {
    const token = extractBearerToken(parsed.headers);
    if (token) {
      await deps.operatorStore.revokeSessionByToken(token);
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (!deps.orgStore) {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/operator/attention-queue") {
    return handleAttentionQueue(response, deps, operator);
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/operator/organizations") {
    return handleListOrganizations(parsed, response, deps, operator);
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/operator/organizations") {
    return handleProvisionOrganization(parsed, response, deps, operator);
  }

  const orgMatch = parsed.pathname.match(/^\/v1\/operator\/organizations\/([^/]+)(.*)$/);
  if (orgMatch) {
    const orgId = decodeURIComponent(orgMatch[1]);
    const suffix = orgMatch[2] ?? "";
    return handleOrgScopedRequest(orgId, suffix, parsed, response, deps, operator);
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/operator/activity") {
    return handlePlatformActivity(parsed, response, deps, operator);
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}

async function handleGoogleExchange(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps
): Promise<boolean> {
  const google = deps.operatorGoogleAuth ?? new OperatorGoogleAuthService(deps.operatorAuthConfig);
  const body = asRecord(parsed.body);
  const code = String(body.code ?? "").trim();
  const redirectUri = String(body.redirectUri ?? "").trim();
  if (!code || !redirectUri) {
    writeJson(response, 400, { error: "invalid_request", message: "code and redirectUri are required." });
    return true;
  }

  const result = await google.exchangeCodeForSession(
    { config: deps.operatorAuthConfig, operatorStore: deps.operatorStore! },
    code,
    redirectUri
  );
  if (!result.ok) {
    writeJson(response, result.status, { error: result.error, message: result.message });
    return true;
  }

  writeJson(response, 200, {
    accessToken: result.token,
    expiresAt: result.expiresAt,
    operator: result.operator
  });
  return true;
}

async function handleGoogleStart(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps
): Promise<boolean> {
  const google = deps.operatorGoogleAuth ?? new OperatorGoogleAuthService(deps.operatorAuthConfig);
  if (!google.isConfigured()) {
    writeJson(response, 503, {
      error: "operator_google_unavailable",
      message: "Operator Google sign-in is not configured. Set GOOGLE_AUTH_CLIENT_* or COOP_OPERATOR_GOOGLE_*."
    });
    return true;
  }

  const redirectUri = parsed.query?.get("redirectUri")?.trim().replace(/\/$/, "");
  if (!redirectUri || !isAllowedOperatorGoogleRedirectUri(deps.operatorAuthConfig, redirectUri)) {
    writeJson(response, 400, {
      error: "invalid_redirect_uri",
      message: "OAuth redirect URI is not allowed for operator sign-in.",
      allowedRedirectUris: allowedOperatorGoogleRedirectUris(deps.operatorAuthConfig)
    });
    return true;
  }

  const postLoginRedirect = parsed.query?.get("redirect")?.trim() || undefined;
  const authorizeUrl = google.buildAuthorizeUrl(redirectUri, postLoginRedirect);
  if (!authorizeUrl) {
    writeJson(response, 400, { error: "invalid_redirect_uri", message: "Could not build Google authorize URL." });
    return true;
  }

  response.writeHead(302, { location: authorizeUrl });
  response.end();
  return true;
}

async function handleAttentionQueue(
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }

  const upgradeRequests = await deps.operatorStore!.listPendingEnterpriseUpgradeRequests(20);
  const pastDue = await deps.orgStore!.listOrganizationsForOperator({
    billingStatus: "past_due",
    limit: 20
  });
  const seatOverage = await deps.operatorStore!.listSeatOverageOrgs(20);
  const indexingErrors = await deps.operatorStore!.listIndexingErrors(30);
  const staleInvites = await deps.operatorStore!.listStaleInvites(30);

  writeJson(response, 200, {
    enterpriseUpgradeRequests: upgradeRequests,
    pastDue: pastDue.organizations,
    seatOverage,
    indexingErrors,
    staleInvites
  });
  return true;
}

async function handleListOrganizations(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }
  const query = parsed.query;
  const plan = query?.get("plan")?.trim();
  const billingStatus = query?.get("billingStatus")?.trim();
  const sort = query?.get("sort")?.trim();
  const search = query?.get("search")?.trim();

  const result = await deps.orgStore!.listOrganizationsForOperator({
    search,
    plan: plan as OrgPlan | undefined,
    billingStatus,
    sort: parseSort(sort)
  });
  writeJson(response, 200, result);
  return true;
}

async function handleProvisionOrganization(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "billing", response)) {
    return true;
  }
  if (!deps.userStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }

  const body = asRecord(parsed.body);
  const name = String(body.name ?? "").trim();
  const plan = String(body.plan ?? "enterprise").trim() as OrgPlan;
  const seats = Math.max(1, Number(body.seats ?? 5) || 5);
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
  const crmExternalId = String(body.crmExternalId ?? "").trim() || undefined;
  const sendInvite = body.sendInvite !== false;
  const createApiKey = body.createApiKey === true;

  if (!name || !adminEmail) {
    writeJson(response, 400, { error: "invalid_request", message: "name and adminEmail are required." });
    return true;
  }

  const org = await deps.orgStore!.createOrganization(name, plan);
  await deps.orgStore!.updateOrganizationBilling(org.id, {
    seatCount: clampSeatCountForPlan(plan, seats),
    billingStatus: plan === "free" ? "none" : "active",
    billingEmail: adminEmail
  });
  await deps.orgStore!.updateOrgOperatorMetadata(org.id, {
    provenance: plan === "enterprise" ? "manual_enterprise" : plan === "pro" ? "manual_pro" : "unknown",
    crmExternalId: crmExternalId ?? null,
    assigneeOperatorId: operator.operatorId
  });

  let inviteResult;
  if (sendInvite) {
    try {
      inviteResult = await inviteOrgUser(
        {
          orgStore: deps.orgStore!,
          userStore: deps.userStore,
          authTokenStore: deps.authTokenStore
        },
        { orgId: org.id, email: adminEmail, role: "admin", invitedByEmail: operator.email }
      );
    } catch (error) {
      if (isSeatLimitError(error)) {
        writeJson(response, 403, { error: error.code, seats: error.seats, used: error.used });
        return true;
      }
      throw error;
    }
  } else {
    await deps.userStore.createUser(org.id, adminEmail, "admin");
  }

  let apiKey;
  if (createApiKey) {
    const created = await deps.orgStore!.createApiKey(org.id, "bootstrap");
    apiKey = { id: created.record.id, label: created.record.label, rawKey: created.rawKey };
  }
  const invite =
    inviteResult && inviteResult.inviteToken
      ? {
          ...inviteResult,
          inviteLink: adminPortalAcceptInviteUrl(loadBillingConfig().adminPortalUrl, inviteResult.inviteToken)
        }
      : inviteResult;

  await operatorAudit(deps, operator, "operator.org.provision", org.id, {
    name,
    plan,
    seats,
    adminEmail,
    crmExternalId,
    sendInvite,
    createApiKey: Boolean(apiKey)
  });

  writeJson(response, 201, {
    organization: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      seats: clampSeatCountForPlan(plan, seats)
    },
    invite,
    apiKey
  });
  return true;
}

async function handleOrgScopedRequest(
  orgId: string,
  suffix: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (suffix === "" && parsed.method === "GET") {
    return handleOrgDetail(orgId, response, deps, operator);
  }
  if (suffix === "" && parsed.method === "PATCH") {
    return handlePatchOrg(orgId, parsed, response, deps, operator);
  }
  if (suffix === "/suspend" && parsed.method === "POST") {
    return handleSuspendOrg(orgId, parsed, response, deps, operator);
  }
  if (suffix === "/activate" && parsed.method === "POST") {
    return handleActivateOrg(orgId, response, deps, operator);
  }
  if (suffix === "/users" && parsed.method === "GET") {
    return handleListUsers(orgId, response, deps, operator);
  }
  if (suffix === "/users/invite" && parsed.method === "POST") {
    return handleInviteUser(orgId, parsed, response, deps, operator);
  }
  const resendMatch = suffix.match(/^\/users\/([^/]+)\/resend-invite$/);
  if (resendMatch && parsed.method === "POST") {
    return handleResendInvite(orgId, decodeURIComponent(resendMatch[1]), response, deps, operator);
  }
  if (suffix === "/api-keys" && parsed.method === "GET") {
    return handleListApiKeys(orgId, response, deps, operator);
  }
  if (suffix === "/api-keys" && parsed.method === "POST") {
    return handleCreateApiKey(orgId, parsed, response, deps, operator);
  }
  if (suffix === "/api-keys/revoke-all" && parsed.method === "POST") {
    return handleRevokeAllApiKeys(orgId, parsed, response, deps, operator);
  }
  const keyMatch = suffix.match(/^\/api-keys\/([^/]+)$/);
  if (keyMatch && parsed.method === "DELETE") {
    return handleRevokeApiKey(orgId, decodeURIComponent(keyMatch[1]), response, deps, operator);
  }
  if (suffix === "/reindex-estate" && parsed.method === "POST") {
    return handleReindexEstate(orgId, parsed, response, deps, operator);
  }
  if (suffix === "/repo-access-mode" && parsed.method === "PATCH") {
    return handleRepoAccessMode(orgId, parsed, response, deps, operator);
  }
  if (suffix === "/upgrade-pro" && parsed.method === "POST") {
    return handleUpgradePro(orgId, response, deps, operator);
  }
  if (suffix === "/audit" && parsed.method === "GET") {
    return handleOrgAudit(orgId, parsed, response, deps, operator);
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}

async function handleOrgDetail(
  orgId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  const billing = await deps.orgStore!.getOrganizationBilling(orgId);
  const operatorMeta = await deps.orgStore!.getOrgOperatorMetadata(orgId);
  const users = deps.userStore ? await deps.userStore.listOrgUsers(orgId) : [];
  const activeUsers = users.filter((u) => !u.deactivatedAt);
  const integrationSummary = await buildIntegrationSummary(deps, orgId);
  const indexingSummary = await buildIndexingSummary(deps, orgId);
  const lastAdminLogin = activeUsers
    .filter((u) => u.role === "admin" || u.role === "owner")
    .map((u) => u.lastLoginAt)
    .filter(Boolean)
    .sort((a, b) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0))[0];
  const stripeDrift = await buildStripeDrift(deps, org.plan, billing);

  writeJson(response, 200, {
    id: org.id,
    name: org.name,
    plan: org.plan,
    repoAccessMode: org.repoAccessMode,
    createdAt: org.createdAt,
    billing: {
      email: billing?.billingEmail,
      status: billing?.billingStatus ?? "none",
      seatCount: billing?.seatCount ?? 1,
      seatsUsed: activeUsers.length,
      stripeCustomerId: billing?.stripeCustomerId,
      stripeSubscriptionId: billing?.stripeSubscriptionId,
      onboardingCompleted: Boolean(billing?.onboardingCompletedAt)
    },
    operator: operatorMeta,
    health: {
      integrationsCount: integrationSummary.installedCount,
      integrationSummary,
      indexingSummary,
      lastAdminLogin: lastAdminLogin ?? null,
      stripeDrift
    }
  });
  return true;
}

async function handlePatchOrg(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  const body = asRecord(parsed.body);
  const patchesSupportFields =
    body.notes !== undefined || body.crmExternalId !== undefined || body.assigneeOperatorId !== undefined;
  const patchesBillingFields = body.seats !== undefined || body.plan !== undefined;

  if (!patchesSupportFields && !patchesBillingFields) {
    writeJson(response, 400, { error: "invalid_request", message: "No supported fields were provided." });
    return true;
  }
  if (patchesSupportFields && !requireOperatorRole(operator, "support", response)) {
    return true;
  }
  if (patchesBillingFields && !requireOperatorRole(operator, "billing", response)) {
    return true;
  }

  const patchMeta: {
    operatorNotes?: string | null;
    crmExternalId?: string | null;
    assigneeOperatorId?: string | null;
  } = {};
  const auditMeta: Record<string, unknown> = {};

  if (body.seats !== undefined) {
    const seats = Math.max(1, Number(body.seats) || 1);
    await deps.orgStore!.updateOrganizationBilling(orgId, {
      seatCount: clampSeatCountForPlan(org.plan, seats)
    });
    auditMeta.seats = seats;
  }
  if (body.plan !== undefined) {
    const plan = String(body.plan).trim() as OrgPlan;
    await deps.orgStore!.setOrganizationPlan(orgId, plan);
    auditMeta.plan = plan;
  }
  if (body.notes !== undefined) {
    patchMeta.operatorNotes = String(body.notes);
    auditMeta.notes = true;
  }
  if (body.crmExternalId !== undefined) {
    patchMeta.crmExternalId = String(body.crmExternalId).trim() || null;
    auditMeta.crmExternalId = patchMeta.crmExternalId;
  }
  if (body.assigneeOperatorId !== undefined) {
    patchMeta.assigneeOperatorId = String(body.assigneeOperatorId).trim() || null;
    auditMeta.assigneeOperatorId = patchMeta.assigneeOperatorId;
  }

  if (Object.keys(patchMeta).length > 0) {
    await deps.orgStore!.updateOrgOperatorMetadata(orgId, patchMeta);
  }

  await operatorAudit(deps, operator, "operator.org.patch", orgId, auditMeta);
  return handleOrgDetail(orgId, response, deps, operator);
}

async function handleSuspendOrg(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "super_admin", response)) {
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  const body = asRecord(parsed.body);
  const reason = String(body.reason ?? "").trim();
  const confirmName = String(body.confirmName ?? "").trim();
  if (!reason) {
    writeJson(response, 400, { error: "reason_required" });
    return true;
  }
  if (confirmName !== org.name) {
    writeJson(response, 400, { error: "confirm_name_mismatch", message: "Type the exact organization name to confirm." });
    return true;
  }

  await deps.orgStore!.suspendOrganization(orgId, reason);
  await operatorAudit(deps, operator, "operator.org.suspend", orgId, { reason });
  writeJson(response, 200, { ok: true, orgId, operatorStatus: "suspended" });
  return true;
}

async function handleActivateOrg(
  orgId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "super_admin", response)) {
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  await deps.orgStore!.activateOrganization(orgId);
  await operatorAudit(deps, operator, "operator.org.activate", orgId);
  writeJson(response, 200, { ok: true, orgId, operatorStatus: "active" });
  return true;
}

async function handleListUsers(
  orgId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }
  if (!deps.userStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }

  const users = await deps.userStore.listOrgUsers(orgId);
  writeJson(response, 200, {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      active: !user.deactivatedAt,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt
    }))
  });
  return true;
}

async function handleInviteUser(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }
  if (!deps.userStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }

  const body = asRecord(parsed.body);
  const email = String(body.email ?? "").trim();
  const role = String(body.role ?? "member").toLowerCase() as "admin" | "member";
  if (!email) {
    writeJson(response, 400, { error: "email is required" });
    return true;
  }

  try {
    const result = await inviteOrgUser(
      { orgStore: deps.orgStore!, userStore: deps.userStore, authTokenStore: deps.authTokenStore },
      { orgId, email, role, invitedByEmail: operator.email }
    );
    const inviteLink = result.inviteToken
      ? adminPortalAcceptInviteUrl(loadBillingConfig().adminPortalUrl, result.inviteToken)
      : undefined;
    await operatorAudit(deps, operator, "operator.user.invite", orgId, {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role
    });
    writeJson(response, 201, { ...result, inviteLink });
  } catch (error) {
    if (isSeatLimitError(error)) {
      writeJson(response, 403, { error: error.code, seats: error.seats, used: error.used });
      return true;
    }
    throw error;
  }
  return true;
}

async function handleResendInvite(
  orgId: string,
  userId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }
  if (!deps.userStore || !deps.authTokenStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }

  const user = await deps.userStore.getUser(userId);
  if (!user || user.orgId !== orgId) {
    writeJson(response, 404, { error: "user not found" });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  const billingConfig = loadBillingConfig();
  const inviteToken = await deps.authTokenStore.createToken(
    user.id,
    "user_invite",
    7 * 24 * 60 * 60 * 1000,
    { orgName: org?.name, invitedBy: operator.email }
  );
  try {
    await deps.emailService?.sendInvite({
      to: user.email,
      orgName: org?.name ?? "your organization",
      acceptInviteUrl: adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken),
      invitedBy: operator.email
    });
  } catch (error) {
    console.warn("[operator] resend invite email failed:", error);
    writeJson(response, 502, { error: "email_failed" });
    return true;
  }

  await operatorAudit(deps, operator, "operator.user.resend_invite", orgId, { userId });
  writeJson(response, 200, {
    ok: true,
    userId,
    inviteToken,
    inviteLink: adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken)
  });
  return true;
}

async function handleListApiKeys(
  orgId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }
  const keys = await deps.orgStore!.listApiKeys(orgId);
  writeJson(response, 200, {
    apiKeys: keys.map((key) => ({
      id: key.id,
      label: key.label,
      createdAt: key.createdAt,
      lastUsed: key.lastUsed ?? null
    }))
  });
  return true;
}

async function handleCreateApiKey(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }
  const body = asRecord(parsed.body);
  const label = String(body.label ?? "operator-created").trim() || "operator-created";
  const { record, rawKey } = await deps.orgStore!.createApiKey(orgId, label);
  await operatorAudit(deps, operator, "operator.api_key.create", orgId, { keyId: record.id, label });
  writeJson(response, 201, {
    apiKey: { id: record.id, label: record.label, createdAt: record.createdAt, rawKey }
  });
  return true;
}

async function handleRevokeApiKey(
  orgId: string,
  keyId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }
  const revoked = await deps.orgStore!.revokeApiKey(orgId, keyId);
  if (!revoked) {
    writeJson(response, 404, { error: "api key not found" });
    return true;
  }
  await operatorAudit(deps, operator, "operator.api_key.revoke", orgId, { keyId });
  writeJson(response, 200, { ok: true, keyId });
  return true;
}

async function handleRevokeAllApiKeys(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "super_admin", response)) {
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  const body = asRecord(parsed.body);
  const confirmName = String(body.confirmName ?? "").trim();
  if (confirmName !== org.name) {
    writeJson(response, 400, { error: "confirm_name_mismatch", message: "Type the exact organization name to confirm." });
    return true;
  }

  const revokedCount = await deps.orgStore!.revokeAllApiKeys(orgId);
  await operatorAudit(deps, operator, "operator.api_key.revoke_all", orgId, { revokedCount });
  writeJson(response, 200, { ok: true, revokedCount });
  return true;
}

async function handleReindexEstate(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }

  const body = asRecord(parsed.body);
  const includeInFlight = body.includeInFlight === true;
  const repos = await deps.orgStore!.listOrgRepos(orgId);
  const repoIds = repos
    .filter((repo) => repo.lightningEnabled)
    .filter((repo) => {
      if (includeInFlight) {
        return true;
      }
      const status = repo.indexStatus ?? "idle";
      return status !== "indexing" && status !== "queued" && status !== "cloning";
    })
    .map((repo) => repo.repoId);

  const result = await syncOrgCatalog(orgId, repoIds, {
    orgStore: deps.orgStore!,
    jobQueue: deps.jobQueue,
    force: true
  });

  await operatorAudit(deps, operator, "operator.org.reindex_estate", orgId, {
    includeInFlight,
    repoCount: repoIds.length,
    ...result
  });
  writeJson(response, 200, { orgId, includeInFlight, ...result });
  return true;
}

async function handleRepoAccessMode(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "support", response)) {
    return true;
  }

  const body = asRecord(parsed.body);
  const mode = String(body.repoAccessMode ?? "").trim() as OrgRepoAccessMode;
  if (mode !== "all_indexed" && mode !== "per_user") {
    writeJson(response, 400, { error: "invalid_repo_access_mode" });
    return true;
  }

  const org = await deps.orgStore!.updateRepoAccessMode(orgId, mode);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  await operatorAudit(deps, operator, "operator.org.repo_access_mode", orgId, { repoAccessMode: mode });
  writeJson(response, 200, { id: org.id, repoAccessMode: org.repoAccessMode });
  return true;
}

async function handleUpgradePro(
  orgId: string,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "billing", response)) {
    return true;
  }

  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    writeJson(response, 404, { error: "organization not found" });
    return true;
  }

  await deps.orgStore!.setOrganizationPlan(orgId, "pro");
  await deps.orgStore!.updateOrganizationBilling(orgId, { billingStatus: "active" });
  await deps.orgStore!.updateOrgOperatorMetadata(orgId, { provenance: "manual_pro" });
  await operatorAudit(deps, operator, "operator.org.upgrade_pro", orgId);
  writeJson(response, 200, { ok: true, orgId, plan: "pro" });
  return true;
}

async function handleOrgAudit(
  orgId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }

  const limit = Math.min(100, Math.max(1, Number(parsed.query?.get("limit") ?? 50) || 50));
  const cursor = parsed.query?.get("cursor") ?? undefined;
  const customerAudit = deps.auditLogger
    ? await deps.auditLogger.listForOrg(orgId, { limit, cursor })
    : { entries: [] };

  writeJson(response, 200, {
    customerAudit,
    operatorAudit: await deps.operatorStore!.listAuditForOrg(orgId, { limit, cursor })
  });
  return true;
}

async function handlePlatformActivity(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OperatorApiDeps,
  operator: OperatorContext
): Promise<boolean> {
  if (!requireOperatorRole(operator, "viewer", response)) {
    return true;
  }

  const limit = Math.min(100, Math.max(1, Number(parsed.query?.get("limit") ?? 50) || 50));
  const cursor = parsed.query?.get("cursor") ?? undefined;
  const feed = await deps.operatorStore!.listPlatformAudit({ limit, cursor });
  writeJson(response, 200, feed);
  return true;
}

async function buildIntegrationSummary(deps: OperatorApiDeps, orgId: string) {
  const installed: string[] = [];
  for (const provider of TRACKED_PROVIDERS) {
    if (provider === "github" || provider === "gitlab" || provider === "bitbucket") {
      const installation = await deps.orgStore!.getCodeHostInstallation(orgId, provider);
      if (installation) {
        installed.push(provider);
      }
      continue;
    }
    const connection = deps.integrationStore
      ? await deps.integrationStore.get(orgId, provider)
      : undefined;
    if (connection) {
      installed.push(provider);
    }
  }
  return {
    installedCount: installed.length,
    totalProviders: TRACKED_PROVIDERS.length,
    installed
  };
}

async function buildIndexingSummary(deps: OperatorApiDeps, orgId: string) {
  const repos = await deps.orgStore!.listOrgRepos(orgId);
  const byStatus: Record<string, number> = {};
  let errors = 0;
  for (const repo of repos) {
    const status = repo.indexStatus ?? "idle";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (repo.error || status === "error") {
      errors += 1;
    }
  }
  return {
    totalRepos: repos.length,
    lightningEnabled: repos.filter((r) => r.lightningEnabled).length,
    byStatus,
    errorCount: errors
  };
}

async function buildStripeDrift(
  deps: OperatorApiDeps,
  coopPlan: OrgPlan,
  billing: Awaited<ReturnType<OrgStore["getOrganizationBilling"]>>
) {
  if (!billing?.stripeSubscriptionId) {
    return {
      hasStripe: Boolean(billing?.stripeCustomerId),
      coopPlan,
      coopSeats: billing?.seatCount ?? 1,
      mismatch: false
    };
  }

  const stripe = new StripeService(loadBillingConfig());
  if (!stripe.isConfigured()) {
    return {
      hasStripe: true,
      coopPlan,
      coopSeats: billing.seatCount,
      mismatch: false,
      stripeUnavailable: true
    };
  }

  try {
    const subscription = await stripe.retrieveSubscription(billing.stripeSubscriptionId);
    const stripeSeats = subscription.quantity ?? billing.seatCount;
    const stripeStatus = subscription.status;
    const mismatch =
      stripeSeats !== billing.seatCount ||
      (stripeStatus === "active" && billing.billingStatus === "past_due");
    return {
      hasStripe: true,
      coopPlan,
      coopSeats: billing.seatCount,
      stripeStatus,
      stripeSeats,
      mismatch
    };
  } catch {
    return {
      hasStripe: true,
      coopPlan,
      coopSeats: billing.seatCount,
      mismatch: false,
      stripeUnavailable: true
    };
  }
}

async function operatorAudit(
  deps: OperatorApiDeps,
  operator: OperatorContext,
  action: string,
  targetOrgId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!deps.operatorStore) {
    throw new Error("operator store not configured");
  }
  await deps.operatorStore.recordAudit({
    operatorId: operator.operatorId,
    action,
    targetOrgId,
    metadata
  });
}

function parseSort(
  value: string | undefined
): "created_desc" | "created_asc" | "name_asc" | "name_desc" | undefined {
  if (
    value === "created_desc" ||
    value === "created_asc" ||
    value === "name_asc" ||
    value === "name_desc"
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
