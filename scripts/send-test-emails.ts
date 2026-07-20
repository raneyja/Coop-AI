#!/usr/bin/env node
/**
 * Send one copy of every transactional email to a target inbox (preview / QA).
 *
 * Tokenized CTAs (activate / invite / verify / reset) point at /email-preview on the
 * marketing site so layout review does not hit "invalid or expired" token pages.
 *
 * Usage:
 *   npx tsx scripts/send-test-emails.ts jonathanaraney@gmail.com
 */

import { loadBillingConfig } from "../src/server/billing/billingConfig";
import { adminPortalFreshLoginUrl } from "../src/server/billing/adminPortalUrl";
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
  const marketingBase = (process.env.COOP_MARKETING_BASE_URL?.trim() || "https://coop-ai.dev").replace(
    /\/+$/,
    ""
  );
  const previewUrl = (type: "activate" | "invite" | "verify" | "reset") =>
    `${marketingBase}/email-preview?type=${type}`;

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
      label: "Pro signup welcome (new checkout — activate account)",
      run: () =>
        emailService.sendWelcome({
          to,
          orgName: SAMPLE_ORG,
          adminPortalUrl: loginUrl,
          activateAccountUrl: previewUrl("activate")
        })
    },
    {
      label: "Pro signup welcome (existing account — sign in)",
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
          acceptInviteUrl: previewUrl("invite"),
          invitedBy: SAMPLE_INVITER
        })
    },
    {
      label: "Email verification",
      run: () =>
        emailService.sendEmailVerification({
          to,
          orgName: SAMPLE_ORG,
          verifyUrl: previewUrl("verify")
        })
    },
    {
      label: "Password reset",
      run: () =>
        emailService.sendPasswordReset({
          to,
          orgName: SAMPLE_ORG,
          resetUrl: previewUrl("reset")
        })
    }
  ];

  console.log(`Sending ${sends.length} preview emails to ${to} (from ${config.emailFrom})…`);
  console.log(`Tokenized CTAs → ${marketingBase}/email-preview?type=… (layout only, not live tokens)`);

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
