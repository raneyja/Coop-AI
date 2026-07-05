/**
 * Public HTTPS base URL for OAuth callbacks and inbound webhooks.
 *
 * Precedence:
 *   WEBHOOK_DOMAIN → COOP_PUBLIC_BASE_URL → COOP_PUBLIC_API_URL → http://localhost:{PORT}
 */
export function resolvePublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit =
    env.WEBHOOK_DOMAIN?.trim() ||
    env.COOP_PUBLIC_BASE_URL?.trim() ||
    env.COOP_PUBLIC_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return `http://localhost:${env.PORT ?? "8787"}`;
}
