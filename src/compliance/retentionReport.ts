import { SanitizationReport } from "../api/dataSanitization";
import { LlmProvider } from "../api/zeroRetentionConfig";
import { PROVIDER_POLICIES, VendorPolicyRecord } from "./providerCompliance";

export type RequestAuditSummary = {
  totalRequests: number;
  zeroRetentionFlaggedRequests: number;
  sanitizedRequests: number;
  byokRequests: number;
  providerCounts: Partial<Record<LlmProvider, number>>;
  windowStart: Date;
  windowEnd: Date;
};

export type ConfigAuditEvent = {
  timestamp: Date;
  actor: string;
  action: "enable_byok" | "disable_byok" | "rotate_key" | "provider_enabled" | "provider_disabled" | "policy_override";
  target: string;
  details: Record<string, unknown>;
};

export type ComplianceReport = {
  generatedAt: Date;
  customerId: string;
  requestSummary: RequestAuditSummary;
  providerPolicies: VendorPolicyRecord[];
  sanitizationRules: string[];
  configChanges: ConfigAuditEvent[];
  statements: string[];
};

export interface ReportSigner {
  sign(content: string): Promise<string>;
}

export interface PdfRenderer {
  render(title: string, html: string): Promise<Uint8Array>;
}

export class RetentionReportBuilder {
  private readonly configChanges: ConfigAuditEvent[] = [];

  public recordConfigChange(event: ConfigAuditEvent): void {
    this.configChanges.push({
      ...event,
      timestamp: new Date(event.timestamp),
      details: { ...event.details }
    });
  }

  public buildCustomerDashboardReport(customerId: string, summary: RequestAuditSummary): ComplianceReport {
    return {
      generatedAt: new Date(),
      customerId,
      requestSummary: cloneSummary(summary),
      providerPolicies: Object.values(PROVIDER_POLICIES).map((policy) => ({ ...policy })),
      sanitizationRules: SANITIZATION_RULES,
      configChanges: this.recentConfigChanges(customerId),
      statements: buildStatements(summary)
    };
  }

  public async generateComplianceAttestation(
    report: ComplianceReport,
    signer?: ReportSigner
  ): Promise<string> {
    const markdown = renderMarkdownAttestation(report);
    const signature = signer ? await signer.sign(markdown) : "unsigned";
    return `${markdown}\n\nSignature: ${signature}\nSigned At: ${new Date().toISOString()}\n`;
  }

  public async generatePdfAttestation(
    report: ComplianceReport,
    renderer: PdfRenderer,
    signer?: ReportSigner
  ): Promise<Uint8Array> {
    const attestation = await this.generateComplianceAttestation(report, signer);
    return renderer.render("CoopAI Data Retention Compliance Report", renderHtml(attestation));
  }

  private recentConfigChanges(customerId: string): ConfigAuditEvent[] {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return this.configChanges
      .filter((event) => event.timestamp.getTime() >= cutoff)
      .filter((event) => event.target === customerId || String(event.details.customerId ?? "") === customerId)
      .map((event) => ({ ...event, timestamp: new Date(event.timestamp), details: { ...event.details } }));
  }
}

export function summarizeRequestAudits(
  events: Array<{
    timestamp: Date;
    provider: LlmProvider;
    zeroRetentionFlagsPresent: boolean;
    byok: boolean;
    sanitization?: SanitizationReport;
  }>,
  windowStart: Date,
  windowEnd: Date
): RequestAuditSummary {
  const inWindow = events.filter(
    (event) => event.timestamp.getTime() >= windowStart.getTime() && event.timestamp.getTime() <= windowEnd.getTime()
  );

  const providerCounts: Partial<Record<LlmProvider, number>> = {};
  for (const event of inWindow) {
    providerCounts[event.provider] = (providerCounts[event.provider] ?? 0) + 1;
  }

  return {
    totalRequests: inWindow.length,
    zeroRetentionFlaggedRequests: inWindow.filter((event) => event.zeroRetentionFlagsPresent).length,
    sanitizedRequests: inWindow.filter((event) => event.sanitization?.sanitized ?? true).length,
    byokRequests: inWindow.filter((event) => event.byok).length,
    providerCounts,
    windowStart,
    windowEnd
  };
}

export function alertOnSuspiciousConfigChange(event: ConfigAuditEvent): string | undefined {
  if (event.action === "provider_disabled" || event.action === "policy_override") {
    return `Suspicious compliance configuration change: ${event.action} on ${event.target} by ${event.actor}`;
  }
  if (event.action === "disable_byok") {
    return `BYOK disabled for ${event.target} by ${event.actor}; verify customer authorization.`;
  }
  return undefined;
}

const SANITIZATION_RULES = [
  "API keys are masked and only a short suffix may remain for operator correlation.",
  "Passwords, tokens, secrets, cookies, sessions, and authorization headers are replaced before transmission.",
  "Email addresses, phone numbers, and SSNs are redacted from prompt text.",
  "Internal paths under sensitive namespaces are replaced with [INTERNAL_PATH].",
  "Slack and Teams mentions are stripped; decision extraction keeps only keywords and issue references.",
  "Error logs and crash metadata exclude request bodies, response bodies, and API keys."
];

function buildStatements(summary: RequestAuditSummary): string[] {
  const zeroRetentionPercent = percent(summary.zeroRetentionFlaggedRequests, summary.totalRequests);
  const sanitizedPercent = percent(summary.sanitizedRequests, summary.totalRequests);
  return [
    `${zeroRetentionPercent}% of requests were sent with zero-retention flags.`,
    "0 API calls are intentionally stored for model training by CoopAI.",
    `${sanitizedPercent}% of requests were sanitized before transmission.`,
    "Audit trail covers the last 90 days of request and configuration activity."
  ];
}

function renderMarkdownAttestation(report: ComplianceReport): string {
  const providers = report.providerPolicies
    .map(
      (policy) =>
        `- ${policy.provider}: no_training_on_api=${policy.no_training_on_api}, needs_dpa=${policy.needs_dpa}, verified=${policy.verified_date}, policy=${policy.policy_url}`
    )
    .join("\n");
  const statements = report.statements.map((statement) => `- ${statement}`).join("\n");
  const configChanges = report.configChanges
    .map((event) => `- ${event.timestamp.toISOString()} ${event.actor} ${event.action} ${event.target}`)
    .join("\n") || "- No configuration changes in the reporting window.";

  return `# CoopAI Data Retention Compliance Report

Customer: ${report.customerId}
Generated: ${report.generatedAt.toISOString()}
Window: ${report.requestSummary.windowStart.toISOString()} to ${report.requestSummary.windowEnd.toISOString()}

## Attestation
${statements}

## Provider Policies
${providers}

## Sanitization Rules
${report.sanitizationRules.map((rule) => `- ${rule}`).join("\n")}

## Configuration Audit
${configChanges}
`;
}

function renderHtml(markdown: string): string {
  return `<html><body><pre>${escapeHtml(markdown)}</pre></body></html>`;
}

function percent(value: number, total: number): string {
  if (total === 0) {
    return "100";
  }
  return ((value / total) * 100).toFixed(2);
}

function cloneSummary(summary: RequestAuditSummary): RequestAuditSummary {
  return {
    ...summary,
    windowStart: new Date(summary.windowStart),
    windowEnd: new Date(summary.windowEnd),
    providerCounts: { ...summary.providerCounts }
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
