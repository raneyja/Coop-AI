import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BillingApiDeps } from "./billingApi";
import { loadBillingConfig } from "./billingConfig";
import { fulfillPaidCheckoutSession, readStripeCustomerId } from "./fulfillCheckout";
import { decryptCredential, encryptCredential } from "../credentialCrypto";
import { EmailService, type PreparedEmail, type WelcomeEmailParams } from "../email/emailService";
import { homogeneousUsageTier, isMixedSeatInventory, parseStripeItemsToInventory, seatInventoryTotal } from "./seatInventory";
import { stripePriceIdForUsageTier, usageTierFromStripePriceId } from "../usageTiers";
import { isTerminalStripeSubscriptionStatus, type StripeService, type StripeSubscription } from "./stripeService";

const LEASE_SECONDS = 120;
type Resource = { id: string; type: string; resourceId: string; customerId: string };
type Claim = { kind: "claimed"; attempt: string } | { kind: "duplicate" | "in_progress" };
export class BillingRecoveryError extends Error {}

export async function readCheckoutReceipt(sql: Pick<Pool,"query">,sessionId: string): Promise<{
  customerId: string; subscriptionId: string; orgId: string;
} | undefined> {
  const receipt = await sql.query("SELECT customer_id,subscription_id,org_id FROM billing_checkout_receipts WHERE session_id=$1",[sessionId]);
  const row = receipt.rows[0];
  return row ? { customerId: row.customer_id,subscriptionId: row.subscription_id,orgId: row.org_id } : undefined;
}

/** Keep only provider identifiers; recovery never replays stored metadata or PII. */
function resource(event: Record<string, unknown>): Resource {
  const data = record(event.data), object = record(data.object);
  const id = String(event.id ?? ""), type = String(event.type ?? "");
  if (!id || id.length > 255 || !type || type.length > 128) throw new BillingRecoveryError("Invalid billing event identity");
  return { id, type, resourceId: String(object.id ?? ""), customerId: readStripeCustomerId(object.customer) };
}

async function claim(pool: Pool, item: Resource): Promise<Claim> {
  const attempt = randomUUID();
  const claimed = await pool.query(
    `INSERT INTO stripe_webhook_events(event_id,event_type,status,attempt_token,lease_expires_at,attempt_count,resource_id,customer_id)
     VALUES($1,$2,'processing',$3,clock_timestamp()+$6*INTERVAL '1 second',1,$4,$5)
     ON CONFLICT(event_id) DO UPDATE SET status='processing',attempt_token=$3,
       lease_expires_at=clock_timestamp()+$6*INTERVAL '1 second',attempt_count=stripe_webhook_events.attempt_count+1,
       resource_id=COALESCE(stripe_webhook_events.resource_id,$4),customer_id=COALESCE(stripe_webhook_events.customer_id,$5)
     WHERE stripe_webhook_events.event_type=$2 AND
       (stripe_webhook_events.status='failed' OR (stripe_webhook_events.status='processing' AND
         (stripe_webhook_events.lease_expires_at IS NULL OR stripe_webhook_events.lease_expires_at<=clock_timestamp())))
     RETURNING event_id`, [item.id,item.type,attempt,item.resourceId || null,item.customerId || null,LEASE_SECONDS]);
  if (claimed.rowCount === 1) return { kind: "claimed", attempt };
  const current = await pool.query("SELECT status,event_type FROM stripe_webhook_events WHERE event_id=$1", [item.id]);
  if (current.rows[0]?.event_type !== item.type) throw new BillingRecoveryError("Billing event identity conflict");
  return { kind: current.rows[0]?.status === "completed" ? "duplicate" : "in_progress" };
}

