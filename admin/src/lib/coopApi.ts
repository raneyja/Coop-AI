import type { CodeHostProvider, IntegrationProvider, IntegrationStatus } from "./integrations";
import { INTEGRATIONS } from "./integrations";
import type {
  IntegrationResource,
  IntegrationScopeResponse,
  AtlassianScopePolicy,
  GoogleDocsScopePolicy,
  NotionScopePolicy,
  SlackScopePolicy
} from "./integrations";
import type { StoredMe } from "./auth";
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

export type MeResponse = StoredMe & {
  canUseLightning?: boolean;
  userId?: string;
  isSignedIn?: boolean;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  email: string;
  orgName: string;
  plan: string;
  authMethod?: MeResponse["authMethod"];
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
  const role = user.role === "owner" ? "admin" : user.role;
  return { id: user.id, email: user.email, role, status, createdAt: user.createdAt };
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
  needsReconnect?: boolean;
  scopeNeedsReconnect?: boolean;
  detail?: string;
  scopeStatus?: IntegrationStatus["scopeStatus"];
  scopeSummary?: string;
  liveTestOk?: boolean;
  liveTestMessage?: string;
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
  const detail =
    integrationDetail(raw) ??
    (raw.liveTestOk === false && raw.liveTestMessage ? raw.liveTestMessage : undefined);
  return {
    provider: raw.provider,
    installed: raw.installed,
    needsReconnect: raw.needsReconnect ?? (raw.liveTestOk === false),
    scopeNeedsReconnect: raw.scopeNeedsReconnect,
    detail,
    scopeStatus: raw.scopeStatus,
    scopeSummary: raw.scopeSummary,
    connectionKind:
      raw.metadata?.connectionKind === "oauth" || raw.metadata?.connectionKind === "github_app"
        ? raw.metadata.connectionKind
        : undefined
  };
}

const DEFAULT_API_BASE = "https://api.coop-ai.dev";

function resolveCoopApiBase(configured: string | undefined): string {
  const trimmed = configured?.trim().replace(/\/$/, "") ?? "";
  if (!trimmed || trimmed.includes("://admin.")) {
    return DEFAULT_API_BASE;
  }
  return trimmed;
}

export function getApiBase(): string {
  return resolveCoopApiBase(process.env.NEXT_PUBLIC_COOP_API_BASE);
}

export function normalizeApiKeyInput(value: string): string {
  return value.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("coop_admin_api_token");
}

