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
  const marketingBase = env.COOP_MARKETING_BASE_URL?.trim() || "https://coop-ai.dev";
  const adminPortal = env.COOP_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";

  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    stripePriceIdPro: env.STRIPE_PRICE_ID_PRO?.trim() || undefined,
    checkoutSuccessUrl: env.COOP_CHECKOUT_SUCCESS_URL?.trim() || `${marketingBase}/welcome`,
    checkoutCancelUrl: env.COOP_CHECKOUT_CANCEL_URL?.trim() || `${marketingBase}/pricing`,
    adminPortalUrl: adminPortal,
    billingPortalReturnUrl: env.STRIPE_BILLING_PORTAL_RETURN_URL?.trim() || `${adminPortal}/billing`,
    emailFrom: env.EMAIL_FROM?.trim() || "hello@coop-ai.dev",
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    emailMock: readBoolean(env.COOP_EMAIL_MOCK, !env.RESEND_API_KEY)
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
