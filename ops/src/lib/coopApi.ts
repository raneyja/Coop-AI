import type { StoredOperatorMe } from "./auth";
import { restoreSessionFromCookie } from "./auth";

export type ApiError = {
  error?: string;
  message?: string;
};

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  unavailable?: boolean;
};

export type OperatorRole = StoredOperatorMe["role"];
export type OrgPlan = "free" | "pro" | "enterprise";
export type Provenance = "stripe_checkout" | "free_signup" | "manual_enterprise" | "manual_pro";
export type OperatorStatus = "active" | "suspended";
export type RepoAccessMode = "all_indexed" | "per_user";

export type OperatorMe = StoredOperatorMe;

export type EnterpriseLead = {
  id: string;
  orgName: string;
  email: string;
  name: string;
  notes?: string;
  createdAt: string;
};

export type CustomerSummary = {
  id: string;
  name: string;
  plan: OrgPlan;
  billingStatus?: string;
  billingEmail?: string;
  adminEmail?: string;
  seats?: number | null;
  seatsUsed?: number;
  stripeCustomerId?: string;
  operatorStatus?: OperatorStatus;
  provenance?: Provenance;
  onboardingIncomplete?: boolean;
  createdAt?: string;
  attentionFlags?: string[];
};

export type AttentionQueue = {
  enterpriseLeads: EnterpriseLead[];
  pastDue: CustomerSummary[];
  invitePending: Array<{
    orgId: string;
    orgName: string;
    email: string;
    invitedAt: string;
    daysPending: number;
  }>;
  indexingErrors: Array<{
    orgId: string;
    orgName: string;
    errorCount: number;
    lastError?: string;
  }>;
  seatOverage: Array<{
    orgId: string;
    orgName: string;
    seats: number;
    seatsUsed: number;
  }>;
};

export type StripeSnapshot = {
  customerId?: string;
  plan?: string;
  seats?: number | null;
  status?: string;
  managed?: boolean;
};

export type CustomerHealth = {
  integrationsCount?: number;
  indexedRepos?: number;
  indexingErrors?: number;
  lastAdminLogin?: string;
  invitePendingCount?: number;
};

export type CustomerDetail = CustomerSummary & {
  operatorNotes?: string;
  crmExternalId?: string;
  assignee?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  repoAccessMode?: RepoAccessMode;
  stripe?: StripeSnapshot;
  coopBilling?: {
    plan: string;
    seats?: number | null;
    status?: string;
    billingEmail?: string;
  };
  health?: CustomerHealth;
};

export type CustomerUser = {
  id: string;
  email: string;
  role: string;
  status: "active" | "invited" | "deactivated";
  createdAt?: string;
  lastLoginAt?: string;
};

export type CustomerApiKey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type OperatorAuditEntry = {
  id: string;
  action: string;
  operatorEmail?: string;
  operatorId?: string;
  orgId?: string;
  orgName?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type OrgAuditEntry = {
  id: string;
  action: string;
  principal?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ProvisionCustomerInput = {
  name: string;
  plan: OrgPlan;
  seats?: number;
  adminEmail: string;
  sendInvite: boolean;
  createBootstrapKey?: boolean;
  bootstrapKeyLabel?: string;
  operatorNotes?: string;
  crmExternalId?: string;
};

export type ProvisionCustomerResult = {
  organization: CustomerDetail;
  invite?: { email: string; status: string; inviteLink?: string };
  bootstrapKey?: { rawKey: string; label: string; id: string };
};

const DEFAULT_API_BASE = "https://api.coop-ai.dev";

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" ? (value as RawRecord) : {};
}

function normalizeCustomerSummary(raw: RawRecord): CustomerSummary {
  const billing = asRecord(raw.billing);
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    plan: String(raw.plan ?? "free") as OrgPlan,
    billingStatus: String(raw.billingStatus ?? billing.status ?? "none"),
    billingEmail: raw.billingEmail ? String(raw.billingEmail) : billing.email ? String(billing.email) : undefined,
    adminEmail: raw.adminEmail ? String(raw.adminEmail) : undefined,
    seats: raw.seatCount != null ? Number(raw.seatCount) : raw.seats != null ? Number(raw.seats) : undefined,
    seatsUsed: raw.seatsUsed != null ? Number(raw.seatsUsed) : billing.seatsUsed != null ? Number(billing.seatsUsed) : undefined,
    stripeCustomerId: raw.stripeCustomerId
      ? String(raw.stripeCustomerId)
      : billing.stripeCustomerId
        ? String(billing.stripeCustomerId)
        : undefined,
    operatorStatus: raw.operatorStatus ? (String(raw.operatorStatus) as OperatorStatus) : undefined,
    provenance: raw.provenance ? (String(raw.provenance) as Provenance) : undefined,
    onboardingIncomplete:
      raw.onboardingIncomplete === true ||
      (billing.onboardingCompleted === false && raw.onboardingCompleted !== true),
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined
  };
}

