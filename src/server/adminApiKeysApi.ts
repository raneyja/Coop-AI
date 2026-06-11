import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import type { AuthContext } from "./orgStore";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  body: unknown;
};

export async function handleAdminApiKeysRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/api-keys") {
    const keys = await deps.orgStore!.listApiKeys(auth.orgId);
    writeJson(response, 200, {
      apiKeys: keys.map((key) => ({
        id: key.id,
        label: key.label,
        createdAt: key.createdAt,
        lastUsed: key.lastUsed ?? null
      }))
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/api-keys") {
    const body = asRecord(parsed.body);
    const label = String(body.label ?? "default").trim() || "default";
    const { record, rawKey } = await deps.orgStore!.createApiKey(auth.orgId, label);
    await audit(deps, auth, "admin.api_key.create", { keyId: record.id, label });
    writeJson(response, 201, {
      apiKey: {
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
        rawKey
      }
    });
    return true;
  }

  const revokeMatch = parsed.pathname.match(/^\/v1\/admin\/api-keys\/([^/]+)$/);
  if (revokeMatch && parsed.method === "DELETE") {
    const keyId = decodeURIComponent(revokeMatch[1]);
    const revoked = await deps.orgStore!.revokeApiKey(auth.orgId, keyId);
    if (!revoked) {
      writeJson(response, 404, { error: "api key not found" });
      return true;
    }
    await audit(deps, auth, "admin.api_key.revoke", { keyId });
    writeJson(response, 200, { ok: true, keyId });
    return true;
  }

  return false;
}

async function audit(
  deps: AdminApiDeps,
  auth: AuthContext,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const actor = auditActor(auth);
  await deps.auditLogger?.record({
    orgId: auth.orgId,
    userId: actor.userId,
    principal: actor.principal,
    action,
    metadata
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
