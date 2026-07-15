import type { ServerResponse } from "node:http";

/** Origins allowed to receive session tokens in a redirect fragment. */
export type AuthRedirectAllowlist = {
  adminPortalUrl: string;
  marketingBaseUrl: string;
  /** Extra origins (e.g. preview deploys) from `COOP_AUTH_EXTRA_REDIRECT_ORIGINS`. */
  extraOrigins?: string[];
};

/**
 * Post-login redirects may carry access tokens in the URL fragment.
 * Allow only Coop surfaces (admin / marketing / localhost mirrors) and VS Code URI handlers —
 * never arbitrary `https://` hosts.
 */
export function sanitizeAuthRedirect(
  redirect: string | null | undefined,
  allowlist?: AuthRedirectAllowlist
): string | undefined {
  if (!redirect) {
    return undefined;
  }
  const trimmed = redirect.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "vscode:" || url.protocol === "vscode-insiders:") {
      return trimmed;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    if (!allowlist) {
      return undefined;
    }
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return undefined;
    }
    if (!isAllowedRedirectOrigin(url.origin, allowlist)) {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

export function authRedirectAllowlistFromConfig(config: {
  adminPortalUrl: string;
  marketingBaseUrl: string;
}, env: NodeJS.ProcessEnv = process.env): AuthRedirectAllowlist {
  const extra =
    env.COOP_AUTH_EXTRA_REDIRECT_ORIGINS?.split(",")
      .map((entry) => entry.trim().replace(/\/$/, ""))
      .filter(Boolean) ?? [];
  return {
    adminPortalUrl: config.adminPortalUrl,
    marketingBaseUrl: config.marketingBaseUrl,
    extraOrigins: extra
  };
}

function isAllowedRedirectOrigin(origin: string, allowlist: AuthRedirectAllowlist): boolean {
  const allowed = new Set<string>();
  for (const base of [allowlist.adminPortalUrl, allowlist.marketingBaseUrl, ...(allowlist.extraOrigins ?? [])]) {
    try {
      allowed.add(new URL(base).origin);
    } catch {
      // skip invalid config entries
    }
  }
  return allowed.has(origin);
}

export function deliverSessionToken(
  response: ServerResponse,
  token: string,
  redirect?: string,
  refreshToken?: string
): void {
  if (redirect) {
    const params = new URLSearchParams();
    params.set("coopToken", token);
    if (refreshToken) {
      params.set("coopRefresh", refreshToken);
    }
    const location = appendAuthFragmentParams(redirect, params);
    response.writeHead(302, { location });
    response.end();
    return;
  }
  writeJson(response, 200, {
    accessToken: token,
    refreshToken
  });
}

export function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function appendAuthFragmentParams(base: string, params: URLSearchParams): string {
  const separator = base.includes("#") ? "&" : "#";
  return `${base}${separator}${params.toString()}`;
}

/** OAuth / SSO errors: portal login for browsers; callback fragment for VS Code URI handlers. */
export function deliverAuthError(
  response: ServerResponse,
  redirect: string | undefined,
  error: string,
  message: string,
  statusCode = 400
): void {
  if (redirect) {
    try {
      const target = new URL(redirect);
      if (target.protocol === "vscode:" || target.protocol === "vscode-insiders:") {
        const params = new URLSearchParams();
        params.set("error", error);
        params.set("message", message);
        const location = appendAuthFragmentParams(redirect, params);
        response.writeHead(302, { location });
        response.end();
        return;
      }
      const loginPath = target.pathname.includes("/login") ? target.pathname : "/login";
      const loginUrl = new URL(loginPath, target.origin);
      loginUrl.searchParams.set("error", error);
      loginUrl.searchParams.set("message", message);
      response.writeHead(302, { location: loginUrl.toString() });
      response.end();
      return;
    } catch {
      // fall through to JSON
    }
  }
  writeJson(response, statusCode, { error, message });
}
