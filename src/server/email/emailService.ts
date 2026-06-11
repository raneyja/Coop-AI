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
    const subject = `Welcome to Coop AI — ${params.orgName}`;
    const html = `
      <p>Your Coop AI organization <strong>${escapeHtml(params.orgName)}</strong> is ready.</p>
      <p><strong>Admin portal:</strong> <a href="${escapeHtml(params.adminPortalUrl)}">${escapeHtml(params.adminPortalUrl)}</a></p>
      <p>Sign in with this admin API key (shown once):</p>
      <pre style="background:#f4f4f5;padding:12px;border-radius:8px;word-break:break-all">${escapeHtml(params.apiKey)}</pre>
      <p>Next: connect your tools in <strong>Integrations</strong>, then invite your team.</p>
    `;
    await this.send(params.to, subject, html);
  }

  public async sendInvite(params: InviteEmailParams): Promise<void> {
    const subject = `You've been invited to Coop AI — ${params.orgName}`;
    const html = `
      <p>You were invited to <strong>${escapeHtml(params.orgName)}</strong> on Coop AI.</p>
      <p>Install the Coop AI VS Code extension, then sign in with your org credentials.</p>
      <p>Admin portal: <a href="${escapeHtml(params.adminPortalUrl)}">${escapeHtml(params.adminPortalUrl)}</a></p>
    `;
    await this.send(params.to, subject, html);
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
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
        html
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Resend failed (${response.status}): ${text}`);
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
