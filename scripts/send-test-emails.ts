#!/usr/bin/env node
/**
 * Send one copy of every transactional email to a target inbox (preview / QA).
 *
 * Usage:
 *   npx tsx scripts/send-test-emails.ts jonathanaraney@gmail.com
 */

import { loadBillingConfig } from "../src/server/billing/billingConfig";
import { adminPortalAcceptInviteUrl, adminPortalFreshLoginUrl } from "../src/server/billing/adminPortalUrl";
import { EmailService } from "../src/server/email/emailService";

const SAMPLE_ORG = "Acme Engineering";
const SAMPLE_INVITER = "Jane Smith";

async function main(): Promise<void> {
  const to = process.argv[2]?.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("usage: npx tsx scripts/send-test-emails.ts <email>");
    process.exit(1);
  }

  const config = loadBillingConfig(process.env);
  if (config.emailMock || !config.resendApiKey) {
    console.error("RESEND_API_KEY is required and COOP_EMAIL_MOCK must be false.");
    process.exit(1);
  }

  const emailService = new EmailService(config);
  const loginUrl = adminPortalFreshLoginUrl(config.adminPortalUrl, { email: to });
  const marketingBase = process.env.COOP_MARKETING_BASE_URL?.trim() || "https://coop-ai.dev";

  const sends: Array<{ label: string; run: () => Promise<void> }> = [
    {
      label: "Free signup welcome",
      run: () =>
        emailService.sendFreeSignupWelcome({
          to,
          orgName: SAMPLE_ORG,
          adminPortalUrl: loginUrl
        })
    },
    {
      label: "Pro signup welcome (new checkout)",
      run: () =>
        emailService.sendWelcome({
          to,
          orgName: SAMPLE_ORG,
          adminPortalUrl: loginUrl
        })
    },
    {
      label: "Free → Pro upgrade confirmation",
      run: () =>
        emailService.sendProUpgradeWelcome({
          to,
          orgName: SAMPLE_ORG,
          adminPortalUrl: loginUrl
        })
    },
    {
      label: "Space invite (with inviter name)",
      run: () =>
        emailService.sendInvite({
          to,
          orgName: SAMPLE_ORG,
          acceptInviteUrl: adminPortalAcceptInviteUrl(config.adminPortalUrl, "preview-invite-token"),
          invitedBy: SAMPLE_INVITER
        })
    },
    {
      label: "Email verification",
      run: () =>
        emailService.sendEmailVerification({
          to,
          orgName: SAMPLE_ORG,
          verifyUrl: `${marketingBase}/verify-email?token=preview-verify-token`
        })
    },
    {
      label: "Password reset",
      run: () =>
        emailService.sendPasswordReset({
          to,
          orgName: SAMPLE_ORG,
          resetUrl: `${marketingBase}/reset-password?token=preview-reset-token`
        })
    }
  ];

  console.log(`Sending ${sends.length} preview emails to ${to} (from ${config.emailFrom})…`);

  for (const { label, run } of sends) {
    try {
      await run();
      console.log(`  ✓ ${label}`);
      await sleep(600);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${label}: ${message}`);
      process.exit(1);
    }
  }

  console.log("Done.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
