import type { ServerResponse } from "node:http";
import type { EmailService } from "./email/emailService";
import type { OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";
import type { AuthIdentityStore } from "./auth/authIdentityStore";
import type { AuthTokenStore } from "./auth/authTokenStore";
import type { AuthConfig } from "./auth/authConfig";
import { hashPassword, validatePasswordStrength } from "./auth/passwordCrypto";
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
  authIdentityStore?: AuthIdentityStore;
  authTokenStore?: AuthTokenStore;
  emailService?: EmailService;
  authConfig?: AuthConfig;
};

export async function handleFreeSignupApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: FreeSignupApiDeps
): Promise<boolean> {
  if (parsed.method !== "POST" || parsed.pathname !== "/v1/signup/free") {
    return false;
  }

  if (
    !deps.orgStore ||
    !deps.userStore ||
    !deps.authIdentityStore ||
    !deps.authTokenStore ||
    !deps.emailService ||
    !deps.authConfig
  ) {
    writeJson(response, 503, { error: "signup_unavailable" });
    return true;
  }

  const body = asRecord(parsed.body);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(body.password ?? "");
  if (!isValidEmail(email)) {
    writeJson(response, 400, { error: "invalid_email", message: "Enter a valid email address." });
    return true;
  }
  const passwordError = validatePasswordStrength(password, deps.authConfig.passwordMinLength);
  if (passwordError) {
    writeJson(response, 400, { error: "weak_password", message: passwordError });
    return true;
  }

  const existingUser = await deps.userStore.findActiveUserByEmail(email);
  if (existingUser) {
    writeJson(response, 409, {
      error: "signup_rate_limited",
      code: "email_taken",
      message: "This email already has a Coop AI account. Sign in or reset your password."
    });
    return true;
  }

  const requestedOrgName = String(body.orgName ?? body.displayName ?? "").trim();
  const orgName = deriveOrgName(requestedOrgName, email);
  if (orgName.length > 120) {
    writeJson(response, 400, { error: "orgName too long" });
    return true;
  }

  const org = await deps.orgStore.createOrganization(orgName, "free");
  const user = await deps.userStore.createUser(org.id, email, "admin");
  await deps.authIdentityStore.createPasswordIdentity(user.id, hashPassword(password));

  const verifyToken = await deps.authTokenStore.createToken(user.id, "email_verify", 24 * 60 * 60 * 1000);
  const verifyUrl = `${deps.authConfig.marketingBaseUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`;
  const loginUrl = adminPortalLoginUrl(loadBillingConfig().adminPortalUrl);

  await deps.emailService.sendFreeSignupWelcome({
    to: email,
    orgName: org.name,
    adminPortalUrl: loginUrl
  });
  await deps.emailService.sendEmailVerification({ to: email, orgName: org.name, verifyUrl });

  const session = await deps.userStore.createSession(user.id, org.id, {
    ttlMs: deps.authConfig.accessTtlMs,
    authProvider: "password"
  });
  const refreshToken = await deps.authTokenStore.createToken(
    user.id,
    "refresh",
    deps.authConfig.refreshTtlMs
  );

  writeJson(response, 201, {
    orgId: org.id,
    orgName: org.name,
    email,
    plan: "free",
    adminPortalLoginUrl: loginUrl,
    accessToken: session.token,
    refreshToken,
    expiresAt: session.expiresAt.toISOString()
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
