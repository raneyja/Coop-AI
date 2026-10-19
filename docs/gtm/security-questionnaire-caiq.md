# CoopAI CAIQ v4 Response (Consensus Assessment Initiative Questionnaire)

> **Disclaimer:** Pre-filled from product architecture as of June 10, 2026. CAIQ is typically completed in the CSA STAR registry format. This document provides narrative answers mapped to CAIQ domains. Review with security@coop-ai.dev before submission.

**Vendor:** Coop AI, Inc.  
**Product:** CoopAI  
**CAIQ version reference:** v4.x control families  
**Last reviewed:** June 10, 2026

For SIG Lite format, see [security-questionnaire-sig-lite.md](./security-questionnaire-sig-lite.md).

---

## A&A — Audit & Assurance

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| A&A-01 | Audit planning | **Partial.** Provider compliance audits on startup; configuration change logging for BYOK and provider enablement. Formal third-party SOC 2 audit for Coop AI planned. | `providerCompliance.ts`, `retentionReport.ts` |
| A&A-02 | Independent audits | **LLM subprocessors:** SOC 2 Type II or equivalent required in DPA template. **Coop:** Not yet certified — provide architecture docs and attestation reports. | DPA template §Security |
| A&A-03 | Audit remediation | **Yes.** Critical compliance findings block enterprise routing (`severity: critical` in startup check). | `zeroRetentionConfig.ts` |
| A&A-04 | Audit reporting | **Yes.** Compliance attestation reports available per deployment. | `generateComplianceAttestation()` |

## AIS — Application & Interface Security

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| AIS-01 | Application security policy | **Yes.** Secure SDLC; code review required. | Git workflow |
| AIS-02 | Secure SDLC | **Yes.** TypeScript, automated tests, lint, dependency audit. | `package.json` scripts |
| AIS-03 | Application security testing | **Partial.** Unit/integration tests; DAST/pentest on Enterprise request. | CI pipeline |
| AIS-04 | Input validation | **Yes.** Webhook signature verification; API bearer auth. | `webhook-backend.md` |
| AIS-05 | Output validation | **Yes.** Webview and API sanitization patterns. | `dataSanitization.ts` |
| AIS-06 | API security | **Yes.** `COOP_REQUIRE_API_AUTH=true` in production; org-scoped API keys. | `admin-org.ts` |
| AIS-07 | Data integrity | **Yes.** Webhook deduplication; graph cache consistency via job queue. | `job-queue.md` |

## BCR — Business Continuity & Operational Resilience

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| BCR-01 | BCP policy | **Partial.** Coop-hosted relies on cloud provider BCP; self-hosted Customer-operated. | Order Form deployment option |
| BCR-02 | DR plan | **Partial.** Postgres backups configurable; multi-instance requires Redis/Postgres adapters. | `webhook-backend.md` Production Notes |
| BCR-03 | DR testing | **Customer/Coop joint** for Enterprise self-hosted. | SOW |
| BCR-04 | Equipment redundancy | **Inherited** from cloud provider. | Infrastructure exhibit |

## CCC — Change Control & Configuration Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| CCC-01 | Change management | **Yes.** Git PRs, review, CI gates. | Repository workflow |
| CCC-02 | Configuration baselines | **Yes.** `.env.backend.example`, migrations versioned. | `migrations/` |
| CCC-03 | Configuration changes logged | **Yes.** BYOK, provider enablement, policy overrides logged. | `zero-retention-llm.md` |
| CCC-04 | Segregation of environments | **Yes.** dev vs production env vars and auth requirements. | `COOP_REQUIRE_API_AUTH` |

## CEK — Cryptography, Encryption & Key Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| CEK-01 | Encryption policy | **Yes.** TLS in transit; encryption at rest for secrets. | Security page |
| CEK-02 | Key management | **Yes.** `CREDENTIALS_ENCRYPTION_KEY` for stored credentials; BYOK keys decrypted only for request duration. | `byokHandler.ts` |
| CEK-03 | Data encryption in transit | **Yes.** TLS 1.2+. | Security page |
| CEK-04 | Data encryption at rest | **Yes** for credentials; database encryption per hosting provider. | Deployment config |
| CEK-05 | Key rotation | **Customer responsibility** for BYOK rotation; Coop API keys rotatable via `create-api-key`. | `admin-org.ts` |

