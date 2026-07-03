import type { BillingConfig } from "../billing/billingConfig";

export type WelcomeEmailParams = {
  to: string;
  orgName: string;
  adminPortalUrl: string;
};

export type InviteEmailParams = {
  to: string;
  orgName: string;
  acceptInviteUrl: string;
  invitedBy?: string;
};

export type EmailVerificationParams = {
  to: string;
  orgName: string;
  verifyUrl: string;
};

export type PasswordResetParams = {
  to: string;
  orgName: string;
  resetUrl: string;
};

type PlanWelcomeContent = {
  subject: string;
  html: string;
  text: string;
};

export class EmailService {
  public constructor(private readonly config: BillingConfig) {}

  public async sendWelcome(params: WelcomeEmailParams): Promise<void> {
    const content = buildPlanWelcomeEmail(params, "pro");
    await this.send(params.to, content.subject, content.html, content.text);
  }

  public async sendProUpgradeWelcome(params: WelcomeEmailParams): Promise<void> {
    const loginUrl = params.adminPortalUrl;
    const billingUrl = billingPortalUrl(params.adminPortalUrl);
    const subject = `${params.orgName} is now on Coop AI Pro`;
    const html = emailShell({
      title: subject,
      body: `
        <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
        <p style="margin:0 0 16px;font-size:16px;">
          Your upgrade is complete — <strong>${escapeHtml(params.orgName)}</strong> is now on
          <strong>Coop AI Pro</strong>.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#57606a;">
          You now have unlimited AI usage, unlimited Deep-Index repositories, team user management,
          and priority support.
        </p>
        ${primaryButton("Open Coop AI", loginUrl)}
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;">What's unlocked</p>
        <ul style="margin:0;padding-left:20px;font-size:14px;color:#57606a;">
          <li style="margin-bottom:6px;">Unlimited AI credits for chat and autocomplete.</li>
          <li style="margin-bottom:6px;">Unlimited Deep-Index repositories.</li>
          <li style="margin-bottom:6px;">Invite and manage teammates from <strong>Users</strong>.</li>
          <li>View invoices and manage billing in your <a href="${escapeHtml(billingUrl)}" style="color:#0969da;">billing portal</a>.</li>
        </ul>
      `
    });
    const text = [
      `${params.orgName} is now on Coop AI Pro.`,
      "",
      "You now have unlimited AI usage, unlimited Deep-Index repositories, team user management, and priority support.",
      "",
      "Open Coop AI:",
      loginUrl,
      "",
      "Manage billing:",
      billingUrl
    ].join("\n");
    await this.send(params.to, subject, html, text);
  }

  public async sendFreeSignupWelcome(params: WelcomeEmailParams): Promise<void> {
    const content = buildPlanWelcomeEmail(params, "free");
    await this.send(params.to, content.subject, content.html, content.text);
  }

  public async sendInvite(params: InviteEmailParams): Promise<void> {
    const inviterLine = params.invitedBy
      ? `<strong>${escapeHtml(params.invitedBy)}</strong> invited you to join`
      : "You've been invited to join";
    const subject = params.invitedBy
      ? `${params.invitedBy} invited you to ${params.orgName} on Coop AI`
      : `Join ${params.orgName} on Coop AI`;
    const html = emailShell({
      title: subject,
      body: `
        <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
        <p style="margin:0 0 16px;font-size:16px;">
          ${inviterLine}
          <strong>${escapeHtml(params.orgName)}</strong> on Coop AI.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#57606a;">
          Coop AI connects your team's tools so everyone can code with full context in VS Code.
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#57606a;">
          Accept this invitation to set up your profile and password for
          <strong>${escapeHtml(params.to)}</strong>.
        </p>
        ${primaryButton("Accept invitation", params.acceptInviteUrl)}
        <p style="margin:24px 0 0;font-size:13px;color:#57606a;">
          This link expires in 7 days. After you join, install the Coop AI VS Code extension and sign in with the same account.
        </p>
      `
    });
    const text = [
      params.invitedBy
        ? `${params.invitedBy} invited you to join ${params.orgName} on Coop AI.`
        : `You've been invited to join ${params.orgName} on Coop AI.`,
      "",
      `Accept your invitation and create a password for ${params.to}:`,
      params.acceptInviteUrl,
      "",
      "This link expires in 7 days.",
      "After joining, install the Coop AI VS Code extension and sign in with the same account."
    ].join("\n");
    await this.send(params.to, subject, html, text);
  }