function normalizeCustomerDetail(raw: RawRecord): CustomerDetail {
  const billing = asRecord(raw.billing);
  const operator = asRecord(raw.operator);
  const health = asRecord(raw.health);
  const indexingSummary = asRecord(health.indexingSummary);
  const stripeDrift = asRecord(health.stripeDrift);
  const summary = normalizeCustomerSummary({
    ...raw,
    billingStatus: billing.status,
    billingEmail: billing.email,
    seatCount: billing.seatCount,
    seatsUsed: billing.seatsUsed,
    stripeCustomerId: billing.stripeCustomerId,
    onboardingCompleted: billing.onboardingCompleted
  });
  return {
    ...summary,
    operatorNotes: operator.operatorNotes ? String(operator.operatorNotes) : undefined,
    crmExternalId: operator.crmExternalId ? String(operator.crmExternalId) : undefined,
    assignee: operator.assigneeOperatorId ? String(operator.assigneeOperatorId) : undefined,
    suspendedAt: operator.suspendedAt ? String(operator.suspendedAt) : undefined,
    suspendedReason: operator.suspendedReason ? String(operator.suspendedReason) : undefined,
    repoAccessMode: raw.repoAccessMode ? (String(raw.repoAccessMode) as RepoAccessMode) : undefined,
    provenance: operator.provenance ? (String(operator.provenance) as Provenance) : summary.provenance,
    operatorStatus: operator.operatorStatus
      ? (String(operator.operatorStatus) as OperatorStatus)
      : summary.operatorStatus,
    coopBilling: {
      plan: summary.plan,
      seats: billing.seatCount != null ? Number(billing.seatCount) : summary.seats,
      status: String(billing.status ?? "none"),
      billingEmail: billing.email ? String(billing.email) : summary.billingEmail
    },
    stripe: stripeDrift.hasStripe
      ? {
          customerId: billing.stripeCustomerId ? String(billing.stripeCustomerId) : summary.stripeCustomerId,
          plan: summary.plan,
          seats: stripeDrift.stripeSeats != null ? Number(stripeDrift.stripeSeats) : null,
          status: stripeDrift.stripeStatus ? String(stripeDrift.stripeStatus) : undefined,
          managed: Boolean(billing.stripeCustomerId || stripeDrift.hasStripe)
        }
      : billing.stripeCustomerId
        ? {
            customerId: String(billing.stripeCustomerId),
            managed: true
          }
        : undefined,
    health: {
      integrationsCount: health.integrationsCount != null ? Number(health.integrationsCount) : undefined,
      indexedRepos: indexingSummary.lightningEnabled != null ? Number(indexingSummary.lightningEnabled) : undefined,
      indexingErrors: indexingSummary.errorCount != null ? Number(indexingSummary.errorCount) : undefined,
      lastAdminLogin: health.lastAdminLogin ? String(health.lastAdminLogin) : undefined
    }
  };
}