## DCS — Datacenter Security

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| DCS-01–05 | Physical/datacenter controls | **Inherited (N/A)** — CoopAI SaaS runs on third-party cloud. Self-hosted: Customer responsibility. | Cloud provider certifications |

## DSP — Data Security & Privacy Lifecycle Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| DSP-01 | Security/privacy policy | **Yes.** Privacy Policy + Security page + DPA. | coop-ai.dev |
| DSP-02 | Data classification | **Yes.** `enterprise_confidential` classification on LLM metadata. | `zeroRetentionConfig.ts` |
| DSP-03 | Data inventory | **Yes.** Documented in Privacy Policy §1 and DPA §3. | `dpa-customer-addendum.md` |
| DSP-04 | Data retention | **Yes.** Transient LLM processing; 90-day BYOK audit logs; graph data for subscription term. | Privacy Policy §4 |
| DSP-05 | Data disposal | **Yes.** Deletion within 30 days of termination per DPA §9. | DPA |
| DSP-06 | Data localization | **US default** for Coop-hosted; self-host for other regions. | Order Form |
| DSP-07 | Data ownership | **Customer retains** all Customer Content. | MSA §7.2 |
| DSP-08 | No training on customer data | **Yes.** Explicit in Privacy Policy, Security page, zero-retention config. | Multiple |
| DSP-09 | DPA available | **Yes.** `dpa-customer-addendum.md` | GTM docs |
| DSP-10 | Subprocessor disclosure | **Yes.** DPA Exhibit A. | GTM docs |
| DSP-11 | Data subject rights | **Supported** via DPA assistance provisions. | DPA §4.7 |
| DSP-12 | International transfers | **SCCs** in DPA Exhibit B. | DPA |

## GRC — Governance, Risk & Compliance

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| GRC-01 | Governance program | **Partial** — scaling formal GRC with enterprise revenue. | — |
| GRC-02 | Risk management | **Yes** for LLM provider risk (`PROVIDER_POLICIES`, 180-day review). | `providerCompliance.ts` |
| GRC-03 | Policy review | **Yes** — provider policies include `verified_date`. | Config |
| GRC-04 | Regulatory compliance | **GDPR, CCPA** via DPA; HIPAA not supported. | DPA |

## HRS — Human Resources

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| HRS-01 | Background checks | **Per hiring policy** for production access roles. | HR |
| HRS-02 | Confidentiality agreements | **Yes.** | HR |
| HRS-03 | Security training | **Yes** — engineering security practices. | HR |
| HRS-04 | Termination access revocation | **Yes.** | IT ops |

## IAM — Identity & Access Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| IAM-01 | IAM policy | **Yes.** Org roles, API keys, SSO for Enterprise. | `userStore.ts`, SSO |
| IAM-02 | User provisioning | **Yes.** `admin-org.ts create-user`; SSO JIT linking. | CLI / SAML |
| IAM-03 | User deprovisioning | **Yes.** Revoke API keys; disable SSO user. | Ops runbook |
| IAM-04 | Least privilege | **Yes.** `owner`, `admin`, `member` roles. | `userStore.ts` |
| IAM-05 | MFA | **Yes** for production infrastructure access. | Cloud consoles |
| IAM-06 | SSO | **Yes (Enterprise).** SAML 2.0. | `samlService.ts` |
| IAM-07 | Password policy | **N/A** — API tokens and SSO; no Coop-managed passwords for extension users. | Architecture |

## IPY — Interoperability & Portability

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| IPY-01 | Data export | **Yes.** Graph metadata exportable via API; Customer can request data export on termination. | API docs |
| IPY-02 | Portability | **Self-hosted** deployment provides full portability. | Enterprise |

