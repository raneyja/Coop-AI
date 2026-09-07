import type { MeResponse } from "../api/CoopBackendClient";

export type SessionVerifierApi = {
  hasToken(): Promise<boolean>;
  getRefreshToken(): Promise<string | undefined>;
  fetchMe(baseUrl: string): Promise<MeResponse>;
  refreshSession(baseUrl: string): Promise<unknown>;
  clearToken(): Promise<void>;
  clearRefreshToken(): Promise<void>;
};

export function isUnauthenticatedApiError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const withStatus = error as { response?: { status?: number }; status?: number };
  const status = withStatus.response?.status ?? withStatus.status;
  if (status === 401) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("unauthorized") ||
    message.includes("invalid_refresh_token") ||
    message.includes("sign in with your email")
  );
}

/**
 * Confirm the stored session with /v1/me. Dead tokens are cleared so the UI
 * shows signed-out instead of inventing a free plan. Network failures keep the
 * token but still return undefined (not signed in) until verification succeeds.
 */
export async function verifyStoredSession(
  api: SessionVerifierApi,
  baseUrl: string
): Promise<MeResponse | undefined> {
  if (!(await api.hasToken())) {
    return undefined;
  }

  try {
    return await api.fetchMe(baseUrl);
  } catch (firstError) {
    if (!isUnauthenticatedApiError(firstError)) {
      return undefined;
    }
    if (await api.getRefreshToken()) {
      try {
        await api.refreshSession(baseUrl);
        return await api.fetchMe(baseUrl);
      } catch {
        // Expired refresh — sign out below.
      }
    }
    await api.clearToken();
    await api.clearRefreshToken();
    return undefined;
  }
}
