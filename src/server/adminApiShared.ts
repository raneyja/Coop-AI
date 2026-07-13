import type { ServerResponse } from "node:http";
import type { AuthTokenStore } from "./auth/authTokenStore";
import type { AuditLogger } from "./audit/auditLogger";
import type { UsageTracker } from "./usageTracker";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";
import type { OrgStore } from "./orgStore";
import type { OperatorStore } from "./operators/operatorStore";
import type { ServerConfig } from "./serverConfig";
import type { UserStore } from "./users/userStore";

export type AdminApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  authTokenStore?: AuthTokenStore;
  integrationStore?: IntegrationConnectionStore;
  scopePolicyStore?: IntegrationScopePolicyStore;
  operatorStore?: OperatorStore;
  serverConfig: ServerConfig;
  auditLogger?: AuditLogger;
  usageTracker?: UsageTracker;
};

export function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, (_key, value) => (value instanceof Date ? value.toISOString() : value)));
}
