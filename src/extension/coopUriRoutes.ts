/** Paths handled by `vscode.window.registerUriHandler` for `vscode://coop-ai.coop-ai/…`. */
export type CoopUriKind = "auth-callback" | "sign-in" | "unknown";

export const COOP_EXTENSION_ID = "coop-ai.coop-ai";
export const COOP_AUTH_CALLBACK_PATH = "/auth/callback";
export const COOP_SIGN_IN_PATH = "/sign-in";

export function normalizeCoopUriPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function classifyCoopUriPath(path: string): CoopUriKind {
  const normalized = normalizeCoopUriPath(path).replace(/\/+$/, "") || "/";
  if (normalized === COOP_AUTH_CALLBACK_PATH) {
    return "auth-callback";
  }
  if (normalized === COOP_SIGN_IN_PATH || normalized === "/signin") {
    return "sign-in";
  }
  return "unknown";
}

export function vscodeSignInHref(): string {
  return `vscode://${COOP_EXTENSION_ID}${COOP_SIGN_IN_PATH}`;
}
