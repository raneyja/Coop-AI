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

type BackendCustomerUser = {
  id: string;
  email: string;
  role: string;
  active?: boolean;
  status?: CustomerUser["status"];
  createdAt?: string;
  lastLoginAt?: string | null;
};

function normalizeUser(user: BackendCustomerUser): CustomerUser {
  const status =
    user.status ??
    (user.active === false ? "deactivated" : user.lastLoginAt ? "active" : "invited");
  return {
    id: user.id,
    email: user.email,
    role: user.role === "owner" ? "admin" : user.role,
    status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? undefined
  };
}

type BackendCustomerApiKey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsed?: string | null;
  lastUsedAt?: string | null;
};

function normalizeApiKey(key: BackendCustomerApiKey): CustomerApiKey {
  const lastUsedAt = key.lastUsedAt ?? key.lastUsed ?? undefined;
  return {
    id: key.id,
    label: key.label,
    createdAt: key.createdAt,
    lastUsedAt: lastUsedAt ?? undefined
  };
}

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
const DEFAULT_ADMIN_PORTAL_BASE = "https://admin.coop-ai.dev";

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

function resolveAdminPortalBase(configured: string | undefined): string {
  const trimmed = configured?.trim().replace(/\/+$/, "").replace(/\/login$/, "") ?? "";
  return trimmed || DEFAULT_ADMIN_PORTAL_BASE;
}

