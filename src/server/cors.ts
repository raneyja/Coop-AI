import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_DEV_ORIGINS = ["http://localhost:3001"];

export function loadCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.COOP_CORS_ORIGINS?.trim();
  if (!raw) {
    return DEFAULT_DEV_ORIGINS;
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Sets CORS headers for browser clients (admin portal). Returns true if OPTIONS preflight was handled.
 */
export function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[]
): boolean {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }

  return false;
}
