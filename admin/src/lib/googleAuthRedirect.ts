const IDE_AUTH_PROTOCOLS = new Set([
  "vscode:",
  "vscode-insiders:",
  "cursor:",
  "cursor-insiders:"
]);

/** Only Coop's editor protocol handler may receive session tokens from admin OAuth. */
export function resolveGoogleAuthClientRedirect(
  requested: string | null | undefined,
  fallback: string
): string {
  const trimmed = requested?.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      IDE_AUTH_PROTOCOLS.has(parsed.protocol) &&
      parsed.hostname === "coop-ai.coop-ai" &&
      parsed.pathname === "/auth/callback"
    ) {
      return trimmed;
    }
  } catch {
    // Invalid or untrusted targets fall back to the admin portal.
  }
  return fallback;
}
