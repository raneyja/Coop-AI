# CoopAI Data Processing Addendum (Customer DPA)

> **Disclaimer:** This is a draft template for legal review. It is not legal advice. Have counsel review before execution.

**Version:** 1.0-draft  
**Last updated:** June 10, 2026  
**Incorporates by reference:** [CoopAI Privacy Policy](https://coop-ai.dev/privacy), [Security page](https://coop-ai.dev/security)

This Data Processing Addendum (“**DPA**”) forms part of the agreement between **Coop AI, Inc.** (“**Processor**,” “**Coop**”) and **`[CUSTOMER LEGAL NAME]`** (“**Controller**,” “**Customer**”) (the “**Agreement**”).

---

## 1. Definitions

- **“Applicable Data Protection Law”** means GDPR, UK GDPR, CCPA/CPRA, and other privacy laws applicable to the processing described here.
- **“Customer Personal Data”** means personal data in Customer Content that Processor processes on Customer’s behalf under the Agreement.
- **“Customer Content”** means data Customer or Users submit to the Services, including repository metadata, code excerpts in prompts, chat messages, integration references, and account information — excluding LLM provider API keys stored as encrypted key material.
- **“Services”** means the CoopAI platform described in the Agreement and Order Form.
- **“Subprocessor”** means a third party Processor engages to process Customer Personal Data.

Capitalized terms not defined here have the meanings in the Agreement.

## 2. Scope and roles

2.1 **Processor role.** Processor processes Customer Personal Data only to provide the Services per Customer’s documented instructions (the Agreement, this DPA, and Customer’s configuration of integrations and features).

2.2 **Controller role.** Customer determines purposes and means of processing Customer Personal Data relating to its workforce and systems. Customer is responsible for providing any required notices and obtaining consents from Users.

2.3 **Independent controllers.** Each Party may process contact and billing data about the other’s personnel as an independent controller.

## 3. Details of processing

| Element | Description |
|---------|-------------|
| **Subject matter** | Provision of CoopAI code intelligence Services |
| **Duration** | Subscription Term plus deletion period in §9 |
| **Nature and purpose** | Index repository metadata; assemble context for AI-assisted development; route inference; provide integrations; billing and support |
| **Categories of data subjects** | Customer employees and contractors authorized as Users |
| **Categories of personal data** | Names, work email addresses, user IDs, auth tokens (hashed), usage metadata (timestamps, token counts), repository/PR metadata that may identify individuals, Slack/Jira references that may identify individuals |
| **Special categories** | None intentionally processed; Customer must not submit special-category data unless agreed in writing |
| **Frequency** | Continuous during Subscription Term |

## 4. Processor obligations

4.1 **Instructions.** Processor will process Customer Personal Data only on documented instructions from Customer, unless required by law (in which case Processor will notify Customer unless prohibited).

4.2 **Confidentiality.** Processor ensures personnel with access to Customer Personal Data are bound by confidentiality obligations.

4.3 **Security.** Processor implements measures described on [coop-ai.dev/security](https://coop-ai.dev/security), including:

- TLS 1.2+ for data in transit
- Encryption at rest for BYOK key material and credentials
- Bearer token authentication; VS Code SecretStorage for client tokens
- Zero-retention LLM request configuration (`x-no-training`, `retention_policy` flags)
- Payload sanitization before LLM transmission
- Logging exclusions for prompts, responses, API keys, and raw code
- Provider compliance startup checks (`runProviderComplianceStartupCheck`)

4.4 **No model training.** Processor does not use Customer Content to train machine learning models.

4.5 **Subprocessors.** Customer authorizes the Subprocessors in **Exhibit A**. Processor will impose data protection terms on Subprocessors substantially similar to this DPA. Processor will notify Customer of intended Subprocessor changes and allow objection per §4.6.

4.6 **Subprocessor changes.** Processor will provide at least **thirty (30) days’** notice before adding or replacing a Subprocessor that processes Customer Personal Data. Customer may object on reasonable data-protection grounds within **fifteen (15) days**. If Parties cannot resolve the objection, Customer may terminate the affected Services and receive a pro-rata refund of prepaid fees for terminated Services.

4.7 **Assistance.** Processor will assist Customer with data subject requests and DPIAs, considering the nature of processing and information available to Processor.

4.8 **Incidents.** Processor will notify Customer without undue delay (target **seventy-two (72) hours**) after confirming a personal data breach affecting Customer Personal Data in Processor’s control, and will provide information reasonably required for Customer’s regulatory obligations.

4.9 **Deletion.** Upon termination, Processor will delete or return Customer Personal Data per §9 unless law requires retention.

4.10 **Audits.** Upon reasonable notice, Processor will make available information necessary to demonstrate compliance (security questionnaire responses, architecture documentation, compliance attestation reports). On-site audits may be conducted no more than once annually with **thirty (30) days’** notice, during business hours, subject to confidentiality, and at Customer’s expense unless audit reveals material breach by Processor.

## 5. Customer obligations

5.1 Customer will configure integrations lawfully and ensure Users comply with the Agreement.

5.2 Customer is responsible for BYOK provider agreements when BYOK is enabled.

5.3 Customer will not submit special-category data or regulated health/financial data unless Parties agree in writing.

## 6. International transfers

6.1 Where Applicable Data Protection Law requires safeguards for transfers, Processor will execute Standard Contractual Clauses or UK IDTA as applicable (**Exhibit B**).

6.2 Customer acknowledges Coop-hosted Services may process data in the **United States** unless the Order Form specifies self-hosted deployment in Customer’s environment.

## 7. CCPA / CPRA

To the extent CCPA/CPRA applies, Processor is a **service provider** / **processor**. Processor will not (a) sell or share Customer Personal Data, (b) retain, use, or disclose it for any purpose other than providing the Services, or (c) combine it with other sources except as permitted by CPRA.

## 8. LLM inference processing

8.1 **Third-party LLM providers.** Inference requests may be transmitted to LLM providers (Anthropic, OpenAI, Google Gemini, and others enabled on the Order Form). Processor applies zero-retention configuration where supported.

8.2 **Provider terms.** Provider-side retention and training posture is governed by Customer’s or Processor’s agreement with each provider. For Enterprise BYOK, Customer’s provider agreement controls.

8.3 **Supplemental addendum.** Where Customer requires contractual zero-retention terms directly with a provider, use the [LLM Zero-Retention DPA Addendum](../templates/dpa-zero-retention-template.md) between Customer and the provider (Processor may facilitate but is not a party unless stated).

8.4 **Blocked providers.** DeepSeek and other providers flagged `requires_legal_review` in Coop’s configuration are disabled for enterprise-confidential routing unless Customer provides written legal approval.

## 9. Data retention and deletion

| Data type | Default retention | Deletion |
|-----------|-------------------|----------|
| Graph / repository index metadata | Subscription Term | Deleted within **thirty (30) days** of termination upon request |
| Chat / prompt content (Processor systems) | Transient processing only; not stored for training | N/A — not retained beyond request path |
| BYOK audit logs | **90 days** | Auto-deleted; no prompts or code content |
| Account / billing records | Legal retention period | Per law |
| Self-hosted deployments | Customer-controlled | Customer operates deletion |

## 10. Liability

Liability under this DPA is subject to the limitation of liability in the Agreement.

## 11. Order of precedence

If conflict: (1) this DPA for data protection matters; (2) Order Form for commercial terms; (3) MSA; (4) public Privacy Policy for website-only processing.

---

## Exhibit A — Authorized subprocessors

> Update this exhibit when infrastructure vendors change. Last reviewed: June 10, 2026.

| Subprocessor | Purpose | Location | Data processed |
|--------------|---------|----------|----------------|
| **Anthropic, PBC** | LLM inference (if enabled) | US | Prompts, code excerpts in requests |
| **OpenAI, LLC** | LLM inference (if enabled) | US | Prompts, code excerpts in requests |
| **Google LLC** (Gemini API) | LLM inference (if enabled) | US | Prompts, code excerpts in requests |
| **DeepSeek** | LLM inference (only if legally approved) | `[REGION]` | Prompts, code excerpts in requests |
| **Vercel Inc.** | Marketing website hosting | US | Website form submissions only (not extension data) |
| **Google LLC** (Sheets) | Demo/waitlist form storage (if configured) | US | Contact form fields |
| **`[CLOUD HOST — e.g., AWS/GCP/Fly]`** | Coop-hosted backend (if applicable) | `[REGION]` | Customer Content in Coop-hosted deployments |
| **PostgreSQL provider** | Job queue, org data, graph cache (if applicable) | `[REGION]` | Metadata, encrypted credentials |
| **GitHub / GitLab / Atlassian** | Customer-authorized integrations | Various | Per Customer configuration |

*Self-hosted deployments:* Customer’s infrastructure providers replace Coop-hosted subprocessors for data stored in Customer’s environment.

---

## Exhibit B — Standard Contractual Clauses

`[Attach executed EU SCCs (Module 2: Controller to Processor) or UK IDTA as required. Coop legal to maintain current versions.]`

---

## Signatures

**Customer (`[CUSTOMER LEGAL NAME]`)**

Signature: _________________________  
Name: `[NAME]`  
Title: `[TITLE]`  
Date: __________

**Coop AI, Inc.**

Signature: _________________________  
Name: `[NAME]`  
Title: `[TITLE]`  
Date: __________

---

## Internal redline notes

| Customer ask | Coop default | Notes |
|--------------|--------------|-------|
| Customer paper DPA | Prefer Coop DPA | Map to architecture in `docs/zero-retention-llm.md` |
| Subprocessor list | Exhibit A | Notify 30 days on changes |
| On-site audit | Once/year, Customer cost | Offer SIG/CAIQ + attestation first |
| EU data residency | Self-host or future region | Coop-hosted US default |
| SCCs | Exhibit B | Required for EU/UK customers |
| LLM subprocessors | Listed per enabled provider | BYOK shifts control to Customer account |
