import type { ServerResponse } from "node:http";

/** Origins allowed to receive session tokens in a redirect fragment. */
export type AuthRedirectAllowlist = {
  adminPortalUrl: string;
  marketingBaseUrl: string;
  /** Extra origins (e.g. preview deploys) from `COOP_AUTH_EXTRA_REDIRECT_ORIGINS`. */
  extraOrigins?: string[];
};

/** Editor URI schemes that receive the session via a protocol handler, not a document navigation. */
const IDE_AUTH_PROTOCOLS = new Set(["vscode:", "vscode-insiders:", "cursor:", "cursor-insiders:"]);

export function isIdeAuthRedirect(redirect: string): boolean {
  try {
    return IDE_AUTH_PROTOCOLS.has(new URL(redirect).protocol);
  } catch {
    return false;
  }
}

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
    if (IDE_AUTH_PROTOCOLS.has(url.protocol)) {
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
    if (isIdeAuthRedirect(redirect)) {
      writeIdeAuthHandoffHtml(response, 200, location, {
        title: "Signed in to Coop",
        heading: "You're signed in",
        body: "You can close this tab and return to your editor."
      });
      return;
    }
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
      if (isIdeAuthRedirect(redirect)) {
        const params = new URLSearchParams();
        params.set("error", error);
        params.set("message", message);
        const location = appendAuthFragmentParams(redirect, params);
        writeIdeAuthHandoffHtml(response, statusCode, location, {
          title: "Coop sign-in",
          heading: "Sign-in didn't finish",
          body: message
        });
        return;
      }
      const errorPath = target.pathname.includes("/login")
        ? target.pathname
        : target.pathname.includes("/accept-invite")
          ? target.pathname
          : target.pathname.includes("/signup")
            ? target.pathname
            : "/login";
      const errorUrl = new URL(errorPath, target.origin);
      for (const [key, value] of target.searchParams) {
        if (key !== "error" && key !== "message") {
          errorUrl.searchParams.set(key, value);
        }
      }
      errorUrl.searchParams.set("error", error);
      errorUrl.searchParams.set("message", message);
      response.writeHead(302, { location: errorUrl.toString() });
      response.end();
      return;
    } catch {
      // fall through to JSON
    }
  }
  writeJson(response, statusCode, { error, message });
}

function writeIdeAuthHandoffHtml(
  response: ServerResponse,
  statusCode: number,
  location: string,
  copy: { title: string; heading: string; body: string }
): void {
  const safeLocation = escapeHtml(location);
  const jsLocation = JSON.stringify(location);
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer"
  });
  response.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(copy.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0f14; color: #e8eef5; }
    .card { max-width: 28rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
    p { margin: 0 0 1rem; line-height: 1.45; color: #b7c2ce; }
    a { color: #7eb6ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(copy.heading)}</h1>
    <p>${escapeHtml(copy.body)}</p>
    <p><a href="${safeLocation}">Open Coop in your editor</a> if it didn't open automatically.</p>
  </div>
  <script>setTimeout(function () { window.location.href = ${jsLocation}; }, 50);</script>
</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
