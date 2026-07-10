import type { ServerResponse } from "node:http";
import { extractBearerToken } from "../authMiddleware";
import { writeJson } from "../adminApiShared";
import type { OperatorStore, OperatorContext } from "./operatorStore";
import type { OperatorRole } from "./operatorAuthConfig";

const ROLE_RANK: Record<OperatorRole, number> = {
  viewer: 0,
  support: 1,
  billing: 2,
  super_admin: 3
};

export function operatorRoleAtLeast(role: OperatorRole, minimum: OperatorRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export async function resolveOperatorContext(
  headers: Record<string, string | undefined>,
  operatorStore: OperatorStore | undefined
): Promise<OperatorContext | undefined> {
  const token = extractBearerToken(headers);
  if (!token || !operatorStore) {
    return undefined;
  }
  return operatorStore.resolveSession(token);
}

export function requireOperator(
  operator: OperatorContext | undefined,
  response: ServerResponse
): operator is OperatorContext {
  if (!operator) {
    writeJson(response, 401, { error: "unauthorized", message: "Operator session required." });
    return false;
  }
  return true;
}

export function requireOperatorRole(
  operator: OperatorContext,
  minimum: OperatorRole,
  response: ServerResponse
): boolean {
  if (!operatorRoleAtLeast(operator.role, minimum)) {
    writeJson(response, 403, {
      error: "operator_role_required",
      message: `This action requires ${minimum} role or higher.`,
      requiredRole: minimum,
      currentRole: operator.role
    });
    return false;
  }
  return true;
}