function adminPortalAcceptInviteUrl(token: string): string {
  const base = resolveAdminPortalBase(process.env.NEXT_PUBLIC_COOP_ADMIN_PORTAL_URL);
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
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

function mapOrganizationSort(
  sort: OrganizationListParams["sort"],
  order: OrganizationListParams["order"]
): "name_asc" | "name_desc" | "created_asc" | "created_desc" | undefined {
  const normalizedOrder = order === "desc" ? "desc" : "asc";
  if (sort === "name") {
    return normalizedOrder === "desc" ? "name_desc" : "name_asc";
  }
  if (sort === "createdAt") {
    return normalizedOrder === "desc" ? "created_desc" : "created_asc";
  }
  return undefined;
}

export async function fetchOrganizations(
  params: OrganizationListParams = {}
): Promise<ApiResult<{ organizations: CustomerSummary[]; nextCursor?: string; total?: number }>> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set("search", params.q.trim());
  if (params.plan) search.set("plan", params.plan);
  if (params.billingStatus) search.set("billingStatus", params.billingStatus);
  if (params.onboardingIncomplete) search.set("onboardingIncomplete", "true");
  const mappedSort = mapOrganizationSort(params.sort, params.order);
  if (mappedSort) search.set("sort", mappedSort);
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
  const inviteRaw = asRecord(result.data.invite);
  const inviteUserRaw = asRecord(inviteRaw.user);
  const inviteToken =
    typeof inviteRaw.inviteToken === "string" && inviteRaw.inviteToken.trim()
      ? inviteRaw.inviteToken.trim()
      : undefined;
  const inviteLink =
    typeof inviteRaw.inviteLink === "string" && inviteRaw.inviteLink.trim()
      ? inviteRaw.inviteLink.trim()
      : inviteToken
        ? adminPortalAcceptInviteUrl(inviteToken)
        : undefined;
  const inviteStatus = String(inviteRaw.inviteStatus ?? inviteRaw.status ?? "created");
  const inviteEmail =
    typeof inviteRaw.email === "string" && inviteRaw.email.trim()
      ? inviteRaw.email
      : typeof inviteUserRaw.email === "string"
        ? inviteUserRaw.email
        : undefined;
  return {
    ok: true,
    status: result.status,
    data: {
      organization: normalizeCustomerDetail({ ...orgRaw, id: orgRaw.id, name: orgRaw.name, plan: orgRaw.plan }),
      invite: inviteEmail ? { email: inviteEmail, status: inviteStatus, inviteLink } : undefined,
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
  const result = await coopFetch<{
    user?: BackendCustomerUser;
    inviteLink?: string;
    inviteToken?: string;
  }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users/invite`,
    {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), role })
    }
  );
  if (!result.ok || !result.data?.user) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const inviteLink = result.data.inviteLink ?? (result.data.inviteToken ? adminPortalAcceptInviteUrl(result.data.inviteToken) : undefined);
  return {
    ok: true,
    status: result.status,
    data: { user: normalizeUser(result.data.user), inviteLink }
  };
}

export async function resendOrganizationInvite(
  orgId: string,
  userId: string
): Promise<ApiResult<{ inviteLink?: string }>> {
  const result = await coopFetch<{ inviteLink?: string; inviteToken?: string }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/resend-invite`,
    { method: "POST", body: "{}" }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const inviteLink = result.data?.inviteLink ?? (result.data?.inviteToken ? adminPortalAcceptInviteUrl(result.data.inviteToken) : undefined);
  return { ok: true, status: result.status, data: { inviteLink } };
}

export async function fetchOrganizationUsers(
  orgId: string
): Promise<ApiResult<{ users: CustomerUser[] }>> {
  const result = await coopFetch<{ users?: BackendCustomerUser[] }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/users`
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: { users: (result.data?.users ?? []).map(normalizeUser) }
  };
}

export async function fetchOrganizationApiKeys(
  orgId: string
): Promise<ApiResult<{ keys: CustomerApiKey[] }>> {
  const result = await coopFetch<{ keys?: BackendCustomerApiKey[]; apiKeys?: BackendCustomerApiKey[] }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys`
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const raw = result.data?.keys ?? result.data?.apiKeys ?? [];
  return { ok: true, status: result.status, data: { keys: raw.map(normalizeApiKey) } };
}

export async function createOrganizationApiKey(
  orgId: string,
  label: string
): Promise<ApiResult<{ key: CustomerApiKey; rawKey: string }>> {
  const result = await coopFetch<{
    key?: BackendCustomerApiKey;
    rawKey?: string;
    apiKey?: BackendCustomerApiKey & { rawKey?: string };
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
  return { ok: true, status: result.status, data: { key: normalizeApiKey(key), rawKey } };
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
  const result = await coopFetch<{ revoked?: number; revokedCount?: number }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/api-keys/revoke-all`,
    { method: "POST", body: JSON.stringify({ confirmName: confirmName.trim() }) }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: { revoked: Number(result.data?.revoked ?? result.data?.revokedCount ?? 0) }
  };
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
  if (result.data.name && result.data.billing) {
    return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
  }
  return fetchOrganization(
    typeof result.data.orgId === "string"
      ? result.data.orgId
      : typeof result.data.id === "string"
        ? result.data.id
        : orgId
  );
}

export async function manualProUpgrade(orgId: string): Promise<ApiResult<CustomerDetail>> {
  const result = await coopFetch<RawRecord>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/upgrade-pro`,
    { method: "POST", body: "{}" }
  );
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  if (result.data.name && result.data.billing) {
    return { ok: true, status: result.status, data: normalizeCustomerDetail(result.data) };
  }
  return fetchOrganization(
    typeof result.data.orgId === "string"
      ? result.data.orgId
      : typeof result.data.id === "string"
        ? result.data.id
        : orgId
  );
}

function normalizeOrgAuditEntry(raw: RawRecord, source: "customer" | "operator"): OrgAuditEntry {
  const metadata = asRecord(raw.metadata);
  const operatorPrincipal =
    typeof raw.operatorEmail === "string" && raw.operatorEmail
      ? raw.operatorEmail
      : typeof raw.operatorId === "string"
        ? raw.operatorId
        : undefined;
  return {
    id: `${source}:${String(raw.id ?? "")}`,
    action: String(raw.action ?? ""),
    principal: source === "operator" ? operatorPrincipal : raw.principal ? String(raw.principal) : undefined,
    createdAt: String(raw.createdAt ?? ""),
    metadata
  };
}

function mergeAuditCursor(...cursors: Array<string | undefined>): string | undefined {
  const values = cursors.filter((value): value is string => Boolean(value));
  if (values.length === 0) {
    return undefined;
  }
  const numeric = values.map((value) => Number(value));
  if (numeric.every((value) => Number.isFinite(value))) {
    return String(Math.min(...numeric));
  }
  return values[0];
}

export async function fetchOrganizationAudit(
  orgId: string,
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: OrgAuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) params.set("cursor", options.cursor);
  const result = await coopFetch<{
    customerAudit?: { entries?: RawRecord[]; nextCursor?: string };
    operatorAudit?: { entries?: RawRecord[]; nextCursor?: string };
    entries?: RawRecord[];
    nextCursor?: string;
  }>(
    `/v1/operator/organizations/${encodeURIComponent(orgId)}/audit?${params.toString()}`
  );
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  if (Array.isArray(result.data.entries)) {
    return {
      ok: true,
      status: result.status,
      data: {
        entries: result.data.entries.map((entry) => normalizeOrgAuditEntry(asRecord(entry), "customer")),
        nextCursor: result.data.nextCursor
      }
    };
  }

  const customerAudit = asRecord(result.data.customerAudit);
  const operatorAudit = asRecord(result.data.operatorAudit);
  const customerEntries = Array.isArray(customerAudit.entries) ? (customerAudit.entries as RawRecord[]) : [];
  const operatorEntries = Array.isArray(operatorAudit.entries) ? (operatorAudit.entries as RawRecord[]) : [];
  const entries = [
    ...customerEntries.map((entry) => normalizeOrgAuditEntry(asRecord(entry), "customer")),
    ...operatorEntries.map((entry) => normalizeOrgAuditEntry(asRecord(entry), "operator"))
  ].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  const nextCursor = mergeAuditCursor(
    typeof customerAudit.nextCursor === "string" ? customerAudit.nextCursor : undefined,
    typeof operatorAudit.nextCursor === "string" ? operatorAudit.nextCursor : undefined
  );
  return { ok: true, status: result.status, data: { entries, nextCursor } };
}

export async function fetchOperatorActivity(
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: OperatorAuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) params.set("cursor", options.cursor);
  const result = await coopFetch<{ entries?: RawRecord[]; nextCursor?: string }>(
    `/v1/operator/activity?${params.toString()}`
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const entries = (result.data?.entries ?? []).map((entry) => {
    const raw = asRecord(entry);
    return {
      id: String(raw.id ?? ""),
      action: String(raw.action ?? ""),
      operatorEmail: raw.operatorEmail ? String(raw.operatorEmail) : undefined,
      operatorId: raw.operatorId ? String(raw.operatorId) : undefined,
      orgId:
        typeof raw.orgId === "string"
          ? raw.orgId
          : typeof raw.targetOrgId === "string"
            ? raw.targetOrgId
            : undefined,
      orgName: raw.orgName ? String(raw.orgName) : undefined,
      createdAt: String(raw.createdAt ?? ""),
      metadata: asRecord(raw.metadata)
    } satisfies OperatorAuditEntry;
  });
  return { ok: true, status: result.status, data: { entries, nextCursor: result.data?.nextCursor } };
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
