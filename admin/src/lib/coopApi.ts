import type { IntegrationProvider, IntegrationStatus } from "./integrations";
import { INTEGRATIONS } from "./integrations";
import type { StoredMe } from "./auth";

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

export type MeResponse = StoredMe & {
  canUseLightning?: boolean;
  userId?: string;
  authMethod?: "api_key" | "sso_session";
};

export type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: "active" | "invited" | "deactivated";
  createdAt?: string;
};

type BackendUser = {
  id: string;
  email: string;
  role: string;
  active?: boolean;
  status?: AdminUser["status"];
  createdAt?: string;
};

function normalizeUser(user: BackendUser): AdminUser {
  const status =
    user.status ??
    (user.active === false ? "deactivated" : "active");
  return { id: user.id, email: user.email, role: user.role, status, createdAt: user.createdAt };
}

export type AdminApiKey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

type BackendApiKey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsed?: string | null;
  lastUsedAt?: string | null;
};

function normalizeApiKey(key: BackendApiKey): AdminApiKey {
  const lastUsed = key.lastUsedAt ?? key.lastUsed ?? undefined;
  return {
    id: key.id,
    label: key.label,
    createdAt: key.createdAt,
    lastUsedAt: lastUsed ?? undefined
  };
}

type BackendIntegrationStatus = {
  provider: IntegrationProvider;
  installed: boolean;
  detail?: string;
  metadata?: Record<string, unknown>;
};