function formatError(status: number, body: ApiError | undefined, fallback: string): string {
  if (status === 401) {
    if (body?.error === "unauthorized" || body?.message === "Not signed in.") {
      return "Session expired. Sign in again to connect integrations.";
    }
    return body?.message ?? body?.error ?? "Sign-in failed. Check your credentials and try again.";
  }
  if (status === 403) return body?.message ?? body?.error ?? "You do not have permission for this action.";
  if (status === 404) return fallback;
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

export async function validateSession(token: string): Promise<ApiResult<MeResponse>> {
  const normalized = normalizeApiKeyInput(token);
  if (!normalized) {
    return { ok: false, status: 401, error: "Not signed in." };
  }
  try {
    const response = await fetch("/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: normalized, token: normalized })
    });
    const body = (await response.json().catch(() => ({}))) as MeResponse & ApiError;
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

/** @deprecated Use validateSession */
export const validateApiKey = validateSession;

export async function loginWithPassword(
  email: string,
  password: string
): Promise<ApiResult<LoginResponse & MeResponse>> {
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password })
    });
    const body = (await response.json().catch(() => ({}))) as LoginResponse & MeResponse & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Sign-in failed.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export async function requestPasswordReset(email: string): Promise<ApiResult<{ ok: boolean; message?: string }>> {
  try {
    const response = await fetch(`${getApiBase()}/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() })
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string } & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Could not send reset email.")
      };
    }
    return { ok: true, status: response.status, data: { ok: Boolean(body.ok ?? true), message: body.message } };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export type InvitePreviewResponse = {
  email?: string;
  orgName?: string;
  invitedBy?: string;
  /** Present when the invite was minted from Pro checkout (activate account). */
  source?: string;
};

export async function fetchInvitePreview(token: string): Promise<ApiResult<InvitePreviewResponse>> {
  try {
    const response = await fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token.trim())}`, {
      cache: "no-store"
    });
    const body = (await response.json().catch(() => ({}))) as InvitePreviewResponse & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "This invitation link is invalid or has expired.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export async function acceptInviteWithPassword(
  token: string,
  password: string,
  profile: { firstName: string; lastName: string; timezone: string }
): Promise<ApiResult<LoginResponse & MeResponse>> {
  try {
    const response = await fetch("/api/auth/accept-invite", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token.trim(),
        password,
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        timezone: profile.timezone.trim()
      })
    });
    const body = (await response.json().catch(() => ({}))) as LoginResponse & MeResponse & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Could not accept your invitation.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export async function registerWithPassword(
  email: string,
  password: string,
  orgName?: string
): Promise<ApiResult<LoginResponse & MeResponse>> {
  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        orgName: orgName?.trim() || undefined
      })
    });
    const body = (await response.json().catch(() => ({}))) as LoginResponse & MeResponse & ApiError;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body, "Could not create your account.")
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export function startGoogleAuthUrl(
  mode: "login" | "signup" | "invite" = "login",
  orgNameOrOptions?:
    | string
    | {
        orgName?: string;
        inviteToken?: string;
        firstName?: string;
        lastName?: string;
        timezone?: string;
      }
): string {
  const options =
    typeof orgNameOrOptions === "string" ? { orgName: orgNameOrOptions } : (orgNameOrOptions ?? {});
  const params = new URLSearchParams({ mode });
  if (options.orgName?.trim()) {
    params.set("orgName", options.orgName.trim());
  }
  if (mode === "invite" && options.inviteToken?.trim()) {
    params.set("inviteToken", options.inviteToken.trim());
  }
  if (options.firstName?.trim()) {
    params.set("firstName", options.firstName.trim());
  }
  if (options.lastName?.trim()) {
    params.set("lastName", options.lastName.trim());
  }
  if (options.timezone?.trim()) {
    params.set("timezone", options.timezone.trim());
  }
  return `/api/auth/google/start?${params.toString()}`;
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

async function fetchWithSessionRetry(
  input: string,
  init: RequestInit
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const token = getToken();
  if (!token) {
    return {
      response: new Response(null, { status: 401 }),
      body: { error: "unauthorized", message: "Not signed in." }
    };
  }

  const run = async (activeToken: string) => {
    const response = await fetch(input, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${activeToken}` },
      cache: "no-store"
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { response, body };
  };

  let result = await run(token);
  if (result.response.status === 401 && typeof window !== "undefined") {
    const restored = await restoreSessionFromCookie();
    const refreshed = getToken();
    if (restored && refreshed && refreshed !== token) {
      result = await run(refreshed);
    }
  }
  return result;
}

export async function fetchIntegrations(options?: {
  refresh?: boolean;
}): Promise<ApiResult<IntegrationStatus[]>> {
  const token = getToken();
  if (!token) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  const refreshSuffix = options?.refresh ? "?refresh=true" : "";

  try {
    const { response, body } = await fetchWithSessionRetry(`/api/integrations${refreshSuffix}`, {
      method: "GET"
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body as ApiError, `Request failed (${response.status}).`)
      };
    }

    if (Array.isArray(body.integrations)) {
      return {
        ok: true,
        status: response.status,
        data: (body.integrations as BackendIntegrationStatus[]).map(normalizeIntegrationStatus)
      };
    }
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }

  const statuses = await Promise.all(INTEGRATIONS.map((i) => fetchIntegrationStatus(i.id)));
  return { ok: true, status: 200, data: statuses };
}

export async function fetchInstallUrl(
  provider: IntegrationProvider,
  options?: { mode?: "app" | "oauth" }
): Promise<
  ApiResult<{
    url?: string;
    connected?: boolean;
    relinked?: boolean;
    reconnect?: boolean;
    reconnectMessage?: string;
    workspaceName?: string;
    kind?: "github_app" | "oauth";
    oauthAvailable?: boolean;
    githubAppAvailable?: boolean;
  }>
> {
  const token = getToken();
  if (!token) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  const query = options?.mode ? `?mode=${encodeURIComponent(options.mode)}` : "";

  try {
    const { response, body } = await fetchWithSessionRetry(`/api/install-url/${provider}${query}`, {
      method: "GET"
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body as ApiError, `Request failed (${response.status}).`)
      };
    }
    if (body.connected) {
      return {
        ok: true,
        status: response.status,
        data: {
          connected: true,
          relinked: body.relinked === true,
          workspaceName: body.workspaceName as string | undefined
        }
      };
    }
    if (!body.url) {
      return {
        ok: false,
        status: response.status,
        error: formatError(response.status, body as ApiError, `Request failed (${response.status}).`)
      };
    }
    return {
      ok: true,
      status: response.status,
      data: {
        url: String(body.url).trim(),
        kind: body.kind === "oauth" || body.kind === "github_app" ? body.kind : undefined,
        oauthAvailable: body.oauthAvailable === true,
        githubAppAvailable: body.githubAppAvailable === true,
        reconnect: body.reconnect === true,
        reconnectMessage: typeof body.reconnectMessage === "string" ? body.reconnectMessage : undefined
      }
    };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API. Check your network and API base URL." };
  }
}

export type UsersListResponse = {
  users: AdminUser[];
  /** Purchased seats (Stripe/Coop). */
  seats: number;
  /** Active + invited users occupying seats. */
  seatsUsed: number;
};

export async function fetchUsers(): Promise<ApiResult<UsersListResponse>> {
  const result = await coopFetch<{
    users: BackendUser[];
    seats?: number;
    seatsUsed?: number;
  }>("/v1/admin/users");
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  const seats = Math.max(1, Math.floor(Number(result.data?.seats ?? 1) || 1));
  const seatsUsed = Math.max(0, Math.floor(Number(result.data?.seatsUsed ?? 0) || 0));
  return {
    ok: true,
    status: result.status,
    data: {
      users: (result.data?.users ?? []).map(normalizeUser),
      seats,
      seatsUsed
    }
  };
}

export async function inviteUser(
  email: string,
  role: string,
  repoIds?: string[]
): Promise<ApiResult<{ user: AdminUser }>> {
  const result = await coopFetch<{ user: BackendUser }>("/v1/admin/users/invite", {
    method: "POST",
    body: JSON.stringify({
      email,
      role,
      ...(repoIds && repoIds.length > 0 ? { repoIds } : {})
    })
  });
  if (!result.ok || !result.data?.user) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: { user: normalizeUser(result.data.user) } };
}

export async function fetchUserRepoGrants(
  userId: string
): Promise<ApiResult<{ userId: string; repoIds: string[] }>> {
  return coopFetch<{ userId: string; repoIds: string[] }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/repo-grants`
  );
}

export async function saveUserRepoGrants(
  userId: string,
  repoIds: string[]
): Promise<ApiResult<{ userId: string; repoIds: string[] }>> {
  return coopFetch<{ userId: string; repoIds: string[] }>(
    `/v1/admin/users/${encodeURIComponent(userId)}/repo-grants`,
    {
      method: "PUT",
      body: JSON.stringify({ repoIds })
    }
  );
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
  repoAccessMode?: "all_indexed" | "per_user";
  onboardingCompleted?: boolean;
  memberCount?: number;
};

export type OrgRepoAccessMode = "all_indexed" | "per_user";

export async function fetchOrg(): Promise<ApiResult<OrgSummary>> {
  return coopFetch<OrgSummary>("/v1/admin/org");
}

export async function updateRepoAccessMode(
  repoAccessMode: OrgRepoAccessMode
): Promise<ApiResult<OrgSummary>> {
  return coopFetch<OrgSummary>("/v1/admin/org/repo-access", {
    method: "PATCH",
    body: JSON.stringify({ repoAccessMode })
  });
}

export async function completeOnboarding(): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>("/v1/admin/onboarding/complete", { method: "POST" });
}

export async function fetchMe(): Promise<ApiResult<MeResponse>> {
  return coopFetch<MeResponse>("/v1/me");
}

export async function completeMemberOnboarding(): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>("/v1/me/onboarding/complete", { method: "POST" });
}

