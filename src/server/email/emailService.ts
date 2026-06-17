import type { BillingConfig } from "../billing/billingConfig";

export type WelcomeEmailParams = {
  to: string;
  orgName: string;
  adminPortalUrl: string;
  apiKey: string;
};

export type InviteEmailParams = {
  to: string;
  orgName: string;
  adminPortalUrl: string;
  invitedBy?: string;
};

export class EmailService {
  public constructor(private readonly config: BillingConfig) {}

  public async sendWelcome(params: WelcomeEmailParams): Promise<void> {
    const subject = `Welcome to CoopAI — ${params.orgName}`;
    const loginUrl = params.adminPortalUrl;
    const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24292f;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #d0d7de;border-radius:8px;padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Hi,</p>
      <p style="margin:0 0 16px;font-size:16px;"><strong>${escapeHtml(params.orgName)}</strong> is set up on CoopAI Pro. Use the admin portal to connect tools, invite your team, and manage billing.</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#3FB950;color:#0D1117;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">
          Open admin portal
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;">Your admin API key</p>
      <p style="margin:0 0 8px;font-size:13px;color:#57606a;">Copy this key now — it is shown once and cannot be retrieved later.</p>
      <pre style="margin:0 0 24px;background:#f6f8fa;padding:16px;border-radius:6px;border:1px solid #d0d7de;word-break:break-all;font-size:13px;white-space:pre-wrap;">${escapeHtml(params.apiKey)}</pre>
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;">Next steps</p>
      <ol style="margin:0;padding-left:20px;font-size:14px;color:#57606a;">
        <li style="margin-bottom:6px;">Sign in to the admin portal with the API key above.</li>
        <li style="margin-bottom:6px;">Connect GitHub, Slack, and other tools in <strong>Integrations</strong>.</li>
        <li style="margin-bottom:6px;">Invite teammates from <strong>Users</strong>.</li>
        <li>Have developers install the CoopAI VS Code extension and sign in.</li>
      </ol>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#57606a;text-align:center;">
      Didn't request this? Contact <a href="mailto:hello@coop-ai.dev" style="color:#0969da;">hello@coop-ai.dev</a>
    </p>
  </div>
</body>
</html>`;
    const text = [
      `${params.orgName} is set up on CoopAI Pro.`,
      "",
      "Open admin portal:",
      loginUrl,
      "",
      "Your admin API key (shown once — copy now):",
      params.apiKey,
      "",
      "Next steps:",
      "1. Sign in to the admin portal with the API key above.",
      "2. Connect GitHub, Slack, and other tools in Integrations.",
      "3. Invite teammates from Users.",
      "4. Have developers install the CoopAI VS Code extension and sign in."
    ].join("\n");

    await this.send(params.to, subject, html, text);
  }

  public async sendInvite(params: InviteEmailParams): Promise<void> {
    const subject = `You've been invited to CoopAI — ${params.orgName}`;
    const html = `
      <p>You were invited to <strong>${escapeHtml(params.orgName)}</strong> on CoopAI.</p>
      <p>Install the CoopAI VS Code extension, then sign in with your org credentials.</p>
      <p>Admin portal: <a href="${escapeHtml(params.adminPortalUrl)}">${escapeHtml(params.adminPortalUrl)}</a></p>
    `;
    await this.send(params.to, subject, html);
  }

  private async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    if (this.config.emailMock || !this.config.resendApiKey) {
      console.log(`[email:mock] to=${to} subject=${subject}`);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
