import { resolveAdminPortalUrl, resolveMarketingBaseUrl, resolvePublicUrl } from "../../config/publicUrls";

export type BillingConfig = {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceIdPro?: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  adminPortalUrl: string;
  billingPortalReturnUrl: string;
  // Stripe Customer Portal configuration IDs (bpc_...). Optional. When set, they
  // let us serve two different portal experiences from the same customer:
  //   - stripePortalConfigManage: payment methods / invoices / cancel, with
  //     subscription quantity edits DISABLED (blocks self-serve seat DECREASES).
  //   - stripePortalConfigSeats: subscription quantity edits ENABLED, used only
  //     for `subscription_update_confirm` deep links (admin seat increases and
  //     ops seat-change links).
  // If unset, sessions fall back to the account default portal configuration.
  stripePortalConfigManage?: string;
  stripePortalConfigSeats?: string;
  emailFrom: string;
  resendApiKey?: string;
  emailMock: boolean;
};

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const publicBase = env.COOP_PUBLIC_BASE_URL?.trim() || env.WEBHOOK_DOMAIN?.trim() || "http://localhost:8787";
  const marketingBase = resolveMarketingBaseUrl(env, publicBase);
  const adminPortal = resolveAdminPortalUrl(env, publicBase);

  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    stripePriceIdPro: env.STRIPE_PRICE_ID_PRO?.trim() || undefined,
    checkoutSuccessUrl: resolvePublicUrl(
      env.COOP_CHECKOUT_SUCCESS_URL,
      publicBase,
      `${marketingBase}/welcome`
    ),
    checkoutCancelUrl: resolvePublicUrl(
      env.COOP_CHECKOUT_CANCEL_URL,
      publicBase,
      `${marketingBase}/pricing`
    ),
    adminPortalUrl: adminPortal,
    billingPortalReturnUrl: resolvePublicUrl(
      env.STRIPE_BILLING_PORTAL_RETURN_URL,
      publicBase,
      `${adminPortal}/billing`
    ),
    stripePortalConfigManage: env.STRIPE_PORTAL_CONFIG_MANAGE?.trim() || undefined,
    stripePortalConfigSeats: env.STRIPE_PORTAL_CONFIG_SEATS?.trim() || undefined,
    emailFrom: env.EMAIL_FROM?.trim() || "CoopAI <hello@coop-ai.dev>",
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    emailMock: readBoolean(env.COOP_EMAIL_MOCK, !env.RESEND_API_KEY)
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