export type WorkspaceRepo = {
  repoId: string;
  owner: string;
  name: string;
  indexStatus?: string;
  lightningEnabled?: boolean;
  isPrimary?: boolean;
};

export type WorkspaceReposResponse = {
  repos: WorkspaceRepo[];
  selectedCount: number;
  limit: number | null;
  canAddMore: boolean;
  primaryRepoId?: string;
  repoAccessMode?: "all_indexed" | "per_user";
  adminControlled?: boolean;
};

export async function fetchMeWorkspaceRepos(): Promise<ApiResult<WorkspaceReposResponse>> {
  return coopFetch<WorkspaceReposResponse>("/v1/me/workspace-repos");
}

export type IntegrationHealthValue =
  | "not_connected"
  | "not_configured"
  | "scope_required"
  | "degraded"
  | "healthy";

export type IntegrationHealthEntry = {
  provider: IntegrationProvider;
  installed: boolean;
  health: IntegrationHealthValue;
  message?: string;
  scopeStatus?: IntegrationStatus["scopeStatus"];
  configured: boolean;
};

export type IntegrationsHealthResponse = {
  orgPlan: string;
  onboardingGates: {
    githubOrToolConnected: boolean;
    scopableToolsActive: boolean;
    canCompleteOnboarding: boolean;
  };
  integrations: IntegrationHealthEntry[];
};

