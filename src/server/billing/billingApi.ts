import type { ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { EmailService } from "../email/emailService";
import { type AuditLogger } from "../audit/auditLogger";
import { requireAuth, requireOrgAdmin, resolveAuthContext, resolveOrgPlanFromDb } from "../authMiddleware";
import { clampSeatCountForPlan } from "../planGates";
import type { ServerConfig } from "../serverConfig";
import { loadBillingConfig } from "./billingConfig";
import { adminPortalLoginUrl } from "./adminPortalUrl";
import { StripeService } from "./stripeService";
import { handleFreeSignupApiRequest } from "../freeSignupApi";
import { provisionOrgFromCheckout } from "./provisionOrg";
import type { AuthIdentityStore } from "../auth/authIdentityStore";
import type { AuthTokenStore } from "../auth/authTokenStore";
import type { AuthConfig } from "../auth/authConfig";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  rawBody: Buffer;
};

export type BillingApiDeps = {
  orgStore?: OrgStore;
  userStore?: UserStore;
  emailService?: EmailService;
  auditLogger?: AuditLogger;
  serverConfig: ServerConfig;
  stripeService?: StripeService;
  pool?: Pool | null;
  authIdentityStore?: AuthIdentityStore;
  authTokenStore?: AuthTokenStore;
  authConfig?: AuthConfig;
};

export async function handleBillingApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps
): Promise<boolean> {
  const billingConfig = loadBillingConfig();
  const stripe = deps.stripeService ?? new StripeService(billingConfig);

  if (parsed.method === "POST" && parsed.pathname === "/webhooks/stripe") {
    return handleStripeWebhook(parsed, response, deps, stripe);
  }

  if (
    await handleFreeSignupApiRequest(
      {
        method: parsed.method,
        pathname: parsed.pathname,
        body: parsed.body
      },
      response,
      {
        orgStore: deps.orgStore,
        userStore: deps.userStore,
        emailService: deps.emailService,
        authIdentityStore: deps.authIdentityStore,
        authTokenStore: deps.authTokenStore,
        authConfig: deps.authConfig
      }
    )
  ) {
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/billing/checkout-session") {
    return handleCreateCheckout(parsed, response, stripe);
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/billing/upgrade-checkout-session") {
    return handleCreateUpgradeCheckout(parsed, response, deps, stripe);
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/billing/checkout-status") {
    return handleCheckoutStatus(parsed, response, deps, stripe);
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/billing/portal-session") {
    return handleBillingPortal(parsed, response, deps, stripe);
  }

  return false;
}

async function handleCreateCheckout(
  parsed: ParsedRequest,
  response: ServerResponse,
  stripe: StripeService
): Promise<boolean> {
  if (!stripe.isConfigured()) {
    writeJson(response, 503, { error: "billing_unavailable", message: "Stripe is not configured on this server." });
    return true;
  }

  const body = asRecord(parsed.body);
  const orgName = String(body.orgName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const seats = Math.max(1, Number(body.seats ?? 1) || 1);

  if (!orgName || !email) {
    writeJson(response, 400, { error: "orgName and email are required" });
    return true;
  }

  if (!isValidEmail(email)) {
    writeJson(response, 400, { error: "invalid_email", message: "Enter a valid email address." });
    return true;
  }

  if (orgName.length > 120) {
    writeJson(response, 400, { error: "orgName too long" });
    return true;
  }

  try {
    const session = await stripe.createCheckoutSession({ orgName, email, seats });
    writeJson(response, 200, { sessionId: session.id, url: session.url });
  } catch (error) {
    writeJson(response, 502, {
      error: "stripe_error",
      message: error instanceof Error ? error.message : "Checkout failed"
    });
  }
  return true;
}

async function handleCreateUpgradeCheckout(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth) || !auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireOrgAdmin(auth, response)) {
    return true;
  }
  if (!deps.orgStore || auth.orgId === "legacy") {
    writeJson(response, 503, { error: "organization database not configured" });
    return true;
  }
  if (!stripe.isConfigured()) {
    writeJson(response, 503, { error: "billing_unavailable", message: "Stripe is not configured on this server." });
    return true;
  }

  const plan = (await resolveOrgPlanFromDb(deps.orgStore, auth)) ?? auth.plan;
  if (plan !== "free") {
    writeJson(response, 409, { error: "upgrade_not_available", message: "Only free organizations can upgrade." });
    return true;
  }

  const body = asRecord(parsed.body);
  const org = await deps.orgStore.getOrganization(auth.orgId);
  const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
  const requestedEmail = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const fallbackSessionEmail =
    auth.userId && deps.userStore ? (await deps.userStore.getUser(auth.userId))?.email?.trim().toLowerCase() : "";
  let fallbackOwnerEmail = "";
  if (!requestedEmail && !billing?.billingEmail?.trim() && !fallbackSessionEmail && deps.userStore) {
    const orgUsers = await deps.userStore.listOrgUsers(auth.orgId);
    const owner = orgUsers.find(
      (user) => (user.role === "admin" || user.role === "owner") && !user.deactivatedAt
    );
    fallbackOwnerEmail = owner?.email?.trim().toLowerCase() ?? "";
  }
  const adminEmail =
    requestedEmail || billing?.billingEmail?.trim().toLowerCase() || fallbackSessionEmail || fallbackOwnerEmail || "";
  const seats = clampSeatCountForPlan("pro", Number(body.seats ?? billing?.seatCount ?? 1) || 1);

  if (!isValidEmail(adminEmail)) {
    writeJson(response, 400, {
      error: "invalid_email",
      message: "An admin email is required to start checkout. Pass `email` in the request body."
    });
    return true;
  }

  try {
    const session = await stripe.createCheckoutSession({
      orgName: org?.name ?? auth.orgName,
      email: adminEmail,
      seats,
      existingOrgId: auth.orgId,
      upgrade: true
    });
    writeJson(response, 200, { sessionId: session.id, url: session.url });
  } catch (error) {
    writeJson(response, 502, {
      error: "stripe_error",
      message: error instanceof Error ? error.message : "Checkout failed"
    });
  }
  return true;
}