function integrationDetail(raw: BackendIntegrationStatus): string | undefined {
  if (raw.detail?.trim()) return raw.detail.trim();
  const metadata = raw.metadata;
  if (!metadata) return undefined;
  for (const key of ["teamName", "siteName", "workspaceName", "displayName"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeIntegrationStatus(raw: BackendIntegrationStatus): IntegrationStatus {
  return {
    provider: raw.provider,
    installed: raw.installed,
    detail: integrationDetail(raw)
  };
}

const DEFAULT_API_BASE = "https://api.coop-ai.dev";

export function getApiBase(): string {
  const base = process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() || DEFAULT_API_BASE;
  return base.replace(/\/$/, "");
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("coop_admin_api_token");
}

function formatError(status: number, body: ApiError | undefined, fallback: string): string {
  if (status === 401) return "Invalid API key. Check that your key starts with coop_ and has not been revoked.";
  if (status === 403) return body?.message ?? body?.error ?? "You do not have permission for this action.";
  if (status === 404) return fallback;
  return body?.message ?? body?.error ?? fallback;
}

export async function coopFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const token = getToken();
  if (!token) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
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

export async function validateApiKey(token: string): Promise<ApiResult<MeResponse>> {
  try {
    const response = await fetch(`${getApiBase()}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await response.json().catch(() => ({}))) as MeResponse & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Invalid API key.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

async function fetchIntegrationStatus(provider: IntegrationProvider): Promise<IntegrationStatus> {
  const result = await coopFetch<{ installed: boolean; teamName?: string; siteName?: string; workspaceName?: string; displayName?: string }>(
    `/v1/orgs/${provider}/installation`
  );

  if (!result.ok) {
    return {
      provider,
      installed: false,
      detail: result.unavailable ? undefined : result.error
    };
  }

  const installed = Boolean(result.data?.installed);
  const detail =
    result.data?.teamName ??
    result.data?.siteName ??
    result.data?.workspaceName ??
    result.data?.displayName;

  return { provider, installed, detail };
}

export async function fetchIntegrations(): Promise<ApiResult<IntegrationStatus[]>> {
  const bulk = await coopFetch<{ integrations?: BackendIntegrationStatus[] }>("/v1/admin/integrations");
  if (bulk.ok && bulk.data?.integrations) {
    return {
      ok: true,
      status: bulk.status,
      data: bulk.data.integrations.map(normalizeIntegrationStatus)
    };
  }

  if (bulk.status !== 404 && bulk.status !== 503 && !bulk.ok) {
    return { ok: false, status: bulk.status, error: bulk.error };
  }

  const statuses = await Promise.all(INTEGRATIONS.map((i) => fetchIntegrationStatus(i.id)));
  return { ok: true, status: 200, data: statuses };
}

export async function fetchInstallUrl(provider: IntegrationProvider): Promise<ApiResult<{ url: string }>> {
  const result = await coopFetch<{ url: string }>(`/v1/${provider}/app/install-url`);
  if (!result.ok) return result;
  const url = result.data?.url?.trim();
  if (!url) {
    return { ok: false, status: 502, error: "Install URL was not returned by the server." };
  }
  return { ok: true, status: result.status, data: { url } };
}

export async function fetchUsers(): Promise<ApiResult<{ users: AdminUser[] }>> {
  const result = await coopFetch<{ users: BackendUser[] }>("/v1/admin/users");
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: { users: (result.data?.users ?? []).map(normalizeUser) }
  };
}

export async function inviteUser(email: string, role: string): Promise<ApiResult<{ user: AdminUser }>> {
  const result = await coopFetch<{ user: BackendUser }>("/v1/admin/users/invite", {
    method: "POST",
    body: JSON.stringify({ email, role })
  });
  if (!result.ok || !result.data?.user) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { user: normalizeUser(result.data.user) } };
}

export async function updateUser(
  userId: string,
  patch: { role?: string; status?: "active" | "deactivated" }
): Promise<ApiResult<{ user: AdminUser }>> {
  const body: { role?: string; active?: boolean } = {};
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.status === "deactivated") body.active = false;

  const result = await coopFetch<{ user: BackendUser }>(`/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (!result.ok || !result.data?.user) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { user: normalizeUser(result.data.user) } };
}

export async function fetchApiKeys(): Promise<ApiResult<{ keys: AdminApiKey[] }>> {
  const result = await coopFetch<{ keys?: BackendApiKey[]; apiKeys?: BackendApiKey[] }>("/v1/admin/api-keys");
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const raw = result.data?.keys ?? result.data?.apiKeys ?? [];
  return { ok: true, status: result.status, data: { keys: raw.map(normalizeApiKey) } };
}

export async function createApiKey(label: string): Promise<ApiResult<{ key: AdminApiKey; rawKey: string }>> {
  const result = await coopFetch<{
    key?: AdminApiKey;
    rawKey?: string;
    apiKey?: AdminApiKey & { rawKey?: string };
  }>("/v1/admin/api-keys", {
    method: "POST",
    body: JSON.stringify({ label })
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

export async function revokeApiKey(keyId: string): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(`/v1/admin/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE"
  });
}

export type OrgSummary = {
  id: string;
  name: string;
  plan: string;
  onboardingCompleted?: boolean;
  memberCount?: number;
};

export async function fetchOrg(): Promise<ApiResult<OrgSummary>> {
  return coopFetch<OrgSummary>("/v1/admin/org");
}

export async function completeOnboarding(): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>("/v1/admin/onboarding/complete", { method: "POST" });
}

export async function disconnectIntegration(provider: string): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(`/v1/admin/integrations/${encodeURIComponent(provider)}`, {
    method: "DELETE"
  });
}

export type BillingInfo = {
  plan: string;
  seats: number | null;
  status: string;
  billingEmail?: string;
  hasStripeCustomer?: boolean;
};

export async function fetchBilling(): Promise<ApiResult<BillingInfo>> {
  return coopFetch<BillingInfo>("/v1/admin/billing");
}

export async function openBillingPortal(): Promise<ApiResult<{ url: string }>> {
  return coopFetch<{ url: string }>("/v1/admin/billing/portal-session", { method: "POST" });
}

export type AuditEntry = {
  id: string;
  action: string;
  principal?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export async function fetchAudit(
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: AuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  return coopFetch<{ entries: AuditEntry[]; nextCursor?: string }>(`/v1/admin/audit?${params.toString()}`);
}

export function ssoStartUrl(orgName: string): string {
  const redirect = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : "";
  const params = new URLSearchParams({ org: orgName, redirect });
  return `${getApiBase()}/v1/auth/saml/start?${params.toString()}`;
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
      return "border-coop-border bg-coop-surface text-white/80";
    case "pro":
      return "bg-coop-index/15 text-coop-index border-coop-index/30";
    default:
      return "bg-coop-border/40 text-coop-muted border-coop-border";
  }
}

export type AnalyticsRange = "7d" | "30d" | "90d";

export type AnalyticsOverview = {
  totalUsers: number;
  activeUsers: number;
  seats: number;
  seatUtilization: number;
  dau: number;
  mau: number;
  totalEvents: number;
  eventsByDay: Array<{ day: string; count: number }>;
};

export type AnalyticsChat = {
  chatMessages: number;
  quickActions: Array<{ eventType: string; count: number }>;
  eventsByDay: Array<{ day: string; count: number }>;
  topUsers: Array<{ principal: string; count: number }>;
};

export function analyticsRangeParams(range: AnalyticsRange): { from: string; to: string } {
  const to = new Date();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function analyticsQuery(from: string, to: string): string {
  return `?${new URLSearchParams({ from, to }).toString()}`;
}

export async function fetchAnalyticsOverview(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsOverview>> {
  return coopFetch<AnalyticsOverview>(`/v1/admin/analytics/overview${analyticsQuery(from, to)}`);
}

export async function fetchAnalyticsChat(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsChat>> {
  return coopFetch<AnalyticsChat>(`/v1/admin/analytics/chat${analyticsQuery(from, to)}`);
}

export type AnalyticsCompletions = {
  suggested: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number | null;
  eventsByDay: Array<{ day: string; count: number }>;
};

export async function fetchAnalyticsCompletions(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsCompletions>> {
  return coopFetch<AnalyticsCompletions>(`/v1/admin/analytics/completions${analyticsQuery(from, to)}`);
}

export type OrgRepoRecord = {
  repoId: string;
  lightningEnabled?: boolean;
  indexStatus?: string;
  lastIndexedAt?: string;
};

export type AdminCollection = {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  createdAt: string;
  repos: Array<{ collectionId: string; repoId: string; addedAt: string }>;
};

export async function fetchOrgRepos(): Promise<ApiResult<{ repos: OrgRepoRecord[] }>> {
  const result = await coopFetch<{ repos: OrgRepoRecord[] }>("/v1/orgs/repos");
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { repos: result.data?.repos ?? [] } };
}

export async function fetchCollections(): Promise<ApiResult<{ collections: AdminCollection[] }>> {
  const result = await coopFetch<{ collections: AdminCollection[] }>("/v1/collections");
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { collections: result.data?.collections ?? [] } };
}

export async function createCollection(
  name: string,
  description?: string
): Promise<ApiResult<{ collection: AdminCollection }>> {
  const result = await coopFetch<{ collection: AdminCollection }>("/v1/collections", {
    method: "POST",
    body: JSON.stringify({ name, description })
  });
  if (!result.ok || !result.data?.collection) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { collection: result.data.collection } };
}

export async function addRepoToCollection(
  collectionId: string,
  repoId: string
): Promise<ApiResult<{ repo: { collectionId: string; repoId: string; addedAt: string } }>> {
  const result = await coopFetch<{ repo: { collectionId: string; repoId: string; addedAt: string } }>(
    `/v1/collections/${encodeURIComponent(collectionId)}/repos`,
    {
      method: "POST",
      body: JSON.stringify({ repoId })
    }
  );
  if (!result.ok || !result.data?.repo) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { repo: result.data.repo } };
}

export async function removeRepoFromCollection(
  collectionId: string,
  repoId: string
): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(
    `/v1/collections/${encodeURIComponent(collectionId)}/repos/${encodeURIComponent(repoId)}`,
    { method: "DELETE" }
  );
}

export async function exportAnalyticsCsv(from: string, to: string): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
  if (!token) {
    return { ok: false, error: "Not signed in." };
  }

  try {
    const response = await fetch(
      `${getApiBase()}/v1/admin/analytics/export.csv${analyticsQuery(from, to)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = `Export failed (${response.status}).`;
      try {
        const body = JSON.parse(text) as ApiError;
        message = body.message ?? body.error ?? message;
      } catch {
        // keep default message
      }
      return { ok: false, error: message };
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "coop-usage-export.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not download export. Check your network and API base URL." };
  }
}