export async function fetchIntegrationsHealth(
  refresh = false
): Promise<ApiResult<IntegrationsHealthResponse>> {
  const suffix = refresh ? "?refresh=true" : "";
  return coopFetch<IntegrationsHealthResponse>(`/v1/admin/integrations/health${suffix}`);
}

export async function disconnectIntegration(provider: string): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>(`/v1/admin/integrations/${encodeURIComponent(provider)}`, {
    method: "DELETE"
  });
}

export async function fetchIntegrationScope(
  provider: IntegrationProvider
): Promise<ApiResult<IntegrationScopeResponse>> {
  return coopFetch<IntegrationScopeResponse>(
    `/v1/admin/integrations/${encodeURIComponent(provider)}/scope`
  );
}

export async function saveIntegrationScope(
  provider: IntegrationProvider,
  policy: SlackScopePolicy | AtlassianScopePolicy | NotionScopePolicy | GoogleDocsScopePolicy
): Promise<ApiResult<IntegrationScopeResponse>> {
  return coopFetch<IntegrationScopeResponse>(
    `/v1/admin/integrations/${encodeURIComponent(provider)}/scope`,
    {
      method: "PUT",
      body: JSON.stringify({ policy })
    }
  );
}

export async function fetchIntegrationResources(
  provider: IntegrationProvider,
  query?: string,
  product?: "jira" | "confluence"
): Promise<ApiResult<{ provider: string; resources: IntegrationResource[]; comingSoon?: boolean }>> {
  const params = new URLSearchParams();
  if (query?.trim()) {
    params.set("q", query.trim());
  }
  if (product) {
    params.set("product", product);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return coopFetch<{ provider: string; resources: IntegrationResource[]; comingSoon?: boolean }>(
    `/v1/admin/integrations/${encodeURIComponent(provider)}/resources${suffix}`
  );
}

export async function testIntegrationScope(
  provider: IntegrationProvider
): Promise<ApiResult<{ ok: boolean; message: string }>> {
  return coopFetch<{ ok: boolean; message: string }>(
    `/v1/admin/integrations/${encodeURIComponent(provider)}/test`,
    { method: "POST", body: "{}" }
  );
}

export type BillingInfo = {
  plan: string;
  seats: number | null;
  /** Stripe subscription quantity when available (may briefly differ from Coop seats). */
  stripeSeats?: number | null;
  status: string;
  billingEmail?: string;
  hasStripeCustomer?: boolean;
};

export type QuotaSnapshot = {
  plan: string;
  unlimited?: boolean;
  usedTokens?: number;
  limitTokens?: number;
  remainingTokens?: number;
  usedCredits?: number;
  limitCredits?: number;
  remainingCredits?: number;
  windowHours?: number;
  resetsAt?: string;
  retryAfterMs?: number;
};

export async function fetchQuota(): Promise<ApiResult<QuotaSnapshot>> {
  const result = await coopFetch<QuotaSnapshot>("/v1/admin/quota");
  if (!result.ok) {
    return result;
  }

  const data = result.data;
  const plan = typeof data?.plan === "string" && data.plan.trim() ? data.plan.trim() : "free";
  const usedCredits =
    typeof data?.usedCredits === "number" && Number.isFinite(data.usedCredits)
      ? Math.max(0, data.usedCredits)
      : undefined;
  const limitCredits =
    typeof data?.limitCredits === "number" && Number.isFinite(data.limitCredits)
      ? Math.max(0, data.limitCredits)
      : undefined;
  const usedTokens =
    typeof data?.usedTokens === "number" && Number.isFinite(data.usedTokens)
      ? Math.max(0, data.usedTokens)
      : undefined;
  const limitTokens =
    typeof data?.limitTokens === "number" && Number.isFinite(data.limitTokens)
      ? Math.max(0, data.limitTokens)
      : undefined;
  const remainingTokens =
    typeof data?.remainingTokens === "number" && Number.isFinite(data.remainingTokens)
      ? Math.max(0, data.remainingTokens)
      : undefined;
  const remainingCredits =
    typeof data?.remainingCredits === "number" && Number.isFinite(data.remainingCredits)
      ? Math.max(0, data.remainingCredits)
      : typeof usedCredits === "number" && typeof limitCredits === "number"
        ? Math.max(0, limitCredits - usedCredits)
        : undefined;

  return {
    ok: true,
    status: result.status,
    data: {
      ...data,
      plan,
      usedTokens,
      limitTokens,
      remainingTokens,
      usedCredits,
      limitCredits,
      remainingCredits
    }
  };
}

export async function fetchBilling(): Promise<ApiResult<BillingInfo>> {
  return coopFetch<BillingInfo>("/v1/admin/billing");
}

export async function openBillingPortal(): Promise<ApiResult<{ url: string }>> {
  return coopFetch<{ url: string }>("/v1/admin/billing/portal-session", { method: "POST" });
}

/**
 * Increase-only seat management. `addSeats` is how many seats to add on top of the
 * effective current count (max of Coop and Stripe). Returns a Stripe confirm link
 * for the new total. Coop seats update only after Stripe confirms (via webhook).
 */
export async function createSeatIncreaseSession(
  addSeats: number
): Promise<
  ApiResult<{ url: string; currentSeats: number; requestedSeats: number; addedSeats: number }>
> {
  return coopFetch<{
    url: string;
    currentSeats: number;
    requestedSeats: number;
    addedSeats: number;
  }>("/v1/admin/billing/seat-increase", {
    method: "POST",
    body: JSON.stringify({ addSeats })
  });
}

export async function createUpgradeCheckoutSession(
  opts?: { email?: string; seats?: number }
): Promise<ApiResult<{ sessionId: string; url: string }>> {
  const body: Record<string, unknown> = {};
  if (opts?.email?.trim()) {
    body.email = opts.email.trim();
  }
  if (opts?.seats != null) {
    body.seats = opts.seats;
  }
  return coopFetch<{ sessionId: string; url: string }>("/v1/billing/upgrade-checkout-session", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export type EnterpriseUpgradeRequest = {
  name: string;
  email: string;
  orgName: string;
  notes?: string;
};

export async function submitEnterpriseUpgradeRequest(
  payload: EnterpriseUpgradeRequest
): Promise<ApiResult<{ ok: boolean }>> {
  return coopFetch<{ ok: boolean }>("/v1/admin/enterprise-upgrade-request", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      orgName: payload.orgName,
      notes: payload.notes ?? ""
    })
  });
}