async function handleCheckoutStatus(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  const billingConfig = loadBillingConfig();
  const sessionId = parsed.query?.get("session_id")?.trim() ?? "";
  const loginUrl = adminPortalLoginUrl(billingConfig.adminPortalUrl);

  if (!sessionId || !sessionId.startsWith("cs_")) {
    writeJson(response, 400, {
      status: "invalid",
      message: "A valid checkout session is required."
    });
    return true;
  }

  if (!stripe.isConfigured()) {
    writeJson(response, 503, { status: "invalid", message: "Billing is not configured." });
    return true;
  }

  try {
    const session = await stripe.retrieveCheckoutSession(sessionId);
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required" ||
      session.status === "complete";

    if (!paid || session.status === "expired") {
      writeJson(response, 200, {
        status: "invalid",
        message: "This checkout session is not complete.",
        adminPortalLoginUrl: loginUrl
      });
      return true;
    }

    const customerId = readStripeCustomerId(session.customer);
    const metadata = session.metadata ?? {};
    const orgName = metadata.org_name?.trim() || undefined;

    if (!customerId || !deps.orgStore) {
      writeJson(response, 200, {
        status: "pending",
        orgName,
        adminPortalLoginUrl: loginUrl
      });
      return true;
    }

    const org = await deps.orgStore.findOrganizationByStripeCustomerId(customerId);
    if (!org) {
      writeJson(response, 200, {
        status: "pending",
        orgName,
        adminPortalLoginUrl: loginUrl
      });
      return true;
    }

    writeJson(response, 200, {
      status: "ready",
      orgName: org.name,
      adminPortalLoginUrl: loginUrl
    });
  } catch (error) {
    writeJson(response, 502, {
      status: "invalid",
      message: error instanceof Error ? error.message : "Could not verify checkout session."
    });
  }
  return true;
}

async function handleBillingPortal(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  const auth = await resolveAuthContext(
    parsed.headers,
    deps.orgStore,
    deps.serverConfig.legacyApiToken,
    deps.serverConfig.requireApiAuth,
    deps.userStore
  );
  if (!requireAuth(auth, deps.serverConfig.requireApiAuth) || !auth) {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  if (!requireOrgAdmin(auth, response)) return true;
  if (!deps.orgStore || !stripe.isConfigured()) {
    writeJson(response, 503, { error: "billing_unavailable" });
    return true;
  }

  const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
  if (!billing?.stripeCustomerId) {
    writeJson(response, 400, { error: "no_stripe_customer", message: "This org has no Stripe subscription." });
    return true;
  }

  try {
    const portal = await stripe.createBillingPortalSession(billing.stripeCustomerId);
    writeJson(response, 200, { url: portal.url });
  } catch (error) {
    writeJson(response, 502, {
      error: "stripe_error",
      message: error instanceof Error ? error.message : "Portal session failed"
    });
  }
  return true;
}

async function handleStripeWebhook(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: BillingApiDeps,
  stripe: StripeService
): Promise<boolean> {
  if (!deps.orgStore || !deps.userStore || !deps.emailService) {
    writeJson(response, 503, { error: "billing_unavailable" });
    return true;
  }

  const rawBody = parsed.rawBody.toString("utf8");
  let event: Record<string, unknown>;
  try {
    event = stripe.verifyWebhookSignature(rawBody, parsed.headers["stripe-signature"]) as Record<string, unknown>;
  } catch (error) {
    writeJson(response, 400, {
      error: "invalid_signature",
      message: error instanceof Error ? error.message : "Invalid webhook"
    });
    return true;
  }

  const type = String(event.type ?? "");
  const eventId = String(event.id ?? "");
  if (eventId) {
    const claimed = await claimStripeWebhookEvent(deps.pool, eventId, type);
    if (!claimed) {
      writeJson(response, 200, { received: true, duplicate: true });
      return true;
    }
  }

  try {
    if (type === "checkout.session.completed") {
      await handleCheckoutCompleted(event, deps);
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      await handleSubscriptionChange(event, deps);
    } else if (type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event, deps);
    }
  } catch (error) {
    console.error("[stripe] webhook handler error:", error);
    writeJson(response, 500, { error: "webhook_handler_failed" });
    return true;
  }

  writeJson(response, 200, { received: true });
  return true;
}