/** Effect and completion commit together; an expired/replaced attempt cannot commit. */
export async function processBillingEvent(deps: BillingApiDeps, stripe: StripeService,
  event: Record<string, unknown>): Promise<"completed" | "duplicate" | "in_progress"> {
  if (!deps.pool || !deps.orgStore || !deps.userStore || !deps.emailService) throw new BillingRecoveryError("Billing storage unavailable");
  const item = resource(event), owned = await claim(deps.pool,item);
  if (owned.kind !== "claimed") return owned.kind;
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    const state = await client.query("SELECT attempt_token,status,resource_id,customer_id FROM stripe_webhook_events WHERE event_id=$1 FOR UPDATE", [item.id]);
    if (state.rows[0]?.attempt_token !== owned.attempt || state.rows[0]?.status !== "processing") throw new BillingRecoveryError("Billing attempt replaced");
    // Persisted resource binding remains authoritative even when the retry body differs.
    item.resourceId = state.rows[0].resource_id ?? ""; item.customerId = state.rows[0].customer_id ?? "";
    await fence(client,item.id,owned.attempt);
    const orgs = deps.orgStore.inTransaction(client), users = deps.userStore.inTransaction(client);
    if (item.type === "checkout.session.completed") {
      await checkout(client,deps,stripe,item,orgs,users);
    } else if (["customer.subscription.updated","customer.subscription.deleted","invoice.payment_failed"].includes(item.type)) {
      if (!item.customerId.startsWith("cus_")) throw new BillingRecoveryError("Billing customer is unavailable");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing/customer/${item.customerId}`]);
      let org = await orgs.findOrganizationByStripeCustomerId(item.customerId);
      let linking: StripeSubscription | undefined;
      if (!org && item.type !== "invoice.payment_failed" && item.resourceId.startsWith("sub_")) {
        const current = await stripe.retrieveSubscription(item.resourceId);
        if (current.id !== item.resourceId || current.customer !== item.customerId) throw new BillingRecoveryError("Provider subscription binding mismatch");
        const target = current.metadata?.existing_org_id;
        if (target && current.metadata?.upgrade === "true") {
          await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [target]);
          const candidate = await orgs.getOrganization(target), billing = await orgs.getOrganizationBilling(target);
          if (candidate?.plan === "free" && !billing?.stripeCustomerId && ["active","trialing"].includes(current.status) && !current.paused) {
            org = candidate; linking = await stripe.retrieveSubscription(item.resourceId);
            if (linking.customer !== item.customerId || linking.metadata?.existing_org_id !== target || linking.metadata?.upgrade !== "true") throw new BillingRecoveryError("Upgrade provider binding changed");
            await orgs.updateOrganizationBilling(target,{ stripeCustomerId: item.customerId,stripeSubscriptionId: linking.id });
          }
        }
      }
      if (org) {
        await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org.id]);
        const billing = await orgs.getOrganizationBilling(org.id);
        if (billing?.stripeSubscriptionId && (item.type === "invoice.payment_failed" || billing.stripeSubscriptionId === item.resourceId)) {
          const current = linking ?? await stripe.retrieveSubscription(billing.stripeSubscriptionId);
          if (current.id !== billing.stripeSubscriptionId || current.customer !== item.customerId) throw new BillingRecoveryError("Provider subscription binding mismatch");
          await applySubscription(orgs,users,org.id,current);
        }
      }
    }
    const completed = await client.query(`UPDATE stripe_webhook_events SET status='completed',processed_at=clock_timestamp(),lease_expires_at=NULL,retry_after=NULL
      WHERE event_id=$1 AND status='processing' AND attempt_token=$2 AND lease_expires_at>clock_timestamp() RETURNING event_id`, [item.id,owned.attempt]);
    if (completed.rowCount !== 1) throw new BillingRecoveryError("Billing attempt expired before completion");
    await client.query("COMMIT");
    return "completed";
  } catch (error) {
    await client.query("ROLLBACK");
    // A failed old worker must not release a newer attempt's claim.
    await deps.pool.query(`UPDATE stripe_webhook_events SET status='failed',lease_expires_at=NULL,
      retry_after=clock_timestamp()+INTERVAL '30 seconds'
      WHERE event_id=$1 AND status='processing' AND attempt_token=$2`, [item.id,owned.attempt]);
    throw error;
  } finally { client.release(); }
}

async function fence(client: PoolClient,id: string,attempt: string) {
  const result = await client.query(`SELECT 1 FROM stripe_webhook_events WHERE event_id=$1 AND status='processing'
    AND attempt_token=$2 AND lease_expires_at>clock_timestamp()`, [id,attempt]);
  if (result.rowCount !== 1) throw new BillingRecoveryError("Billing attempt expired");
}

async function checkout(client: PoolClient,deps: BillingApiDeps,stripe: StripeService,item: Resource,
  orgs: NonNullable<BillingApiDeps["orgStore"]>,users: NonNullable<BillingApiDeps["userStore"]>) {
  if (!item.resourceId.startsWith("cs_")) throw new BillingRecoveryError("Checkout resource unavailable");
  const session = await stripe.retrieveCheckoutSession(item.resourceId);
  const customer = readStripeCustomerId(session.customer), subId = readStripeCustomerId(session.subscription);
  if (session.id !== item.resourceId || !customer.startsWith("cus_") || !subId.startsWith("sub_")) throw new BillingRecoveryError("Checkout provider binding mismatch");
  if (item.customerId && item.customerId !== customer) throw new BillingRecoveryError("Checkout customer changed");
  if (session.status !== "complete" || !["paid","no_payment_required"].includes(session.payment_status)) throw new BillingRecoveryError("Checkout payment not settled");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing/customer/${customer}`]);
  const receipt = await readCheckoutReceipt(client,session.id);
  if (receipt) {
    if (receipt.customerId !== customer || receipt.subscriptionId !== subId) throw new BillingRecoveryError("Checkout receipt binding mismatch");
    return;
  }
  const email = String(session.metadata?.admin_email ?? session.customer_email ?? "").trim().toLowerCase();
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing/email/${email}`]);
  const linked = await orgs.findOrganizationByStripeCustomerId(customer);
  let targetOrgId = linked?.id ?? session.metadata?.existing_org_id;
  if (!targetOrgId) {
    const account = await users.findActiveUserByEmail(email);
    if (account && (await orgs.getOrganization(account.orgId))?.plan === "free") targetOrgId = account.orgId;
  }
  if (targetOrgId) {
    await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [targetOrgId]);
    const existing = await orgs.getOrganizationBilling(targetOrgId);
    if (existing?.stripeCustomerId && existing.stripeCustomerId !== customer) throw new BillingRecoveryError("Checkout target customer conflict");
    // A settled older checkout does not authorize replacing a separately linked
    // current subscription, even when both provider objects remain active.
    if (existing?.stripeSubscriptionId && existing.stripeSubscriptionId !== subId) throw new BillingRecoveryError("Checkout subscription was replaced");
    if (await orgs.isOrgSuspended(targetOrgId)) throw new BillingRecoveryError("Checkout organization is suspended");
  }
  const current = await stripe.retrieveSubscription(subId);
  if (current.id !== subId || current.customer !== customer || !["active","trialing"].includes(current.status) || current.paused) {
    throw new BillingRecoveryError("Checkout subscription is not currently eligible");
  }
  if (!deps.serverConfig.credentialsEncryptionKey) throw new BillingRecoveryError("Billing notification encryption unavailable");
  const config = loadBillingConfig(),prices = { pro: config.stripePriceIdPro,proPlus: config.stripePriceIdProPlus,max: config.stripePriceIdMax };
  const inventory = parseStripeItemsToInventory(current.items,prices);
  if (!seatInventoryTotal(inventory)) throw new BillingRecoveryError("Checkout has no current purchased seats");
  const tier = homogeneousUsageTier(inventory) ?? "pro";
  // Provider pricing/quantity may have changed since the original checkout.
  // Identity/upgrade metadata remains the trusted server-created provenance.
  const admittedSession = { ...session,metadata: { ...session.metadata,seat_count: String(seatInventoryTotal(inventory)),
    usage_tier: tier,stripe_price_id: current.items[0]?.priceId ?? "" } };
  const queue = new CheckoutEmailQueue(client,session.id,customer,deps.serverConfig.credentialsEncryptionKey);
  const fulfilled = await fulfillPaidCheckoutSession(admittedSession, { orgStore: orgs,userStore: users,emailService: queue,
    authTokenStore: deps.authTokenStore?.inTransaction(client),authIdentityStore: deps.authIdentityStore?.inTransaction(client),requireDurableEmail: true });
  await applySubscription(orgs,users,fulfilled.orgId,current);
  await client.query("INSERT INTO billing_checkout_receipts(session_id,customer_id,subscription_id,org_id) VALUES($1,$2,$3,$4)",
    [session.id,customer,subId,fulfilled.orgId]);
  await client.query("INSERT INTO audit_log(org_id,action,principal,metadata) VALUES($1,'billing.checkout.completed','billing:stripe',$2)",
    [fulfilled.orgId,JSON.stringify({ checkoutSessionId: session.id,stripeCustomerId: customer })]);
}

class CheckoutEmailQueue extends EmailService {
  public constructor(private readonly client: PoolClient,private readonly sessionId: string,private readonly customerId: string,private readonly encryptionKey: string) { super(loadBillingConfig()); }
  public override async sendWelcome(params: WelcomeEmailParams) { await this.enqueue("welcome",this.prepareWelcome(params)); }
  public override async sendProUpgradeWelcome(params: WelcomeEmailParams) { await this.enqueue("upgrade",this.prepareProUpgradeWelcome(params)); }
  private async enqueue(kind: "welcome" | "upgrade",message: PreparedEmail) {
    const org = await this.client.query("SELECT id FROM organizations WHERE stripe_customer_id=$1", [this.customerId]);
    // Provisioning owns the org; customer is bound by the verified current session.
    if (!org.rows[0]) throw new BillingRecoveryError("Notification organization unavailable");
    await this.client.query("INSERT INTO billing_email_outbox(delivery_key,org_id,kind,encrypted_payload) VALUES($1,$2,$3,$4)",
      [`billing/checkout/${this.sessionId}`,org.rows[0].id,kind,encryptCredential(JSON.stringify(message),this.encryptionKey)]);
  }
}

async function applySubscription(orgs: NonNullable<BillingApiDeps["orgStore"]>,users: NonNullable<BillingApiDeps["userStore"]>,orgId: string,current: StripeSubscription) {
  const org = await orgs.getOrganization(orgId); if (!org) throw new BillingRecoveryError("Organization unavailable");
  if (await orgs.isOrgSuspended(orgId)) return;
  const config = loadBillingConfig(),prices = { pro: config.stripePriceIdPro,proPlus: config.stripePriceIdProPlus,max: config.stripePriceIdMax };
  const inventory = parseStripeItemsToInventory(current.items,prices),mixed = isMixedSeatInventory(inventory);
  const usageTier = mixed ? org.usageTier ?? "pro" : homogeneousUsageTier(inventory) ?? usageTierFromStripePriceId(current.items[0]?.priceId,prices);
  if (["active","trialing"].includes(current.status) && !current.paused) {
    await orgs.setOrganizationPlan(orgId,"pro");
    await orgs.updateOrganizationBilling(orgId,{ billingStatus: "active",stripeSubscriptionId: current.id,
      seatCount: Math.max(1,seatInventoryTotal(inventory) || current.quantity || 1),usageTier,
      stripePriceId: mixed ? stripePriceIdForUsageTier(usageTier,prices) ?? current.items[0]?.priceId : current.items[0]?.priceId,seatInventory: inventory });
  } else if (isTerminalStripeSubscriptionStatus(current.status)) {
    await orgs.setOrganizationPlan(orgId,"free");
    await orgs.updateOrganizationBilling(orgId,{ billingStatus: current.status === "incomplete_expired" ? "canceled" : current.status,
      usageTier: null,stripePriceId: null,seatCount: 1,seatInventory: { pro: 0,pro_plus: 0,max: 0 } });
    await users.clearOrgUsersUsageTiers(orgId);
  } else {
    await orgs.updateOrganizationBilling(orgId,{ billingStatus: current.paused ? "paused" : current.status });
  }
}

/** Retry immutable mail only within the provider's 24h idempotency window. */
export async function dispatchBillingEmails(deps: BillingApiDeps,limit = 16): Promise<{ sent: number; uncertain: number; failed: number }> {
  if (!deps.pool || !deps.emailService || !deps.serverConfig.credentialsEncryptionKey) throw new BillingRecoveryError("Billing notification dependencies unavailable");
  const result = { sent: 0,uncertain: 0,failed: 0 };
  await deps.pool.query(`UPDATE billing_email_outbox SET status='uncertain',lease_expires_at=NULL WHERE status IN ('pending','sending')
    AND first_attempt_at<clock_timestamp()-INTERVAL '23 hours'`);
  const items = await deps.pool.query(`SELECT delivery_key FROM billing_email_outbox WHERE
    (status='pending' OR (status='sending' AND lease_expires_at<=clock_timestamp())) AND
    (retry_after IS NULL OR retry_after<=clock_timestamp()) ORDER BY created_at LIMIT $1`, [Math.max(1,Math.min(64,limit))]);
  for (const item of items.rows) {
    const attempt = randomUUID();
    const owned = await deps.pool.query(`UPDATE billing_email_outbox SET status='sending',attempt_token=$2,
      first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),lease_expires_at=clock_timestamp()+INTERVAL '60 seconds'
      WHERE delivery_key=$1 AND (status='pending' OR (status='sending' AND lease_expires_at<=clock_timestamp()))
        AND (first_attempt_at IS NULL OR first_attempt_at>clock_timestamp()-INTERVAL '23 hours') RETURNING delivery_key`, [item.delivery_key,attempt]);
    if (!owned.rowCount) continue;
    try {
      await deliverClaimedEmail(deps,item.delivery_key,attempt);
      result.sent++;
    } catch {
      result.failed++;
      await deps.pool.query(`UPDATE billing_email_outbox SET
        status=CASE WHEN first_attempt_at<=clock_timestamp()-INTERVAL '23 hours' THEN 'uncertain' ELSE 'pending' END,
        lease_expires_at=NULL,retry_after=clock_timestamp()+INTERVAL '30 seconds'
        WHERE delivery_key=$1 AND status='sending' AND attempt_token=$2`, [item.delivery_key,attempt]);
    }
  }
  result.uncertain = (await deps.pool.query("SELECT count(*)::int AS n FROM billing_email_outbox WHERE status='uncertain'")).rows[0].n;
  return result;
}

/** Serialize local admission through delivery so reclaim/uncertainty cannot
 * supersede a live attempt. The provider remains external; ambiguous commits
 * recover with the same immutable key/message within its bounded window. */
async function deliverClaimedEmail(deps: BillingApiDeps,key: string,attempt: string): Promise<void> {
  const client = await deps.pool!.connect(),controller = new AbortController();
  const lostConnection = () => controller.abort();
  client.on("error",lostConnection);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
    await client.query("SELECT delivery_key FROM billing_email_outbox WHERE delivery_key=$1 FOR UPDATE",[key]);
    // Evaluate the exact attempt/window using current DB time AFTER row locks.
    // Sampling local clocks before this query is conservative across query waits.
    const wallStart = Date.now(),monotonicStart = performance.now();
    const admitted = await client.query(`SELECT encrypted_payload,
      EXTRACT(EPOCH FROM (LEAST(lease_expires_at,first_attempt_at+INTERVAL '23 hours')-clock_timestamp()))*1000 AS remaining_ms
      FROM billing_email_outbox WHERE delivery_key=$1 AND status='sending' AND attempt_token=$2
        AND lease_expires_at>clock_timestamp() AND first_attempt_at>clock_timestamp()-INTERVAL '23 hours'`,[key,attempt]);
    const row = admitted.rows[0],remaining = Number(row?.remaining_ms);
    if (!row || !Number.isFinite(remaining) || remaining<=0) throw new BillingRecoveryError("Email attempt expired or replaced");
    const duration = Math.max(1,Math.floor(Math.min(15000,remaining)));
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(duration)]);
    const message = JSON.parse(decryptCredential(row.encrypted_payload,deps.serverConfig.credentialsEncryptionKey!)) as PreparedEmail;
    await deps.emailService!.sendPrepared(message,key,{ signal,wallDeadlineMs: wallStart+remaining,monotonicDeadlineMs: monotonicStart+remaining });
    const saved = await client.query(`UPDATE billing_email_outbox SET status='sent',sent_at=clock_timestamp(),encrypted_payload=NULL,lease_expires_at=NULL
      WHERE delivery_key=$1 AND status='sending' AND attempt_token=$2 AND lease_expires_at>clock_timestamp()
        AND first_attempt_at>clock_timestamp()-INTERVAL '23 hours' RETURNING delivery_key`,[key,attempt]);
    if (saved.rowCount!==1) throw new BillingRecoveryError("Email completion admission expired");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { controller.abort();client.off("error",lostConnection);client.release(); }
}

/** Bounded executable recovery, called by the operator CLI or approved scheduler. */
export async function reconcileBilling(deps: BillingApiDeps,stripe: StripeService,limit = 16) {
  if (!deps.pool) throw new BillingRecoveryError("Billing storage unavailable");
  const candidates = await deps.pool.query(`SELECT event_id,event_type,resource_id,customer_id FROM stripe_webhook_events WHERE
    (status='failed' OR (status='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())))
    AND resource_id IS NOT NULL AND (retry_after IS NULL OR retry_after<=clock_timestamp()) ORDER BY processed_at LIMIT $1`, [Math.max(1,Math.min(64,limit))]);
  const result = { completed: 0,failed: 0,legacyUnresolved: 0 };
  for (const row of candidates.rows) {
    try {
      const state = await processBillingEvent(deps,stripe,{ id: row.event_id,type: row.event_type,data: { object: { id: row.resource_id,customer: row.customer_id } } });
      if (state === "completed") result.completed++;
    } catch { result.failed++; }
  }
  result.legacyUnresolved = (await deps.pool.query("SELECT count(*)::int AS n FROM stripe_webhook_events WHERE status<>'completed' AND resource_id IS NULL")).rows[0].n;
  return { ...result,email: await dispatchBillingEmails(deps,limit) };
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