export type ThreadSummary = {
  id: string;
  orgId: string;
  userId?: string;
  principal: string;
  title: string;
  repoOwner?: string;
  repoName?: string;
  repoProvider?: string;
  messageCount: number;
  previewText?: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadMessage = {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  sortOrder: number;
};

export type ThreadsListResponse = {
  threads: ThreadSummary[];
  nextCursor?: string;
};

export type ThreadDetailResponse = {
  thread: ThreadSummary;
  messages: ThreadMessage[];
};

export type FetchThreadsParams = {
  from?: string;
  to?: string;
  userId?: string;
  repo?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

export async function fetchThreads(
  params: FetchThreadsParams = {}
): Promise<ApiResult<ThreadsListResponse>> {
  const search = new URLSearchParams();
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.userId) search.set("userId", params.userId);
  if (params.repo) search.set("repo", params.repo);
  if (params.q) search.set("q", params.q);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const query = search.toString();
  return coopFetch<ThreadsListResponse>(`/v1/threads${query ? `?${query}` : ""}`);
}

export async function fetchThread(threadId: string): Promise<ApiResult<ThreadDetailResponse>> {
  return coopFetch<ThreadDetailResponse>(`/v1/threads/${encodeURIComponent(threadId)}`);
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
  const params = new URLSearchParams({ org: orgName });
  return `/api/auth/saml/start?${params.toString()}`;
}

/** Admin SSO settings diagnostic — validates IdP config without swapping sessions. */
export function ssoTestConnectionUrl(orgName: string): string {
  const params = new URLSearchParams({ org: orgName, mode: "test" });
  return `/api/auth/saml/start?${params.toString()}`;
}

export type SsoSpDetails = {
  entityId: string;
  acsUrl: string;
  metadataUrl: string;
  publicStartUrl: string;
};

export type SsoConfigResponse = {
  configured: boolean;
  provider?: "okta" | "azuread" | "saml";
  idpEntityId?: string;
  idpSsoUrl?: string;
  enabled?: boolean;
  hasCertificate?: boolean;
  updatedAt?: string;
  sp?: SsoSpDetails;
};

export type SsoPolicyResponse = {
  requireSso: boolean;
  allowPassword: boolean;
  allowGoogle: boolean;
  updatedAt?: string;
};

export type SsoConfigInput = {
  provider: "okta" | "azuread" | "saml";
  idpEntityId: string;
  idpSsoUrl: string;
  idpX509Cert?: string;
  enabled?: boolean;
};

export async function fetchSsoConfig(): Promise<ApiResult<SsoConfigResponse>> {
  return coopFetch<SsoConfigResponse>("/v1/sso/config");
}

export async function updateSsoConfig(input: SsoConfigInput): Promise<ApiResult<SsoConfigResponse>> {
  return coopFetch<SsoConfigResponse>("/v1/sso/config", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function fetchSsoPolicy(): Promise<ApiResult<SsoPolicyResponse>> {
  return coopFetch<SsoPolicyResponse>("/v1/sso/policy");
}

export async function updateSsoPolicy(
  input: Partial<Pick<SsoPolicyResponse, "requireSso" | "allowPassword" | "allowGoogle">>
): Promise<ApiResult<SsoPolicyResponse>> {
  return coopFetch<SsoPolicyResponse>("/v1/sso/policy", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function fetchSamlMetadataXml(): Promise<ApiResult<string>> {
  let token = getToken();
  if (!token) {
    return { ok: false, status: 401, error: "Not signed in." };
  }
  try {
    const response = await fetch(`${getApiBase()}/v1/auth/saml/metadata`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Request failed (${response.status}).`;
      try {
        const body = JSON.parse(text) as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        // keep default
      }
      return { ok: false, status: response.status, error: message };
    }
    return { ok: true, status: response.status, data: await response.text() };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Coop API." };
  }
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

export type AnalyticsRange = "7d" | "30d" | "90d";

/** Product mix buckets (optional on overview when backend provides them). */
export type AnalyticsProductMix = {
  chat: number;
  completions: number;
  lightning: number;
  quickActions: number;
};

export type AnalyticsInactiveUser = {
  userId: string;
  email: string;
  principal: string;
  lastActiveAt: string | null;
};

export type AnalyticsPrincipalCar = {
  principal: string;
  suggested?: number;
  accepted?: number;
  acceptanceRate: number | null;
  count?: number;
};

export type AnalyticsOverview = {
  totalUsers: number;
  activeUsers: number;
  seats: number;
  seatUtilization: number;
  dau: number;
  mau: number;
  totalEvents: number;
  eventsByDay: Array<{ day: string; count: number }>;
  /** Org completion acceptance rate when backend includes it on overview. */
  acceptanceRate?: number | null;
  productMix?: AnalyticsProductMix;
  /** Backend field name from Agent 1. */
  inactiveSeatCount?: number;
  /** @deprecated prefer inactiveSeatCount */
  inactiveSeats?: number;
  inactiveUsers?: AnalyticsInactiveUser[] | number;
};

export type AnalyticsChat = {
  chatMessages: number;
  quickActions: Array<{ eventType: string; count: number }>;
  editRequested?: number;
  editPatchApplied?: number;
  editPatchRejected?: number;
  editApplyRate?: number | null;
  editEvents?: Array<{ eventType: string; count: number }>;
  eventsByDay: Array<{ day: string; count: number }>;
  topUsers: Array<{
    principal: string;
    email?: string;
    count: number;
    suggested?: number;
    accepted?: number;
    acceptanceRate?: number | null;
  }>;
};

export type AnalyticsLightning = {
  /** Normalized search count (from lightningSearches or searchCount). */
  searchCount: number;
  lightningSearches?: number;
  eventsByDay: Array<{ day: string; count: number }>;
};

export type AnalyticsUserActivity = {
  principal: string;
  email?: string;
  eventCount: number;
  suggested?: number;
  accepted?: number;
  acceptanceRate?: number | null;
  lastActiveAt?: string | null;
};

export type AnalyticsUsers = {
  inactiveSeats?: number;
  inactiveSeatCount?: number;
  inactiveUsers?: AnalyticsInactiveUser[] | number;
  users?: AnalyticsUserActivity[];
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
  requested: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number | null;
  serverLatencyP50Ms: number | null;
  serverLatencyP95Ms: number | null;
  serverLatencySamples: number;
  clientLatencyP50Ms: number | null;
  clientLatencyP95Ms: number | null;
  clientLatencySamples: number;
  eventsByDay: Array<{ day: string; count: number }>;
  topUsersByCar?: AnalyticsPrincipalCar[];
};

export async function fetchAnalyticsCompletions(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsCompletions>> {
  return coopFetch<AnalyticsCompletions>(`/v1/admin/analytics/completions${analyticsQuery(from, to)}`);
}

/** Lightning search metrics. Returns unavailable when the endpoint is not deployed yet. */
export async function fetchAnalyticsLightning(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsLightning>> {
  const result = await coopFetch<AnalyticsLightning & { lightningSearches?: number; searchCount?: number }>(
    `/v1/admin/analytics/lightning${analyticsQuery(from, to)}`
  );
  if (!result.ok || !result.data) return result;
  const searchCount =
    result.data.lightningSearches ?? result.data.searchCount ?? 0;
  return {
    ...result,
    data: {
      ...result.data,
      searchCount,
      lightningSearches: result.data.lightningSearches ?? searchCount
    }
  };
}

/** Optional dedicated users analytics endpoint (may 404; overview carries inactive seats). */
export async function fetchAnalyticsUsers(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsUsers>> {
  return coopFetch<AnalyticsUsers>(`/v1/admin/analytics/users${analyticsQuery(from, to)}`);
}

/**
 * @deprecated Prefer AnalyticsProductMix object on MeAnalyticsOverview.productMix.
 * Kept for UI code that still maps { product, count } rows.
 */
export type MeAnalyticsProductMixItem = {
  product: string;
  count: number;
};

export type MeAnalyticsOverview = {
  totalEvents: number;
  eventsByDay: Array<{ day: string; count: number }>;
  /** Optional CAR from completions (accepted ÷ suggested). */
  acceptanceRate?: number | null;
  suggested?: number;
  accepted?: number;
  /** Backend returns object `{ chat, completions, lightning, quickActions }`; array form is legacy. */
  productMix?: AnalyticsProductMix | MeAnalyticsProductMixItem[];
  chatMessages?: number;
  quickActionCount?: number;
  completionEvents?: number;
  lightningEvents?: number;
};

export type MeAnalyticsChat = {
  chatMessages: number;
  quickActions: Array<{ eventType: string; count: number }>;
  editRequested?: number;
  editPatchApplied?: number;
  editPatchRejected?: number;
  editApplyRate?: number | null;
  editEvents?: Array<{ eventType: string; count: number }>;
  eventsByDay: Array<{ day: string; count: number }>;
};

export async function fetchMeAnalyticsOverview(
  from: string,
  to: string
): Promise<ApiResult<MeAnalyticsOverview>> {
  return coopFetch<MeAnalyticsOverview>(`/v1/me/analytics/overview${analyticsQuery(from, to)}`);
}

export async function fetchMeAnalyticsChat(
  from: string,
  to: string
): Promise<ApiResult<MeAnalyticsChat>> {
  return coopFetch<MeAnalyticsChat>(`/v1/me/analytics/chat${analyticsQuery(from, to)}`);
}

export async function fetchMeAnalyticsLightning(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsLightning>> {
  const result = await coopFetch<AnalyticsLightning & { lightningSearches?: number; searchCount?: number }>(
    `/v1/me/analytics/lightning${analyticsQuery(from, to)}`
  );
  if (!result.ok || !result.data) return result;
  const searchCount = result.data.lightningSearches ?? result.data.searchCount ?? 0;
  return {
    ...result,
    data: {
      ...result.data,
      searchCount,
      lightningSearches: result.data.lightningSearches ?? searchCount
    }
  };
}

export async function fetchMeAnalyticsCompletions(
  from: string,
  to: string
): Promise<ApiResult<AnalyticsCompletions>> {
  return coopFetch<AnalyticsCompletions>(`/v1/me/analytics/completions${analyticsQuery(from, to)}`);
}

export async function fetchMeAudit(
  options?: { cursor?: string; limit?: number }
): Promise<ApiResult<{ entries: AuditEntry[]; nextCursor?: string }>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 50));
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  return coopFetch<{ entries: AuditEntry[]; nextCursor?: string }>(`/v1/me/audit?${params.toString()}`);
}

export type OrgRepoRecord = {
  repoId: string;
  lightningEnabled?: boolean;
  indexStatus?: string;
  embeddingStatus?: "complete" | "failed" | "skipped" | "pending";
  lastIndexedAt?: string;
  lastJobId?: string;
  indexProgress?: number;
  error?: string;
  embeddingError?: string;
};

export type AdminCollection = {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  createdAt: string;
  repos: Array<{ collectionId: string; repoId: string; addedAt: string }>;
};

export async function fetchOrgRepos(): Promise<
  ApiResult<{ repos: OrgRepoRecord[]; quotaReconciled?: { trimmed: number } }>
> {
  const result = await coopFetch<{ repos: OrgRepoRecord[]; quotaReconciled?: { trimmed: number } }>(
    "/v1/orgs/repos"
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: {
      repos: result.data?.repos ?? [],
      quotaReconciled: result.data?.quotaReconciled
    }
  };
}

export function codeHostLabel(provider: CodeHostProvider): string {
  return INTEGRATIONS.find((entry) => entry.id === provider)?.name ?? provider;
}

export async function syncCatalog(
  provider: CodeHostProvider
): Promise<ApiResult<{ provider: CodeHostProvider; discovered: number; queued: number; skipped: number }>> {
  const result = await coopFetch<{ provider: CodeHostProvider; discovered: number; queued: number; skipped: number }>(
    "/v1/orgs/estate/sync",
    { method: "POST", body: JSON.stringify({ provider }) }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: result.data ?? { provider, discovered: 0, queued: 0, skipped: 0 }
  };
}

/** @deprecated Use syncCatalog("github") */
export async function syncEstate(): Promise<
  ApiResult<{ discovered: number; queued: number; skipped: number }>
> {
  const result = await syncCatalog("github");
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    status: result.status,
    data: {
      discovered: result.data?.discovered ?? 0,
      queued: result.data?.queued ?? 0,
      skipped: result.data?.skipped ?? 0
    }
  };
}

export async function enableLightningRepo(repoId: string): Promise<ApiResult<{ jobId?: string; status?: string }>> {
  const result = await coopFetch<{ jobId?: string; status?: string }>(
    `/v1/orgs/repos/${encodeURIComponent(repoId)}/lightning/enable`,
    { method: "POST", body: "{}" }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: result.data };
}

export async function disableLightningRepo(repoId: string): Promise<ApiResult<{ repo?: OrgRepoRecord }>> {
  const result = await coopFetch<{ repo?: OrgRepoRecord }>(
    `/v1/orgs/repos/${encodeURIComponent(repoId)}/lightning/disable`,
    { method: "POST", body: "{}" }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return { ok: true, status: result.status, data: result.data };
}

export async function reindexEmbeddingFailures(): Promise<
  ApiResult<{ discovered: number; queued: number; skipped: number }>
> {
  const result = await coopFetch<{ discovered: number; queued: number; skipped: number }>(
    "/v1/orgs/repos/reindex-embedding-failures",
    { method: "POST", body: "{}" }
  );
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, unavailable: result.unavailable };
  }
  return {
    ok: true,
    status: result.status,
    data: {
      discovered: result.data?.discovered ?? 0,
      queued: result.data?.queued ?? 0,
      skipped: result.data?.skipped ?? 0
    }
  };
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