## IVS — Infrastructure & Virtualization Security

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| IVS-01 | Infrastructure security | **Inherited** from cloud provider + hardened container images. | Deployment |
| IVS-02 | Network segmentation | **Cloud VPC** / Customer network for self-hosted. | Deployment |
| IVS-03 | OS hardening | **Container-based** deployment; minimal attack surface. | Docker Compose |

## LOG — Logging & Monitoring

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| LOG-01 | Logging policy | **Yes.** Sensitive data excluded from logs by design. | Security page |
| LOG-02 | Audit logs | **Yes.** BYOK audit logs (90 days, no content); compliance audit events. | `byokHandler.ts` |
| LOG-03 | Log protection | **Access-controlled** per deployment. | Ops |
| LOG-04 | Security monitoring | **Partial.** Startup compliance checks; webhook health endpoints. | `/health`, `/webhooks/health` |
| LOG-05 | Prompt/code in logs | **No** — explicitly excluded. | Security page, `zero-retention-llm.md` |

## SEF — Security Incident Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| SEF-01 | Incident response plan | **Yes.** security@coop-ai.dev; responsible disclosure program. | Security page |
| SEF-02 | Incident reporting | **Yes** — 48h vuln ack; 72h breach notification per DPA. | DPA §4.8 |
| SEF-03 | Incident training | **Engineering on-call** procedures. | Internal |
| SEF-04 | Customer notification | **Yes** per DPA. | DPA |

## STA — Supply Chain Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| STA-01 | Third-party risk | **Yes** — LLM provider compliance registry with legal review flags. | `providerCompliance.ts` |
| STA-02 | Dependency management | **Yes** — lockfile, npm audit. | CI |
| STA-03 | Subprocessor agreements | **Yes** — DPA Exhibit A. | DPA |

## TVM — Threat & Vulnerability Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| TVM-01 | Vulnerability management | **Yes** — dependency scanning; responsible disclosure. | security@coop-ai.dev |
| TVM-02 | Patch management | **Yes** — dependency updates via PR process. | Git |
| TVM-03 | Penetration testing | **On request** for Enterprise; planned regular cadence. | Sales SOW |

## UEM — Universal Endpoint Management

| Control | Question | Response | Evidence |
|---------|----------|----------|----------|
| UEM-01 | Endpoint security | **Customer IDE** — VS Code SecretStorage uses OS keychain. Coop does not manage Customer endpoints. | Extension architecture |
| UEM-02 | MDM | **Customer responsibility** for managed devices. | — |

---

## Zero-retention LLM control matrix (CAIQ supplement)

| Provider | No training (default API) | Zero-retention eligible | DPA required | Legal review | Verified |
|----------|---------------------------|-------------------------|--------------|--------------|----------|
| Anthropic | Yes | Yes | No | No | 2026-05-28 |
| OpenAI | Yes | Yes | Yes | No | 2026-05-28 |
| Google Gemini | Yes (paid) | Yes | Yes | No | 2026-05-28 |
| DeepSeek | No | No | Yes | **Yes — blocked** | 2026-05-28 |

Source: `src/api/zeroRetentionConfig.ts`, `src/compliance/providerCompliance.ts`

---

## Deployment-specific answers

When completing CAIQ in a vendor portal, select answers based on deployment model:

| Topic | Coop-hosted | Self-hosted |
|-------|-------------|-------------|
| Data residency | US (default) | Customer-defined |
| Physical security | Cloud provider | Customer |
| DR/BCP | Shared responsibility | Customer primary |
| Logging/SIEM | Coop + optional export | Customer integrates |
| SOC 2 scope | Coop (roadmap) | Customer environment |

---

## Submission checklist

- [ ] Confirm deployment model with customer
- [ ] Attach SIG Lite or this CAIQ document
- [ ] Attach executed or draft DPA if in legal review
- [ ] Offer live architecture walkthrough (see demo script)
- [ ] Generate deployment-specific attestation if backend access available
- [ ] Update Exhibit A subprocessors with actual cloud host name
- [ ] Legal review any “No” or “Partial” answers before submission

**Contact:** security@coop-ai.dev
