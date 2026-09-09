import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingConfig } from "./billingConfig";
import type { UsageTier } from "../usageTiers";
import type { SubscriptionItemUpdate } from "./seatInventory";

export type StripeSubscriptionItem = {
  id: string;
  quantity: number;
  priceId?: string;
};

type StripeSession = { id: string; url: string | null };
type StripePortal = { url: string };
export type StripeSubscription = {
  id: string;
  status: string;
  quantity?: number;
  itemId?: string;
  priceId?: string;
  items: StripeSubscriptionItem[];
  paused?: boolean;
};

export type StripeCheckoutSession = {
  id: string;
  payment_status: string;
  status: string;
  customer: string | { id?: string } | null;
  customer_email: string | null;
  metadata?: Record<string, string>;
};

export class StripeService {
  public constructor(private readonly config: BillingConfig) {}

  public isConfigured(): boolean {
    return Boolean(this.config.stripeSecretKey && this.config.stripePriceIdPro);
  }

  public async createCheckoutSession(input: {
    orgName: string;
    email: string;
    seats: number;
    existingOrgId?: string;
    upgrade?: boolean;
    priceId?: string;
    usageTier?: UsageTier;
    intent?: "individual" | "team";
    googleSub?: string;
  }): Promise<StripeSession> {
    const priceId = input.priceId?.trim() || this.config.stripePriceIdPro;
    if (!priceId) {
      throw new Error("STRIPE_PRICE_ID_PRO is not configured");
    }
    const usageTier = input.usageTier ?? "pro";
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("customer_email", input.email);
    params.set("success_url", `${this.config.checkoutSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", this.config.checkoutCancelUrl);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", String(Math.max(1, input.seats)));
    params.set("metadata[org_name]", input.orgName);
    params.set("metadata[admin_email]", input.email);
    params.set("metadata[seat_count]", String(Math.max(1, input.seats)));
    params.set("metadata[usage_tier]", usageTier);
    params.set("metadata[stripe_price_id]", priceId);
    if (input.intent) {
      params.set("metadata[checkout_intent]", input.intent);
    }
    if (input.googleSub) {
      params.set("metadata[google_sub]", input.googleSub);
    }
    params.set("subscription_data[metadata][org_name]", input.orgName);
    params.set("subscription_data[metadata][usage_tier]", usageTier);
    if (input.existingOrgId) {
      params.set("metadata[existing_org_id]", input.existingOrgId);
      params.set("subscription_data[metadata][existing_org_id]", input.existingOrgId);
    }
    if (input.upgrade) {
      params.set("metadata[upgrade]", "true");
      params.set("subscription_data[metadata][upgrade]", "true");
    }

    return this.postForm<StripeSession>("/v1/checkout/sessions", params);
  }

  public async retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
    if (!this.config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${this.config.stripeSecretKey}` }
      }
    );
    const json = (await response.json().catch(() => ({}))) as StripeCheckoutSession & {
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(json.error?.message ?? `Stripe request failed (${response.status})`);
    }
    return json;
  }

  public async createBillingPortalSession(
    customerId: string,
    options?: {
      subscriptionId?: string;
      subscriptionItemId?: string;
      quantity?: number;
      /** Stripe portal configuration id (bpc_...). Selects which portal experience to serve. */
      configurationId?: string;
    }
  ): Promise<StripePortal> {
    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", this.config.billingPortalReturnUrl);
    if (options?.configurationId) {
      params.set("configuration", options.configurationId);
    }
    if (
      options?.subscriptionId &&
      options.subscriptionItemId &&
      options.quantity != null &&
      options.quantity >= 1
    ) {
      params.set("flow_data[type]", "subscription_update_confirm");
      params.set("flow_data[subscription_update_confirm][subscription]", options.subscriptionId);
      params.set("flow_data[subscription_update_confirm][items][0][id]", options.subscriptionItemId);
      params.set(
        "flow_data[subscription_update_confirm][items][0][quantity]",
        String(Math.max(1, Math.floor(options.quantity)))
      );
    }
    return this.postForm<StripePortal>("/v1/billing_portal/sessions", params);
  }

  /**
   * Immediately cancel a Stripe subscription. Missing / already-canceled
   * subscriptions are treated as success so ops cancel can finish offboarding.
   */
  public async cancelSubscription(subscriptionId: string): Promise<{ id: string; status: string }> {
    if (!this.config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.config.stripeSecretKey}` }
      }
    );
    const json = (await response.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string; code?: string };
    };
    if (response.status === 404) {
      return { id: subscriptionId, status: "not_found" };
    }
    if (!response.ok) {
      const message = json.error?.message ?? `Stripe request failed (${response.status})`;
      if (/no such subscription/i.test(message)) {
        return { id: subscriptionId, status: "not_found" };
      }
      throw new Error(message);
    }
    return { id: String(json.id ?? subscriptionId), status: String(json.status ?? "canceled") };
  }

  public async retrieveSubscription(subscriptionId: string): Promise<StripeSubscription> {
    if (!this.config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        headers: { Authorization: `Bearer ${this.config.stripeSecretKey}` }
      }
    );
    const json = (await response.json().catch(() => ({}))) as StripeSubscription & {
      error?: { message?: string };
      pause_collection?: { behavior?: string } | null;
      items?: { data?: Array<{ id?: string; quantity?: number; price?: string | { id?: string } }> };
    };
    if (!response.ok) {
      throw new Error(json.error?.message ?? `Stripe request failed (${response.status})`);
    }
    const items = (json.items?.data ?? [])
      .map((item) => {
        const price = item.price;
        const priceId = typeof price === "string" ? price : price?.id;
        return {
          id: String(item.id ?? ""),
          quantity: Math.max(0, Math.floor(Number(item.quantity ?? 0) || 0)),
          priceId
        };
      })
      .filter((item) => item.id);
    const first = items[0];
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      id: json.id,
      status: json.status,
      quantity: quantity || first?.quantity || json.quantity,
      itemId: first?.id,
      priceId: first?.priceId,
      items,
      paused: Boolean(json.pause_collection)
    };
  }

  /** Stop invoicing without cancelling the subscription (reversible on activate). */
  public async pauseSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const params = new URLSearchParams();
    params.set("pause_collection[behavior]", "void");
    await this.postForm(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
    return this.retrieveSubscription(subscriptionId);
  }

  /** Resume invoicing after a suspend-time pause. */
  public async resumeSubscription(subscriptionId: string): Promise<StripeSubscription> {
    const params = new URLSearchParams();
    params.set("pause_collection", "");
    await this.postForm(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
    return this.retrieveSubscription(subscriptionId);
  }

  public async updateSubscriptionItems(
    subscriptionId: string,
    items: SubscriptionItemUpdate[]
  ): Promise<StripeSubscription> {
    if (!this.config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    if (items.length === 0) {
      return this.retrieveSubscription(subscriptionId);
    }
    const params = new URLSearchParams();
    params.set("proration_behavior", "create_prorations");
    items.forEach((item, index) => {
      if (item.id) {
        params.set(`items[${index}][id]`, item.id);
      }
      if (item.priceId) {
        params.set(`items[${index}][price]`, item.priceId);
      }
      if (item.deleted) {
        params.set(`items[${index}][deleted]`, "true");
      } else if (item.quantity != null) {
        params.set(`items[${index}][quantity]`, String(Math.max(0, Math.floor(item.quantity))));
      }
    });
    await this.postForm(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
    return this.retrieveSubscription(subscriptionId);
  }

  public verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): unknown {
    if (!this.config.stripeWebhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }
    if (!signatureHeader) {
      throw new Error("missing Stripe-Signature header");
    }

    const parts = Object.fromEntries(
      signatureHeader.split(",").map((part) => {
        const [key, value] = part.split("=");
        return [key, value];
      })
    ) as Record<string, string>;

    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) {
      throw new Error("invalid Stripe-Signature header");
    }

    const payload = `${timestamp}.${rawBody}`;
    const expected = createHmac("sha256", this.config.stripeWebhookSecret)
      .update(payload, "utf8")
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
      throw new Error("webhook signature mismatch");
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (age > 300) {
      throw new Error("webhook timestamp too old");
    }

    return JSON.parse(rawBody) as unknown;
  }

  private async postForm<T>(path: string, body: URLSearchParams): Promise<T> {
    if (!this.config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(json.error?.message ?? `Stripe request failed (${response.status})`);
    }
    return json;
  }
}