function normalizeAttentionQueue(raw: RawRecord): AttentionQueue {
  const upgradeRequests = (raw.enterpriseUpgradeRequests ?? raw.enterpriseLeads ?? []) as RawRecord[];
  const staleInvites = (raw.staleInvites ?? raw.invitePending ?? []) as RawRecord[];
  const indexingErrorsRaw = (raw.indexingErrors ?? []) as RawRecord[];

  const indexingByOrg = new Map<string, { orgId: string; orgName: string; errorCount: number; lastError?: string }>();
  for (const item of indexingErrorsRaw) {
    const orgId = String(item.orgId ?? "");
    const existing = indexingByOrg.get(orgId);
    const error = item.error ? String(item.error) : item.lastError ? String(item.lastError) : undefined;
    if (existing) {
      existing.errorCount += 1;
      if (error) existing.lastError = error;
    } else {
      indexingByOrg.set(orgId, {
        orgId,
        orgName: String(item.orgName ?? ""),
        errorCount: 1,
        lastError: error
      });
    }
  }

  const seatOverageRaw = (raw.seatOverage ?? []) as RawRecord[];
  return {
    enterpriseLeads: upgradeRequests.map((lead) => ({
      id: String(lead.id ?? ""),
      orgName: String(lead.companyName ?? lead.orgName ?? ""),
      email: String(lead.contactEmail ?? lead.email ?? ""),
      name: String(lead.companyName ?? lead.name ?? ""),
      notes: lead.message ? String(lead.message) : lead.notes ? String(lead.notes) : undefined,
      createdAt: String(lead.createdAt ?? "")
    })),
    pastDue: ((raw.pastDue ?? []) as RawRecord[]).map(normalizeCustomerSummary),
    invitePending: staleInvites.map((item) => {
      const createdAt = String(item.createdAt ?? item.invitedAt ?? "");
      const createdMs = createdAt ? Date.parse(createdAt) : Date.now();
      const daysPending = Math.max(0, Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000)));
      return {
        orgId: String(item.orgId ?? ""),
        orgName: String(item.orgName ?? ""),
        email: String(item.email ?? ""),
        invitedAt: createdAt,
        daysPending
      };
    }),
    indexingErrors: [...indexingByOrg.values()],
    seatOverage: seatOverageRaw.map((item) => ({
      orgId: String(item.orgId ?? item.id ?? ""),
      orgName: String(item.orgName ?? item.name ?? ""),
      seats: Number(item.seats ?? item.seatCount ?? 0),
      seatsUsed: Number(item.seatsUsed ?? 0)
    }))
  };
}

function resolveCoopApiBase(configured: string | undefined): string {
  const trimmed = configured?.trim().replace(/\/$/, "") ?? "";
  if (!trimmed || trimmed.includes("://ops.") || trimmed.includes("://admin.")) {
    return DEFAULT_API_BASE;
  }
  return trimmed;
}

export function getApiBase(): string {
  return resolveCoopApiBase(process.env.NEXT_PUBLIC_COOP_API_BASE);
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("coop_ops_token");
}

function formatError(status: number, body: ApiError | undefined, fallback: string): string {
  if (status === 401) {
    if (body?.error === "unauthorized" || body?.message === "Not signed in.") {
      return "Session expired. Sign in again.";
    }
    return body?.message ?? body?.error ?? "Sign-in failed.";
  }
  if (status === 403) return body?.message ?? body?.error ?? "You do not have permission for this action.";
  if (status === 404) return body?.message ?? body?.error ?? fallback;
  return body?.message ?? body?.error ?? fallback;
}

