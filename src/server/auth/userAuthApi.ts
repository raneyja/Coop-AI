import type { ServerResponse } from "node:http";
import { extractBearerToken, resolveAuthContext } from "../authMiddleware";
import type { AuditLogger } from "../audit/auditLogger";
import { principalForUser } from "../audit/auditLogger";
import type { EmailService } from "../email/emailService";
import type { OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import type { UserStore } from "../users/userStore";
import type { AuthConfig } from "./authConfig";
import { allowedGoogleRedirectUris, defaultGoogleCallbackUri, isAllowedGoogleRedirectUri } from "./authConfig";
import { AuthIdentityStore } from "./authIdentityStore";
import { AuthTokenStore } from "./authTokenStore";
import { GoogleAuthService } from "./googleAuthService";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./passwordCrypto";
import {
  authRedirectAllowlistFromConfig,
  deliverAuthError,
  deliverSessionToken,
  sanitizeAuthRedirect,
  writeJson
} from "./sessionDelivery";
import { authClientKey, consumeAuthRateLimit } from "./authRateLimit";
import { adminPortalFreshLoginUrl, adminPortalLoginUrl } from "../billing/adminPortalUrl";
import type { Pool } from "pg";
import { getDbPool } from "../db";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export type UserAuthApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  authIdentityStore?: AuthIdentityStore;
  authTokenStore?: AuthTokenStore;
  emailService?: EmailService;
  googleAuth?: GoogleAuthService;
  authConfig: AuthConfig;
  auditLogger?: AuditLogger;
  serverConfig: ServerConfig;
  pool?: Pool | null;
};

const AUTH_PREFIX = "/v1/auth";

