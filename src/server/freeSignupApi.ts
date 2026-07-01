import type { ServerResponse } from "node:http";
import type { EmailService } from "./email/emailService";
import type { OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";
import { loadBillingConfig } from "./billing/billingConfig";
import { adminPortalLoginUrl } from "./billing/adminPortalUrl";

type ParsedRequest = {
  method: string;
  pathname: string;
  body: unknown;
};

export type FreeSignupApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  emailService?: EmailService;
};

export async function handleFreeSignupApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: FreeSignupApiDeps
): Promise<boolean> {
  if (parsed.method !== "POST" || parsed.pathname !== "/v1/signup/free") {
    return false;
  }

  if (!deps.orgStore || !deps.userStore || !deps.emailService) {
    writeJson(response, 503, { error: "signup_unavailable" });
    return true;
  }

  const body = asRecord(parsed.body);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!isValidEmail(email)) {
    writeJson(response, 400, { error: "invalid_email", message: "Enter a valid email address." });
    return true;
  }

  const existingUser = await deps.userStore.findActiveUserByEmail(email);
  if (existingUser) {
    writeJson(response, 429, {
      error: "signup_rate_limited",
      code: "email_taken",
      message: "This email already has an active Coop AI account."
    });
    return true;
  }

  const requestedOrgName = String(body.orgName ?? "").trim();
  const orgName = deriveOrgName(requestedOrgName, email);
  if (orgName.length > 120) {
    writeJson(response, 400, { error: "orgName too long" });
    return true;
  }

  const org = await deps.orgStore.createOrganization(orgName, "free");
  await deps.userStore.createUser(org.id, email, "owner");
  const { rawKey } = await deps.orgStore.createApiKey(org.id, "admin portal");

  const loginUrl = adminPortalLoginUrl(loadBillingConfig().adminPortalUrl);
  await deps.emailService.sendFreeSignupWelcome({
    to: email,
    orgName: org.name,
    adminPortalUrl: loginUrl,
    apiKey: rawKey
  });

  writeJson(response, 201, {
    orgId: org.id,
    orgName: org.name,
    adminPortalLoginUrl: loginUrl,
    apiKey: rawKey
  });
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function deriveOrgName(orgName: string, email: string): string {
  if (orgName) {
    return orgName;
  }
  const local = email.split("@")[0]?.trim();
  return local || "My Workspace";
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