export async function coopFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  let token = getToken();
  if (!token) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  const run = async (activeToken: string) => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${activeToken}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${getApiBase()}${path}`, { ...options, headers });
    const text = await response.text();
    let body: (T & ApiError) | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as T & ApiError;
      } catch {
        body = undefined;
      }
    }
    return { response, body };
  };

  try {
    let { response, body } = await run(token);

    if (response.status === 401 && typeof window !== "undefined") {
      const restored = await restoreSessionFromCookie();
      const refreshed = getToken();
      if (restored && refreshed && refreshed !== token) {
        token = refreshed;
        ({ response, body } = await run(token));
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, `Request failed (${response.status}).`),
        unavailable: response.status === 404 || response.status === 503
      };
    }

    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export async function validateSession(token: string): Promise<ApiResult<OperatorMe>> {
  const normalized = token.trim();
  if (!normalized) {
    return { ok: false, status: 401, error: "Not signed in." };
  }
  try {
    const response = await fetch(`${getApiBase()}/v1/operator/me`, {
      headers: { Authorization: `Bearer ${normalized}` },
      cache: "no-store"
    });
    const body = (await response.json().catch(() => ({}))) as OperatorMe & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Sign-in validation failed.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export function startGoogleAuthUrl(): string {
  return "/api/auth/google/start";
}

export async function fetchOperatorMe(): Promise<ApiResult<OperatorMe>> {
  return coopFetch<OperatorMe>("/v1/operator/me");
}

export async function fetchAttentionQueue(): Promise<ApiResult<AttentionQueue>> {
  const result = await coopFetch<RawRecord>("/v1/operator/attention-queue");
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: normalizeAttentionQueue(result.data) };
}

export type OrganizationListParams = {
  q?: string;
  plan?: OrgPlan | "";
  billingStatus?: string;
  onboardingIncomplete?: boolean;
  sort?: "name" | "createdAt" | "billingStatus";
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string;
};

export async function fetchOrganizations(
  params: OrganizationListParams = {}
): Promise<ApiResult<{ organizations: CustomerSummary[]; nextCursor?: string; total?: number }>> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set("search", params.q.trim());
  if (params.plan) search.set("plan", params.plan);
  if (params.billingStatus) search.set("billingStatus", params.billingStatus);
  if (params.onboardingIncomplete) search.set("onboardingIncomplete", "true");
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const query = search.toString();
  const result = await coopFetch<{ organizations?: RawRecord[]; total?: number }>(
    `/v1/operator/organizations${query ? `?${query}` : ""}`
  );
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: {
      organizations: (result.data.organizations ?? []).map(normalizeCustomerSummary),
      total: result.data.total
    }
  };
}

export async function fetchOrganization(orgId: string): Promise<ApiResult<CustomerDetail>> {
  const result = await coopFetch<RawRecord>(`/v1/operator/organizations/${encodeURIComponent(orgId)}`);
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
}

export async function provisionOrganization(
  input: ProvisionCustomerInput
): Promise<ApiResult<ProvisionCustomerResult>> {
  const result = await coopFetch<RawRecord>("/v1/operator/organizations", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      plan: input.plan,
      seats: input.seats,
      adminEmail: input.adminEmail,
      sendInvite: input.sendInvite,
      createApiKey: input.createBootstrapKey === true,
      crmExternalId: input.crmExternalId,
      operatorNotes: input.operatorNotes
    })
  });
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const orgRaw = asRecord(result.data.organization);
  const apiKeyRaw = asRecord(result.data.apiKey);
  return {
    ok: true,
    status: result.status,
    data: {
      organization: normalizeCustomerDetail({ ...orgRaw, id: orgRaw.id, name: orgRaw.name, plan: orgRaw.plan }),
      invite: result.data.invite as ProvisionCustomerResult["invite"],
      bootstrapKey: apiKeyRaw.rawKey
        ? {
            rawKey: String(apiKeyRaw.rawKey),
            label: String(apiKeyRaw.label ?? "bootstrap"),
            id: String(apiKeyRaw.id ?? "")
          }
        : undefined
    }
  };
}

export async function updateOrganization(
  orgId: string,
  patch: {
    operatorNotes?: string;
    crmExternalId?: string;
    assignee?: string;
    seats?: number;
    plan?: OrgPlan;
  }
): Promise<ApiResult<CustomerDetail>> {
  const result = await coopFetch<RawRecord>(`/v1/operator/organizations/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      notes: patch.operatorNotes,
      crmExternalId: patch.crmExternalId,
      assigneeOperatorId: patch.assignee,
      seats: patch.seats,
      plan: patch.plan
    })
  });
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
}

export async function suspendOrganization(
  orgId: string,
  input: { confirmName: string; reason?: string }
): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(`/v1/operator/organizations/${encodeURIComponent(orgId)}/suspend`, {
    method: "POST",
    body: JSON.stringify({
      confirmName: input.confirmName.trim(),
      reason: input.reason?.trim() || "Suspended by operator"
    })
  });
}

export async function activateOrganization(orgId: string): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(`/v1/operator/organizations/${encodeURIComponent(orgId)}/activate`, {
    method: "POST",
    body: "{}"
  });
}

export async function inviteOrganizationUser(
  orgId: string,
  email: string,
  role = "admin"
): Promise<ApiResult<{ user: CustomerUser; inviteLink?: string }>> {
  return coopFetch<{ user: CustomerUser; inviteLink?: string }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users/invite`,
    {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), role })
    }
  );
}

export async function resendOrganizationInvite(
  orgId: string,
  userId: string
): Promise<ApiResult<{ inviteLink?: string }>> {
  return coopFetch<{ inviteLink?: string }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/resend-invite`,
    { method: "POST", body: "{}" }
  );
}