async function handleCheckoutCompleted(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const session = asRecord(asRecord(event.data).object);
  const customerId = String(session.customer ?? "");
  const subscriptionId = String(session.subscription ?? "");
  const metadata = asRecord(session.metadata);
  const orgName = String(metadata.org_name ?? session.client_reference_id ?? "New Coop Org").trim();
  const adminEmail = String(metadata.admin_email ?? session.customer_email ?? "").trim();
  const seatCount = Math.max(1, Number(metadata.seat_count ?? 1) || 1);
  const existingOrgId = String(metadata.existing_org_id ?? "").trim();
  const upgrade = String(metadata.upgrade ?? "")
    .trim()
    .toLowerCase() === "true";

  if (!customerId || !adminEmail) {
    console.warn("[stripe] checkout.session.completed skipped: missing customer or admin email", {
      customerId: customerId || undefined,
      adminEmail: adminEmail || undefined,
      sessionId: String(session.id ?? "")
    });
    return;
  }

  const provisioned = await provisionOrgFromCheckout(
    deps.orgStore!,
    deps.userStore!,
    deps.emailService!,
    loadBillingConfig(),
    {
      orgName,
      adminEmail,
      seatCount,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      existingOrgId: existingOrgId || undefined,
      upgrade
    }
  );

  await deps.auditLogger?.record({
    orgId: provisioned.orgId,
    action: "billing.checkout.completed",
    metadata: { orgName, adminEmail, seatCount, stripeCustomerId: customerId, existingOrgId, upgrade }
  });
}

async function handleSubscriptionChange(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const object = asRecord(asRecord(event.data).object);
  const customerId = String(object.customer ?? "");
  const status = String(object.status ?? "");
  const org = customerId ? await deps.orgStore!.findOrganizationByStripeCustomerId(customerId) : undefined;
  if (!org) return;

  const quantity = readSubscriptionQuantity(object);

  if (status === "active" || status === "trialing") {
    await deps.orgStore!.setOrganizationPlan(org.id, "pro");
    await deps.orgStore!.updateOrganizationBilling(org.id, {
      billingStatus: "active",
      stripeSubscriptionId: String(object.id ?? ""),
      seatCount: quantity
    });
  } else if (status === "canceled" || status === "unpaid") {
    await deps.orgStore!.setOrganizationPlan(org.id, "free");
    await deps.orgStore!.updateOrganizationBilling(org.id, { billingStatus: status });
  }
}

async function handleInvoicePaymentFailed(event: Record<string, unknown>, deps: BillingApiDeps): Promise<void> {
  const object = asRecord(asRecord(event.data).object);
  const customerId = String(object.customer ?? "");
  const org = customerId ? await deps.orgStore!.findOrganizationByStripeCustomerId(customerId) : undefined;
  if (!org) return;

  await deps.orgStore!.updateOrganizationBilling(org.id, { billingStatus: "past_due" });
}

async function claimStripeWebhookEvent(
  pool: Pool | null | undefined,
  eventId: string,
  eventType: string
): Promise<boolean> {
  if (!pool) {
    return true;
  }
  try {
    const result = await pool.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[stripe] webhook dedup check failed for ${eventId}: ${message}`);
    return true;
  }
}

function readSubscriptionQuantity(object: Record<string, unknown>): number {
  const items = asRecord(object.items);
  const data = Array.isArray(items.data) ? items.data : [];
  const first = data[0];
  if (typeof first === "object" && first !== null) {
    const qty = Number((first as Record<string, unknown>).quantity);
    if (Number.isFinite(qty) && qty > 0) {
      return Math.floor(qty);
    }
  }
  const direct = Number(object.quantity);
  return Number.isFinite(direct) && direct > 0 ? Math.floor(direct) : 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readStripeCustomerId(customer: unknown): string {
  if (typeof customer === "string") {
    return customer;
  }
  if (typeof customer === "object" && customer !== null && "id" in customer) {
    return String((customer as { id?: unknown }).id ?? "");
  }
  return "";
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