  public async sendEmailVerification(params: EmailVerificationParams): Promise<void> {
    const subject = "Verify your Coop AI email";
    const html = emailShell({
      title: subject,
      body: `
        <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
        <p style="margin:0 0 16px;font-size:16px;">
          Thanks for creating <strong>${escapeHtml(params.orgName)}</strong> on Coop AI.
          Confirm your email to secure your account.
        </p>
        ${primaryButton("Verify email address", params.verifyUrl)}
        <p style="margin:24px 0 0;font-size:13px;color:#57606a;">
          This link expires in 24 hours. If you didn't create an account, you can ignore this email.
        </p>
      `
    });
    const text = [
      `Verify your email for ${params.orgName} on Coop AI:`,
      params.verifyUrl,
      "",
      "This link expires in 24 hours."
    ].join("\n");
    await this.send(params.to, subject, html, text);
  }

  public async sendPasswordReset(params: PasswordResetParams): Promise<void> {
    const subject = "Reset your Coop AI password";
    const html = emailShell({
      title: subject,
      body: `
        <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
        <p style="margin:0 0 16px;font-size:16px;">
          We received a request to reset the password for your Coop AI account.
        </p>
        ${primaryButton("Reset password", params.resetUrl)}
        <p style="margin:24px 0 0;font-size:13px;color:#57606a;">
          This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email — your password won't change.
        </p>
      `
    });
    const text = [
      "Reset your Coop AI password:",
      params.resetUrl,
      "",
      "This link expires in 1 hour. If you didn't request this, ignore this email."
    ].join("\n");
    await this.send(params.to, subject, html, text);
  }

  private async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    if (this.config.emailMock || !this.config.resendApiKey) {
      console.log(`[email:mock] to=${to} subject=${subject}`);
      if (text) {
        console.log(`[email:mock] text=${text.slice(0, 200)}`);
      }
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: this.config.emailFrom,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend failed (${response.status}): ${body}`);
    }
  }
}

function buildPlanWelcomeEmail(params: WelcomeEmailParams, plan: "pro" | "free"): PlanWelcomeContent {
  const loginUrl = params.adminPortalUrl;
  const planLabel = plan === "pro" ? "Coop AI Pro" : "Coop AI Free";
  const intro =
    plan === "pro"
      ? `<strong>${escapeHtml(params.orgName)}</strong> is ready on Coop AI Pro. Sign in to connect tools, invite your team, and manage billing.`
      : `<strong>${escapeHtml(params.orgName)}</strong> is ready on Coop AI Free. Sign in to connect tools and start using Coop in VS Code.`;
  const subject =
    plan === "pro" ? `Welcome to Coop AI — ${params.orgName}` : `Welcome to Coop AI Free — ${params.orgName}`;
  const html = emailShell({
    title: subject,
    body: `
      <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
      <p style="margin:0 0 16px;font-size:16px;">${intro}</p>
      ${primaryButton("Sign in to Coop AI", loginUrl)}
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;">Next steps</p>
      <ol style="margin:0;padding-left:20px;font-size:14px;color:#57606a;">
        <li style="margin-bottom:6px;">Sign in with your email and password, or continue with Google.</li>
        <li style="margin-bottom:6px;">Connect GitHub, Slack, and other tools in <strong>Integrations</strong>.</li>
        <li style="margin-bottom:6px;">Invite teammates from <strong>Users</strong>.</li>
        <li>Install the Coop AI VS Code extension and sign in with the same account.</li>
      </ol>
    `
  });
  const text = [
    `${params.orgName} is set up on ${planLabel}.`,
    "",
    "Sign in to Coop AI:",
    loginUrl,
    "",
    "Next steps:",
    "1. Sign in with your email and password, or continue with Google.",
    "2. Connect GitHub, Slack, and other tools in Integrations.",
    "3. Invite teammates from Users.",
    "4. Install the Coop AI VS Code extension and sign in."
  ].join("\n");

  return { subject, html, text };
}

function emailShell(options: { title: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24292f;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #d0d7de;border-radius:8px;padding:32px;">
      ${options.body}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#57606a;text-align:center;">
      Didn't request this? Contact <a href="mailto:hello@coop-ai.dev" style="color:#0969da;">hello@coop-ai.dev</a>
    </p>
  </div>
</body>
</html>`;
}

function billingPortalUrl(adminPortalUrl: string): string {
  const trimmed = adminPortalUrl.trim().replace(/\/+$/, "").replace(/\/login$/, "");
  return `${trimmed || adminPortalUrl}/billing`;
}

function primaryButton(label: string, href: string): string {
  return `<p style="margin:0 0 24px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#3FB950;color:#0D1117;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">
      ${escapeHtml(label)}
    </a>
  </p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