export async function fetchOrganizationUsers(
  orgId: string
): Promise<ApiResult<{ users: CustomerUser[] }>> {
  return coopFetch<{ users: CustomerUser[] }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users`
  );
}

export async function fetchOrganizationApiKeys(
  orgId: string
): Promise<ApiResult<{ keys: CustomerApiKey[] }>> {
  const result = await coopFetch<{ keys?: CustomerApiKey[]; apiKeys?: CustomerApiKey[] }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys`
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const raw = result.data?.keys ?? result.data?.apiKeys ?? [];
  return { ok: true, status: result.status, data: { keys: raw } };
}

export async function createOrganizationApiKey(
  orgId: string,
  label: string
): Promise<ApiResult<{ key: CustomerApiKey; rawKey: string }>> {
  const result = await coopFetch<{
    key?: CustomerApiKey;
    rawKey?: string;
    apiKey?: CustomerApiKey & { rawKey?: string };
  }>(`/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys`, {
    method: "POST",
    body: JSON.stringify({ label: label.trim() || "API key" })
  });
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const rawKey = result.data.rawKey ?? result.data.apiKey?.rawKey;
  const key = result.data.key ?? result.data.apiKey;
  if (!rawKey || !key) {
    return { ok: false, status: 502, error: "API key was created but the response was incomplete." };
  }
  return { ok: true, status: result.status, data: { key, rawKey } };
}

export async function revokeOrganizationApiKey(
  orgId: string,
  keyId: string
): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys/${encodeURIComponent(keyId)}`,
    { method: "DELETE" }
  );
}

export async function revokeAllOrganizationApiKeys(
  orgId: string,
  confirmName: string
): Promise<ApiResult<{ revoked: number }>> {
  return coopFetch<{ revoked: number }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys/revoke-all`,
    { method: "POST", body: JSON.stringify({ confirmName: confirmName.trim() }) }
  );
}

export async function reindexOrganizationEstate(
  orgId: string,
  provider = "github"
): Promise<ApiResult<{ discovered: number; queued: number; skipped: number }>> {
  return coopFetch<{ discovered: number; queued: number; skipped: number }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/reindex-estate`,
    { method: "POST", body: JSON.stringify({ provider }) }
  );
}

export async function updateOrganizationRepoAccess(
  orgId: string,
  repoAccessMode: RepoAccessMode
): Promise<ApiResult<CustomerDetail>> {
  const result = await coopFetch<RawRecord>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/repo-access-mode`,
    { method: "PATCH", body: JSON.stringify({ repoAccessMode }) }
  );
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
}

export async function manualProUpgrade(orgId: string): Promise<ApiResult<CustomerDetail>> {
  const result = await coopFetch<RawRecord>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/upgrade-pro`,
    { method: "POST", body: "{}" }
  );
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
}

export async function fetchOrganizationAudit(
  orgId: string,
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: OrgAuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) params.set("cursor", options.cursor);
  return coopFetch<{ entries: OrgAuditEntry[]; nextCursor?: string }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/audit?${params.toString()}`
  );
}

export async function fetchOperatorActivity(
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: OperatorAuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) params.set("cursor", options.cursor);
  return coopFetch<{ entries: OperatorAuditEntry[]; nextCursor?: string }>(
    `/v1/operator/activity?${params.toString()}`
  );
}

export function planLabel(plan: string): string {
  switch (plan) {
    case "enterprise":
      return "Enterprise";
    case "pro":
      return "Pro";
    default:
      return "Free";
  }
}

export function planBadgeClass(plan: string): string {
  switch (plan) {
    case "enterprise":
      return "admin-chip admin-chip--plan-enterprise";
    case "pro":
      return "admin-chip admin-chip--plan-pro";
    default:
      return "admin-chip admin-chip--plan-free";
  }
}

export function provenanceLabel(provenance?: Provenance): string {
  switch (provenance) {
    case "stripe_checkout":
      return "Stripe checkout";
    case "manual_enterprise":
      return "Manual Enterprise";
    case "manual_pro":
      return "Manual Pro";
    case "free_signup":
      return "Free signup";
    default:
      return "Unknown";
  }
}

export function stripeCustomerUrl(customerId: string): string {
  return `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
