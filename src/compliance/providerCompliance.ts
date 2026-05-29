import { listZeroRetentionConfigs, LlmProvider } from "../api/zeroRetentionConfig";

export type ComplianceSeverity = "info" | "warning" | "critical";

export type VendorPolicyRecord = {
  provider: LlmProvider;
  policy_url: string;
  no_training_on_api: boolean;
  needs_dpa: boolean;
  verified_date: string;
  zero_retention_eligible: boolean;
  requires_legal_review: boolean;
};

export type ComplianceFinding = {
  provider: LlmProvider;
  severity: ComplianceSeverity;
  message: string;
};

export type ComplianceStartupCheck = {
  checkedAt: Date;
  ok: boolean;
  findings: ComplianceFinding[];
  policies: VendorPolicyRecord[];
};

export type ComplianceAuditEvent = {
  timestamp: Date;
  actor: string;
  action: "startup_check" | "policy_review" | "provider_enabled" | "provider_disabled";
  provider?: LlmProvider;
  details: Record<string, unknown>;
};

export interface ComplianceAuditLog {
  write(event: ComplianceAuditEvent): Promise<void>;
}

const MAX_POLICY_AGE_DAYS = 180;

export const PROVIDER_POLICIES: Record<LlmProvider, VendorPolicyRecord> = Object.fromEntries(
  listZeroRetentionConfigs().map((config) => [
    config.provider,
    {
      provider: config.provider,
      policy_url: config.compliance.policyUrl,
      no_training_on_api: config.compliance.noTrainingOnApi,
      needs_dpa: config.compliance.needsDpa,
      verified_date: config.compliance.verifiedDate,
      zero_retention_eligible: config.compliance.zeroRetentionEligible,
      requires_legal_review: Boolean(config.compliance.requiresLegalReview)
    }
  ])
) as Record<LlmProvider, VendorPolicyRecord>;

export async function runProviderComplianceStartupCheck(
  auditLog?: ComplianceAuditLog,
  now: Date = new Date()
): Promise<ComplianceStartupCheck> {
  const policies = Object.values(PROVIDER_POLICIES).map(clonePolicy);
  const findings = policies.flatMap((policy) => validatePolicy(policy, now));
  const result: ComplianceStartupCheck = {
    checkedAt: now,
    ok: !findings.some((finding) => finding.severity === "critical"),
    findings,
    policies
  };

  await auditLog?.write({
    timestamp: now,
    actor: "system",
    action: "startup_check",
    details: {
      ok: result.ok,
      finding_count: findings.length,
      critical_count: findings.filter((finding) => finding.severity === "critical").length
    }
  });

  return result;
}

export function validateProviderForEnterprise(provider: LlmProvider): ComplianceFinding[] {
  const policy = PROVIDER_POLICIES[provider];
  return validatePolicy(policy, new Date());
}

export function providerRequiresBlockingReview(provider: LlmProvider): boolean {
  return validateProviderForEnterprise(provider).some((finding) => finding.severity === "critical");
}

export class InMemoryComplianceAuditLog implements ComplianceAuditLog {
  private readonly events: ComplianceAuditEvent[] = [];

  public async write(event: ComplianceAuditEvent): Promise<void> {
    this.events.push({
      ...event,
      timestamp: new Date(event.timestamp),
      details: { ...event.details }
    });
  }

  public list(): ComplianceAuditEvent[] {
    return this.events.map((event) => ({
      ...event,
      timestamp: new Date(event.timestamp),
      details: { ...event.details }
    }));
  }
}

function validatePolicy(policy: VendorPolicyRecord, now: Date): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const ageDays = daysBetween(new Date(policy.verified_date), now);

  if (!policy.no_training_on_api) {
    findings.push({
      provider: policy.provider,
      severity: "critical",
      message: `${policy.provider} does not have a verified no-training-on-API-data posture.`
    });
  }

  if (policy.requires_legal_review) {
    findings.push({
      provider: policy.provider,
      severity: "critical",
      message: `${policy.provider} requires legal review or DPA approval before enterprise-confidential code routing.`
    });
  }

  if (ageDays > MAX_POLICY_AGE_DAYS) {
    findings.push({
      provider: policy.provider,
      severity: "warning",
      message: `${policy.provider} policy verification is ${ageDays} days old and should be re-reviewed.`
    });
  }

  if (!policy.zero_retention_eligible) {
    findings.push({
      provider: policy.provider,
      severity: "warning",
      message: `${policy.provider} is not marked zero-retention eligible without additional contract terms.`
    });
  }

  return findings;
}

function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function clonePolicy(policy: VendorPolicyRecord): VendorPolicyRecord {
  return { ...policy };
}
