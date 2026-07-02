import type { ServerResponse } from "node:http";

export function sanitizeAuthRedirect(redirect: string | null | undefined): string | undefined {
  if (!redirect) {
    return undefined;
  }
  const trimmed = redirect.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "vscode:" || url.protocol === "vscode-insiders:" || url.protocol === "https:") {
      return trimmed;
    }
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return trimmed;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    const separator = redirect.includes("#") ? "&" : "#";
    const location = `${redirect}${separator}${params.toString()}`;
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

/** Browser OAuth flows: send users back to the portal login with a readable error. */
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
