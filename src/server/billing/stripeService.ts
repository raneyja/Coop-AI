import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingConfig } from "./billingConfig";

type StripeSession = { id: string; url: string | null };
type StripePortal = { url: string };

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
  }): Promise<StripeSession> {
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("customer_email", input.email);
    params.set("success_url", `${this.config.checkoutSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", this.config.checkoutCancelUrl);
    params.set("line_items[0][price]", this.config.stripePriceIdPro!);
    params.set("line_items[0][quantity]", String(Math.max(1, input.seats)));
    params.set("metadata[org_name]", input.orgName);
    params.set("metadata[admin_email]", input.email);
    params.set("metadata[seat_count]", String(Math.max(1, input.seats)));
    params.set("subscription_data[metadata][org_name]", input.orgName);
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

  public async createBillingPortalSession(customerId: string): Promise<StripePortal> {
    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", this.config.billingPortalReturnUrl);
    return this.postForm<StripePortal>("/v1/billing_portal/sessions", params);
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