export async function handleUserAuthApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  if (!parsed.pathname.startsWith(AUTH_PREFIX)) {
    return false;
  }
  if (parsed.pathname.startsWith("/v1/auth/saml")) {
    return false;
  }

  if (!deps.orgStore || !deps.userStore || !deps.authIdentityStore || !deps.authTokenStore) {
    writeJson(response, 503, { error: "auth_unavailable" });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/register`) {
    return handleRegister(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/login`) {
    return handleLogin(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/logout`) {
    return handleLogout(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/refresh`) {
    return handleRefresh(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/forgot-password`) {
    return handleForgotPassword(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/reset-password`) {
    return handleResetPassword(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${AUTH_PREFIX}/accept-invite`) {
    return handleAcceptInvitePreview(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/accept-invite`) {
    return handleAcceptInvite(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${AUTH_PREFIX}/verify-email`) {
    return handleVerifyEmail(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${AUTH_PREFIX}/google/start`) {
    return handleGoogleStart(parsed, response, deps);
  }
  if (parsed.method === "GET" && parsed.pathname === `${AUTH_PREFIX}/google/callback`) {
    return handleGoogleCallback(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/google/exchange`) {
    return handleGoogleExchange(parsed, response, deps);
  }
  if (parsed.method === "POST" && parsed.pathname === `${AUTH_PREFIX}/exchange-code`) {
    return handleExchangeCode(parsed, response, deps);
  }

  writeJson(response, 404, { error: "not_found" });
  return true;
}

async function handleRegister(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(body.password ?? "");
  const orgNameInput = String(body.orgName ?? body.displayName ?? "").trim();

  if (!consumeAuthRateLimit(authClientKey(parsed.headers, email))) {
    writeJson(response, 429, {
      error: "rate_limited",
      message: "Too many attempts. Try again in a few minutes."
    });
    return true;
  }

  if (!isValidEmail(email)) {
    writeJson(response, 400, { error: "invalid_email", message: "Enter a valid email address." });
    return true;
  }
  const passwordError = validatePasswordStrength(password, deps.authConfig.passwordMinLength);
  if (passwordError) {
    writeJson(response, 400, { error: "weak_password", message: passwordError });
    return true;
  }

  const existing = await deps.userStore!.findActiveUserByEmail(email);
  if (existing) {
    writeJson(response, 409, {
      error: "email_taken",
      message: "An account with this email already exists. Sign in or reset your password."
    });
    return true;
  }

  const orgName = orgNameInput || deriveOrgName(email);
  const org = await deps.orgStore!.createOrganization(orgName, "free");
  const user = await deps.userStore!.createUser(org.id, email, "admin");
  await deps.authIdentityStore!.createPasswordIdentity(user.id, hashPassword(password));

  const verifyToken = await deps.authTokenStore!.createToken(user.id, "email_verify", 24 * 60 * 60 * 1000);
  const verifyUrl = `${deps.authConfig.marketingBaseUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`;
  await deps.emailService?.sendEmailVerification({ to: email, verifyUrl, orgName: org.name });

  const session = await issueSession(deps, user.id, org.id, "password");
  await audit(deps, user.id, org.id, "auth.register", { method: "password" });

  writeJson(response, 201, {
    ...session,
    orgId: org.id,
    orgName: org.name,
    email,
    plan: "free",
    adminPortalLoginUrl: adminPortalLoginUrl(deps.authConfig.adminPortalUrl)
  });
  return true;
}

async function handleLogin(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(body.password ?? "");

  if (!consumeAuthRateLimit(authClientKey(parsed.headers, email))) {
    writeJson(response, 429, {
      error: "rate_limited",
      message: "Too many attempts. Try again in a few minutes."
    });
    return true;
  }

  if (!email || !password) {
    writeJson(response, 400, { error: "invalid_credentials", message: "Enter your email and password." });
    return true;
  }

  const user = await deps.userStore!.findActiveUserByEmail(email);
  if (!user) {
    writeJson(response, 401, { error: "invalid_credentials", message: "Email or password is incorrect." });
    return true;
  }

  const allowed = await checkAuthMethodAllowed(deps, user.orgId, "password");
  if (!allowed.ok) {
    writeJson(response, 403, { error: allowed.error, message: allowed.message });
    return true;
  }

  const valid = await deps.authIdentityStore!.verifyPassword(user.id, password, verifyPassword);
  if (!valid) {
    writeJson(response, 401, { error: "invalid_credentials", message: "Email or password is incorrect." });
    return true;
  }

  const session = await issueSession(deps, user.id, user.orgId, "password");
  const org = await deps.orgStore!.getOrganization(user.orgId);
  await audit(deps, user.id, user.orgId, "auth.login", { method: "password" });

  writeJson(response, 200, {
    ...session,
    orgId: user.orgId,
    orgName: org?.name ?? "",
    email: user.email,
    plan: org?.plan ?? "free",
    adminPortalLoginUrl: adminPortalLoginUrl(deps.authConfig.adminPortalUrl)
  });
  return true;
}

async function handleLogout(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const token = extractBearerToken(parsed.headers);
  if (token?.startsWith("coop_sess_")) {
    await deps.userStore!.revokeSessionByToken(token);
  }
  const body = asRecord(parsed.body);
  const refreshToken = String(body.refreshToken ?? "").trim();
  if (refreshToken) {
    await deps.authTokenStore!.markRefreshTokenUsed(refreshToken);
  }
  writeJson(response, 200, { ok: true });
  return true;
}

async function handleRefresh(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const refreshToken = String(body.refreshToken ?? "").trim();
  if (!refreshToken) {
    writeJson(response, 400, { error: "missing_refresh_token" });
    return true;
  }

  const peeked = await deps.authTokenStore!.peekToken(refreshToken, "refresh");
  if (!peeked) {
    writeJson(response, 401, { error: "invalid_refresh_token" });
    return true;
  }

  const user = await deps.userStore!.getUser(peeked.userId);
  if (!user || user.deactivatedAt) {
    writeJson(response, 401, { error: "invalid_refresh_token" });
    return true;
  }

  const providerRaw = String(peeked.metadata?.authProvider ?? "password");
  const authProvider: "password" | "google" =
    providerRaw === "google" ? "google" : "password";
  const allowed = await checkAuthMethodAllowed(deps, user.orgId, authProvider);
  if (!allowed.ok) {
    writeJson(response, 403, { error: allowed.error, message: allowed.message });
    return true;
  }

  await deps.authTokenStore!.markRefreshTokenUsed(refreshToken);
  const session = await issueSession(deps, user.id, user.orgId, authProvider);
  writeJson(response, 200, session);
  return true;
}

async function handleForgotPassword(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();

  if (!consumeAuthRateLimit(authClientKey(parsed.headers, email))) {
    writeJson(response, 429, {
      error: "rate_limited",
      message: "Too many attempts. Try again in a few minutes."
    });
    return true;
  }

  writeJson(response, 200, {
    ok: true,
    message: "If an account exists for that email, we sent a reset link."
  });

  if (!isValidEmail(email)) {
    return true;
  }

  const user = await deps.userStore!.findActiveUserByEmail(email);
  if (!user) {
    return true;
  }

  const resetToken = await deps.authTokenStore!.createToken(user.id, "password_reset", 60 * 60 * 1000);
  const resetUrl = `${deps.authConfig.marketingBaseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  await deps.emailService?.sendPasswordReset({ to: email, resetUrl, orgName: "" });
  await audit(deps, user.id, user.orgId, "auth.password_reset_requested", {});
  return true;
}

async function handleResetPassword(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");

  if (!consumeAuthRateLimit(authClientKey(parsed.headers, token.slice(0, 16)))) {
    writeJson(response, 429, {
      error: "rate_limited",
      message: "Too many attempts. Try again in a few minutes."
    });
    return true;
  }

  const passwordError = validatePasswordStrength(password, deps.authConfig.passwordMinLength);
  if (passwordError) {
    writeJson(response, 400, { error: "weak_password", message: passwordError });
    return true;
  }

  const consumed = await deps.authTokenStore!.consumeToken(token, "password_reset");
  if (!consumed) {
    writeJson(response, 400, { error: "invalid_token", message: "This reset link is invalid or expired." });
    return true;
  }

  const user = await deps.userStore!.getUser(consumed.userId);
  if (!user) {
    writeJson(response, 400, { error: "invalid_token" });
    return true;
  }

  await deps.authIdentityStore!.setPasswordHash(user.id, hashPassword(password));
  await deps.authTokenStore!.revokeRefreshTokens(user.id);
  await deps.userStore!.revokeUserSessions(user.id);
  await audit(deps, user.id, user.orgId, "auth.password_reset", {});

  writeJson(response, 200, {
    ok: true,
    message: "Password updated. Sign in with your new password.",
    adminPortalLoginUrl: adminPortalLoginUrl(deps.authConfig.adminPortalUrl)
  });
  return true;
}

async function handleAcceptInvitePreview(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const token = parsed.query?.get("token")?.trim() ?? "";
  if (!token) {
    writeJson(response, 400, { error: "missing_token", message: "Invitation link is missing or malformed." });
    return true;
  }

  const peeked = await deps.authTokenStore!.peekToken(token, "user_invite");
  if (!peeked) {
    writeJson(response, 400, {
      error: "invalid_token",
      message: "This invitation link is invalid or has expired."
    });
    return true;
  }

  const user = await deps.userStore!.getUser(peeked.userId);
  if (!user || user.deactivatedAt) {
    writeJson(response, 400, { error: "invalid_token", message: "This invitation link is invalid or has expired." });
    return true;
  }

  const org = await deps.orgStore!.getOrganization(user.orgId);
  const metadata = peeked.metadata ?? {};
  writeJson(response, 200, {
    email: user.email,
    orgName: String(metadata.orgName ?? org?.name ?? ""),
    invitedBy: metadata.invitedBy ? String(metadata.invitedBy) : undefined
  });
  return true;
}

async function handleAcceptInvite(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const timezone = String(body.timezone ?? "").trim();

  if (!token) {
    writeJson(response, 400, { error: "missing_token", message: "Invitation link is missing or malformed." });
    return true;
  }

  if (!firstName || !lastName) {
    writeJson(response, 400, { error: "missing_profile", message: "First and last name are required." });
    return true;
  }

  if (!timezone) {
    writeJson(response, 400, { error: "missing_timezone", message: "Select your timezone." });
    return true;
  }

  const passwordError = validatePasswordStrength(password, deps.authConfig.passwordMinLength);
  if (passwordError) {
    writeJson(response, 400, { error: "weak_password", message: passwordError });
    return true;
  }

  const consumed = await deps.authTokenStore!.consumeToken(token, "user_invite");
  if (!consumed) {
    writeJson(response, 400, {
      error: "invalid_token",
      message: "This invitation link is invalid or has expired."
    });
    return true;
  }

  const user = await deps.userStore!.getUser(consumed.userId);
  if (!user || user.deactivatedAt) {
    writeJson(response, 400, { error: "invalid_token", message: "This invitation link is invalid or has expired." });
    return true;
  }

  const allowed = await checkAuthMethodAllowed(deps, user.orgId, "password");
  if (!allowed.ok) {
    writeJson(response, 403, { error: allowed.error, message: allowed.message });
    return true;
  }

  await deps.authIdentityStore!.setPasswordHash(user.id, hashPassword(password));
  await deps.authIdentityStore!.markEmailVerified(user.id, "password");
  await deps.userStore!.updateUserProfile(user.id, { firstName, lastName, timezone });
  await audit(deps, user.id, user.orgId, "auth.invite_accepted", { method: "password" });

  const session = await issueSession(deps, user.id, user.orgId, "password");
  const org = await deps.orgStore!.getOrganization(user.orgId);

  writeJson(response, 200, {
    ...session,
    orgId: user.orgId,
    orgName: org?.name ?? "",
    email: user.email,
    plan: org?.plan ?? "free",
    adminPortalLoginUrl: adminPortalLoginUrl(deps.authConfig.adminPortalUrl)
  });
  return true;
}

async function handleVerifyEmail(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const token = parsed.query?.get("token")?.trim() ?? "";
  const consumed = await deps.authTokenStore!.consumeToken(token, "email_verify");
  if (!consumed) {
    writeJson(response, 400, { error: "invalid_token", message: "This verification link is invalid or expired." });
    return true;
  }
  await deps.authIdentityStore!.markEmailVerified(consumed.userId, "password");
  writeJson(response, 200, {
    ok: true,
    message: "Email verified. You can sign in now.",
    adminPortalLoginUrl: adminPortalLoginUrl(deps.authConfig.adminPortalUrl)
  });
  return true;
}

async function handleGoogleStart(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  if (!deps.googleAuth) {
    writeJson(response, 503, { error: "google_auth_unavailable" });
    return true;
  }

  const redirect = sanitizeAuthRedirect(
    parsed.query?.get("redirect"),
    authRedirectAllowlistFromConfig(deps.authConfig)
  );
  const mode = parsed.query?.get("mode") === "signup" ? "signup" : "login";
  const orgName = parsed.query?.get("orgName")?.trim() || undefined;
  const callbackUri = resolveGoogleCallbackUri(parsed, deps.authConfig);
  if (!callbackUri) {
    writeJson(response, 400, {
      error: "invalid_redirect_uri",
      message: "OAuth redirect URI is not allowed.",
      allowedRedirectUris: allowedGoogleRedirectUris(deps.authConfig)
    });
    return true;
  }
  const url = deps.googleAuth.buildAuthorizeUrl(callbackUri, { redirect, mode, orgName, plan: "free" });
  response.writeHead(302, { location: url });
  response.end();
  return true;
}

async function handleGoogleCallback(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const fallbackLogin = `${deps.authConfig.adminPortalUrl.replace(/\/$/, "")}/login`;
  const callbackUri = defaultGoogleCallbackUri(deps.authConfig);
  const result = await completeGoogleOAuth(parsed, deps, callbackUri, fallbackLogin);
  if (!result.ok) {
    deliverAuthError(response, result.redirect, result.error, result.message, result.status);
    return true;
  }
  deliverSessionToken(response, result.accessToken, result.clientRedirect, result.refreshToken);
  return true;
}

async function handleGoogleExchange(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const fallbackLogin = `${deps.authConfig.adminPortalUrl.replace(/\/$/, "")}/login`;
  const body = asRecord(parsed.body);
  const code = String(body.code ?? "").trim();
  const stateRaw = String(body.state ?? "").trim();
  const redirectUri = String(body.redirectUri ?? "").trim();

  if (!code || !stateRaw || !redirectUri) {
    writeJson(response, 400, { error: "invalid_request", message: "Missing code, state, or redirectUri." });
    return true;
  }
  if (!isAllowedGoogleRedirectUri(deps.authConfig, redirectUri)) {
    writeJson(response, 400, {
      error: "invalid_redirect_uri",
      message: "OAuth redirect URI is not allowed.",
      allowedRedirectUris: allowedGoogleRedirectUris(deps.authConfig)
    });
    return true;
  }

  const syntheticParsed: ParsedRequest = {
    ...parsed,
    query: new URLSearchParams({ code, state: stateRaw })
  };
  const result = await completeGoogleOAuth(
    syntheticParsed,
    deps,
    redirectUri.replace(/\/$/, ""),
    fallbackLogin
  );
  if (!result.ok) {
    writeJson(response, result.status, { error: result.error, message: result.message });
    return true;
  }

  writeJson(response, 200, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    redirect: result.clientRedirect
  });
  return true;
}

function resolveGoogleCallbackUri(parsed: ParsedRequest, config: AuthConfig): string | undefined {
  const requested = parsed.query?.get("redirectUri")?.trim();
  if (!requested) {
    return defaultGoogleCallbackUri(config);
  }
  const normalized = requested.replace(/\/$/, "");
  if (!isAllowedGoogleRedirectUri(config, normalized)) {
    return undefined;
  }
  return normalized;
}

type GoogleOAuthResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
      clientRedirect?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      redirect?: string;
    };

async function completeGoogleOAuth(
  parsed: ParsedRequest,
  deps: UserAuthApiDeps,
  callbackUri: string,
  fallbackLogin: string
): Promise<GoogleOAuthResult> {
  if (!deps.googleAuth) {
    return { ok: false, status: 503, error: "google_auth_unavailable", message: "Google sign-in is not configured." };
  }

  const error = parsed.query?.get("error");
  if (error) {
    return {
      ok: false,
      status: 400,
      error: "google_auth_denied",
      message: "Google sign-in was cancelled.",
      redirect: fallbackLogin
    };
  }

  const code = parsed.query?.get("code")?.trim();
  const stateRaw = parsed.query?.get("state")?.trim();
  if (!code || !stateRaw) {
    return {
      ok: false,
      status: 400,
      error: "invalid_callback",
      message: "Google sign-in callback was incomplete.",
      redirect: fallbackLogin
    };
  }

  const state = deps.googleAuth.parseState(stateRaw);
  if (!state) {
    return {
      ok: false,
      status: 400,
      error: "invalid_state",
      message: "Google sign-in session expired. Try again.",
      redirect: fallbackLogin
    };
  }

  const clientRedirect = sanitizeAuthRedirect(
    state.redirect,
    authRedirectAllowlistFromConfig(deps.authConfig)
  );

  let profile;
  try {
    profile = await deps.googleAuth.exchangeCode(code, callbackUri);
  } catch (err) {
    console.error("[auth] google token exchange failed:", err);
    return {
      ok: false,
      status: 502,
      error: "google_exchange_failed",
      message: "Google sign-in failed. Try again.",
      redirect: clientRedirect ?? fallbackLogin
    };
  }

  let sessionResult;
  try {
    sessionResult = await resolveGoogleUser(deps, profile, state);
  } catch (err) {
    console.error("[auth] google sign-in failed after token exchange:", err);
    return {
      ok: false,
      status: 500,
      error: "google_signin_failed",
      message: err instanceof Error ? err.message : "Google sign-in failed.",
      redirect: clientRedirect ?? fallbackLogin
    };
  }
  if (!sessionResult.ok) {
    return {
      ok: false,
      status: sessionResult.status,
      error: sessionResult.error,
      message: sessionResult.message,
      redirect: clientRedirect ?? fallbackLogin
    };
  }

  return {
    ok: true,
    accessToken: sessionResult.accessToken,
    refreshToken: sessionResult.refreshToken,
    clientRedirect
  };
}

async function handleExchangeCode(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: UserAuthApiDeps
): Promise<boolean> {
  const body = asRecord(parsed.body);
  const code = String(body.code ?? "").trim();
  const consumed = await deps.authTokenStore!.consumeToken(code, "auth_code");
  if (!consumed) {
    writeJson(response, 401, { error: "invalid_code" });
    return true;
  }
  const user = await deps.userStore!.getUser(consumed.userId);
  if (!user) {
    writeJson(response, 401, { error: "invalid_code" });
    return true;
  }
  const provider = (consumed.metadata?.authProvider as string) || "google";
  const session = await issueSession(deps, user.id, user.orgId, provider as "password" | "google" | "saml");
  writeJson(response, 200, session);
  return true;
}

async function resolveGoogleUser(
  deps: UserAuthApiDeps,
  profile: { sub: string; email: string; emailVerified: boolean },
  state: { mode: "login" | "signup"; orgName?: string }
): Promise<
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; error: string; message: string }
> {
  if (!profile.emailVerified) {
    return {
      ok: false,
      status: 403,
      error: "email_not_verified",
      message: "Verify your Google email address, then try again."
    };
  }

  let user = await deps.userStore!.findActiveUserByEmail(profile.email);
  const googleIdentity = await deps.authIdentityStore!.findGoogleIdentity(profile.sub);

  if (googleIdentity) {
    user = await deps.userStore!.getUser(googleIdentity.userId);
  }

  if (!user) {
    const orgName = state.orgName?.trim() || deriveOrgName(profile.email);
    const org = await deps.orgStore!.createOrganization(orgName, "free");
    user = await deps.userStore!.createUser(org.id, profile.email, "admin");
    await deps.authIdentityStore!.createGoogleIdentity(user.id, profile.sub, new Date());
    const loginUrl = adminPortalFreshLoginUrl(deps.authConfig.adminPortalUrl, {
      email: profile.email
    });
    try {
      await deps.emailService?.sendFreeSignupWelcome({
        to: profile.email,
        orgName: org.name,
        adminPortalUrl: loginUrl
      });
    } catch (err) {
      console.error("[auth] welcome email failed after google signup:", err);
    }
    await audit(deps, user.id, org.id, "auth.register", { method: "google" });
  } else {
    const allowed = await checkAuthMethodAllowed(deps, user.orgId, "google");
    if (!allowed.ok) {
      return { ok: false, status: 403, error: allowed.error!, message: allowed.message! };
    }
    if (!googleIdentity) {
      await deps.authIdentityStore!.createGoogleIdentity(user.id, profile.sub, new Date());
    }
    await audit(deps, user.id, user.orgId, "auth.login", { method: "google" });
  }

  const session = await issueSession(deps, user!.id, user!.orgId, "google");
  return { ok: true, accessToken: session.accessToken, refreshToken: session.refreshToken };
}

async function issueSession(
  deps: UserAuthApiDeps,
  userId: string,
  orgId: string,
  authProvider: "password" | "google" | "saml"
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const created = await deps.userStore!.createSession(userId, orgId, {
    ttlMs: deps.authConfig.accessTtlMs,
    authProvider
  });
  const refreshToken = await deps.authTokenStore!.createToken(
    userId,
    "refresh",
    deps.authConfig.refreshTtlMs,
    { authProvider }
  );
  return {
    accessToken: created.token,
    refreshToken,
    expiresAt: created.expiresAt.toISOString()
  };
}

async function checkAuthMethodAllowed(
  deps: UserAuthApiDeps,
  orgId: string,
  method: "password" | "google"
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const org = await deps.orgStore!.getOrganization(orgId);
  if (!org) {
    return { ok: false, error: "org_not_found", message: "Organization not found." };
  }
  if (org.plan !== "enterprise") {
    return { ok: true };
  }
  const policy = await loadOrgAuthPolicy(deps, orgId);
  if (!policy.ok) {
    return { ok: false, error: policy.error, message: policy.message };
  }
  if (policy.requireSso) {
    return {
      ok: false,
      error: "sso_required",
      message: "Your organization requires SSO sign-in. Use Sign in with SSO."
    };
  }
  if (method === "password" && !policy.allowPassword) {
    return { ok: false, error: "password_disabled", message: "Password sign-in is disabled for your organization." };
  }
  if (method === "google" && !policy.allowGoogle) {
    return { ok: false, error: "google_disabled", message: "Google sign-in is disabled for your organization." };
  }
  return { ok: true };
}

type LoadedOrgAuthPolicy =
  | { ok: true; requireSso: boolean; allowPassword: boolean; allowGoogle: boolean }
  | { ok: false; error: string; message: string };

async function loadOrgAuthPolicy(deps: UserAuthApiDeps, orgId: string): Promise<LoadedOrgAuthPolicy> {
  const pool = deps.pool ?? (await getDbPool());
  if (!pool) {
    return {
      ok: false,
      error: "auth_policy_unavailable",
      message: "Unable to verify your organization's sign-in policy. Try again later or contact your administrator."
    };
  }
  try {
    const result = await pool.query(
      `SELECT require_sso, allow_password, allow_google FROM org_auth_policy WHERE org_id = $1`,
      [orgId]
    );
    const row = result.rows[0];
    if (!row) {
      return { ok: true, requireSso: false, allowPassword: true, allowGoogle: true };
    }
    return {
      ok: true,
      requireSso: Boolean(row.require_sso),
      allowPassword: row.allow_password !== false,
      allowGoogle: row.allow_google !== false
    };
  } catch {
    return {
      ok: false,
      error: "auth_policy_unavailable",
      message: "Unable to verify your organization's sign-in policy. Try again later or contact your administrator."
    };
  }
}

async function audit(
  deps: UserAuthApiDeps,
  userId: string,
  orgId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await deps.auditLogger?.record({
    orgId,
    userId,
    action,
    metadata,
    principal: principalForUser(userId)
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function deriveOrgName(email: string): string {
  const local = email.split("@")[0]?.trim();
  return local || "My Workspace";
}
