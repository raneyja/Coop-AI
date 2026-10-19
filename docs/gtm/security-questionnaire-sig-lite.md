# CoopAI SIG Lite Response

> **Disclaimer:** Pre-filled from product architecture and security documentation as of June 10, 2026. Review with security@coop-ai.dev before sharing with customers. Update when infrastructure or controls change.

**Vendor:** Coop AI, Inc.  
**Product:** CoopAI — code intelligence platform (VS Code extension + backend server)  
**Questionnaire version:** SIG Lite (aligned to Shared Assessments / CAIQ Lite domains)  
**Primary references:** [coop-ai.dev/security](https://coop-ai.dev/security), `docs/zero-retention-llm.md`, `docs/webhook-backend.md`

---

## A. Enterprise risk management

| ID | Question | Response |
|----|----------|----------|
| A.1 | Is there a formal risk management program? | **Partial.** Risk management is practiced through architecture reviews, provider compliance checks (`runProviderComplianceStartupCheck`), and security documentation. Formal ISO 27001/SOC 2 certification for Coop AI is **not yet complete** — available on roadmap for enterprise customers. |
| A.2 | Is a risk assessment performed at least annually? | **Partial.** LLM provider policies are reviewed at least every **180 days** (`MAX_POLICY_AGE_DAYS` in `providerCompliance.ts`). Full enterprise risk assessment is performed per major release and enterprise deployment. |

## B. Security policy

| ID | Question | Response |
|----|----------|----------|
| B.1 | Is there an information security policy? | **Yes.** Security posture documented at [coop-ai.dev/security](https://coop-ai.dev/security) and internal architecture docs. |
| B.2 | Is the policy reviewed at least annually? | **Yes.** Security page and compliance configs include `verified_date` fields; provider policies re-verified on schedule. |

## C. Organizational security

| ID | Question | Response |
|----|----------|----------|
| C.1 | Is there a designated security contact? | **Yes.** security@coop-ai.dev (48-hour acknowledgment target for vulnerability reports). |
| C.2 | Is security awareness training provided to personnel? | **Yes** — engineering team security practices; formal HR training program scales with headcount. |
| C.3 | Are background checks performed? | **Per hiring policy** — conducted for employees with production access as company scales. |

## D. Asset management

| ID | Question | Response |
|----|----------|----------|
| D.1 | Is there an inventory of assets that store or process customer data? | **Yes.** Assets: CoopAI backend server, PostgreSQL (jobs/orgs/graph cache), encrypted credential store, VS Code extension (client), LLM provider APIs, code host webhooks. |
| D.2 | Is customer data classified? | **Yes.** LLM requests tagged `data_classification: enterprise_confidential` in zero-retention metadata. |

## E. Human resources security

| ID | Question | Response |
|----|----------|----------|
| E.1 | Are confidentiality agreements required? | **Yes** — for employees and contractors with data access. |
| E.2 | Is access revoked upon termination? | **Yes** — production access revoked on termination. |

## F. Physical security

| ID | Question | Response |
|----|----------|----------|
| F.1 | Are data centers physically secured? | **Yes (inherited).** Coop-hosted deployments use cloud providers with physical security certifications (provider-dependent — specify on Order Form). **Self-hosted:** Customer controls physical security. |
| F.2 | Is CoopAI software operated from secured facilities? | **N/A for SaaS model** — engineering workstations use full-disk encryption and OS keychain; production runs in cloud infrastructure. |

## G. Operations security

| ID | Question | Response |
|----|----------|----------|
| G.1 | Are change management procedures documented? | **Yes.** Git-based development, code review, CI before production deploy. |
| G.2 | Are environments separated (dev/staging/prod)? | **Yes.** `NODE_ENV`, separate credentials; `COOP_REQUIRE_API_AUTH=true` in production. |
| G.3 | Is malware protection deployed on endpoints? | **Yes** — standard endpoint protection on engineering devices. |
| G.4 | Are logs monitored? | **Partial.** Provider compliance startup checks, BYOK configuration audit events, webhook health. Centralized SIEM integration is customer-specific for self-hosted. |
| G.5 | Are vulnerability scans performed? | **Partial.** Dependency scanning in CI; penetration testing planned / available on request for Enterprise. |

## H. Access control

| ID | Question | Response |
|----|----------|----------|
| H.1 | Is access based on least privilege? | **Yes.** Role-based org users (`owner`, `admin`, `member`); API keys scoped per org. |
| H.2 | Is multi-factor authentication required for administrative access? | **Yes** — for cloud provider and production admin consoles. |
| H.3 | Is SSO supported for end users? | **Yes (Enterprise).** SAML 2.0 — Okta, Azure AD, generic IdP (`src/server/sso/samlService.ts`). |
| H.4 | How do developers authenticate to the API? | Bearer token (`Authorization: Bearer <COOP_API_TOKEN>`); stored in VS Code SecretStorage (OS keychain). |
| H.5 | Are LLM provider keys stored in the IDE? | **No.** Provider keys stored server-side only; BYOK uses encrypted at-rest storage with hash. |

## I. Application security

| ID | Question | Response |
|----|----------|----------|
| I.1 | Is secure SDLC practiced? | **Yes.** Code review, TypeScript strict mode, automated tests, linting. |
| I.2 | Is input validated? | **Yes.** Webhook signature verification (GitHub `X-Hub-Signature-256`, GitLab token, Slack signing secret); API auth on protected routes. |
| I.3 | Is output encoding used? | **Yes** — standard framework practices in webview and API layers. |
| I.4 | Are third-party dependencies managed? | **Yes** — `package-lock.json`, npm audit in CI. |
| I.5 | Is customer source code stored in the graph cache? | **No.** Cache stores metadata only: paths, sizes, timestamps, authors, SHAs, commit summaries, dependency edges, ownership scores, PR/issue metadata — **not raw source code** (`docs/webhook-backend.md`). |

## J. Cryptography

| ID | Question | Response |
|----|----------|----------|
| J.1 | Is data encrypted in transit? | **Yes.** HTTPS/TLS 1.2+ for all API and webhook communication. |
| J.2 | Is data encrypted at rest? | **Yes** — BYOK key material and stored credentials encrypted (`CREDENTIALS_ENCRYPTION_KEY`); database encryption depends on hosting provider (enable for production Postgres). |
| J.3 | Are cryptographic keys managed securely? | **Yes** — env-based secrets, no keys in source control; `.env` templates for operators. |

## K. Data privacy & zero retention

| ID | Question | Response |
|----|----------|----------|
| K.1 | Is customer data used for model training? | **No.** Coop does not train on customer data. LLM providers receive inference requests under commercial API terms with zero-retention flags. |
| K.2 | What zero-retention controls are applied? | Headers: `x-data-retention-policy: none`, `x-no-training`, `x-no-logging`, `x-enterprise-mode`. Body: `retention_policy` with all flags `false`. Payload sanitization via `sanitizeLlmRequestPayload`. |
| K.3 | What LLM providers are supported? | Anthropic, OpenAI, Google Gemini (paid tier for ZDR); DeepSeek blocked unless legal approves DPA. |
| K.4 | What is retained from LLM requests? | Transient processing only for inference. BYOK audit logs: customer ID, provider, model, timestamp, request ID, status — **90 days**, no prompts/responses/code. |
| K.5 | Is a DPA available? | **Yes.** `docs/gtm/dpa-customer-addendum.md` + LLM provider addendum template. |

## L. Business continuity & disaster recovery

| ID | Question | Response |
|----|----------|----------|
| L.1 | Is there a BCP/DR plan? | **Partial.** Coop-hosted: database backups per cloud provider configuration. Self-hosted: Customer operates DR. |
| L.2 | What is the RPO/RTO? | **Coop-hosted default:** RPO/RTO per infrastructure SLA (specify on Order Form). **Self-hosted:** Customer-defined. |
| L.3 | Is data replicated? | **Configurable** — Postgres replication depends on deployment; graph cache can use `GRAPH_CACHE_BACKEND=postgres`. |

## M. Compliance

| ID | Question | Response |
|----|----------|----------|
| M.1 | SOC 2 Type II? | **Coop AI:** Not yet — roadmap. **LLM providers:** SOC 2 or equivalent required in DPA addendum template. |
| M.2 | GDPR / UK GDPR? | **Supported** via Customer DPA and SCCs (Exhibit B). |
| M.3 | CCPA/CPRA? | **Supported** — service provider terms in DPA §7. |
| M.4 | Can compliance attestations be generated? | **Yes.** `retentionReport.ts` generates signed attestation payloads: zero-retention flag %, BYOK counts, provider policy verification dates, sanitization rules, config changes (90 days). |
| M.5 | HIPAA? | **Not supported** out of box — no BAA. Customer must not submit PHI unless separately agreed. |

## N. Third party / subprocessors

| ID | Question | Response |
|----|----------|----------|
| N.1 | Are subprocessors disclosed? | **Yes** — Exhibit A in Customer DPA. |
| N.2 | Are subprocessor agreements in place? | **Yes** — standard vendor terms; LLM providers under API enterprise agreements where applicable. |

## O. Incident management

| ID | Question | Response |
|----|----------|----------|
| O.1 | Is there an incident response plan? | **Yes** — security@coop-ai.dev; 48-hour vuln acknowledgment; 72-hour breach notification target per DPA. |
| O.2 | Are customers notified of breaches? | **Yes** — per DPA §4.8 for confirmed personal data breaches. |

## P. Network security

| ID | Question | Response |
|----|----------|----------|
| P.1 | Are networks segmented? | **Yes (cloud provider).** Production network isolation per hosting provider; self-hosted Customer controls network. |
| P.2 | Is ingress traffic restricted? | **Yes** — API auth required in production; webhook endpoints validate signatures. |

---

## Architecture summary (for assessors)

```
Developer IDE (VS Code)
    │  SecretStorage: Coop API token only
    │  HTTPS
    ▼
CoopAI Backend (Customer or Coop hosted)
    │  Graph cache (metadata only, no raw source)
    │  Job queue (Postgres)
    │  Webhook ingestion (GitHub/GitLab/Slack)
    │  Model Router + zero-retention layer
    │  HTTPS
    ▼
LLM Providers (Anthropic / OpenAI / Gemini)
    └── Inference only; zero-retention flags; no Coop training
```

**Deployment options:**

| Model | Data location | Best for |
|-------|---------------|----------|
| Coop-hosted cloud | Coop infrastructure (US default) | Fastest onboarding |
| Self-hosted | Customer VPC / on-prem | Strict data residency, air-gapped |

---

## Attachments available on request

- Customer DPA (`dpa-customer-addendum.md`)
- Zero-retention LLM architecture (`docs/zero-retention-llm.md`)
- Webhook backend architecture (`docs/webhook-backend.md`)
- LLM prompt data flow (`docs/llm-prompt-architecture.md`)
- Signed compliance attestation (generated per deployment)
- Penetration test summary (when available)

**Contact:** security@coop-ai.dev
