import { resolveAdminPortalUrl, resolveMarketingBaseUrl, resolvePublicUrl } from "../../config/publicUrls";

export type BillingConfig = {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceIdPro?: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  adminPortalUrl: string;
  billingPortalReturnUrl: string;
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
    emailFrom: env.EMAIL_FROM?.trim() || "hello@coop-ai.dev",
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    emailMock: readBoolean(env.COOP_EMAIL_MOCK, !env.RESEND_API_KEY)
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
