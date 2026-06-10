# CoopAI Enterprise Master Services Agreement & Order Form

> **Disclaimer:** This is a draft template for legal review. It is not legal advice. Have counsel review before use with customers.

**Version:** 1.0-draft  
**Last updated:** June 10, 2026  
**Governing public terms:** [CoopAI Terms of Service](https://coop-ai.dev/terms) (incorporated by reference except where this Agreement expressly supersedes)

---

## How this document works

1. **Master Services Agreement (MSA)** — Governs the ongoing relationship.
2. **Order Form** — Commercial terms for a specific subscription (seats, term, fees). Each Order Form incorporates this MSA.
3. **Public Terms §8** — The public Terms state that *“Enterprise pricing will be agreed separately.”* This Order Form is that separate commercial agreement.

---

# Part A — Master Services Agreement

This Master Services Agreement (“**Agreement**”) is entered into as of the **Effective Date** on the Order Form below, by and between:

**Customer:** `[CUSTOMER LEGAL NAME]` (“**Customer**”)  
**Coop:** Coop AI, Inc. (“**Coop**,” “**we**,” “**us**”)

Each a “**Party**” and together the “**Parties**.”

## 1. Services

1.1 **CoopAI Platform.** Coop will provide access to the CoopAI code intelligence platform, consisting of the VS Code extension, backend server (graph, jobs, webhooks, LLM routing), and related documentation (collectively, the “**Services**”), as described on the applicable Order Form and Coop’s then-current product documentation.

1.2 **Deployment model.** Services may be delivered as Coop-hosted cloud or Customer self-hosted infrastructure, as specified on the Order Form. In self-hosted deployments, Customer is responsible for operating the server environment, network controls, and backup of Customer-controlled data stores.

1.3 **Support.** Coop will provide support per the support tier on the Order Form (e.g., priority email for Enterprise).

1.4 **Beta features.** Features labeled beta, preview, or experimental are provided as-is and may change or be discontinued with reasonable notice.

## 2. License and restrictions

2.1 **License grant.** Subject to payment and this Agreement, Coop grants Customer a non-exclusive, non-transferable (except as permitted in §12), limited license during the Subscription Term for Customer’s authorized users (“**Users**”) to access and use the Services solely for Customer’s internal business purposes.

2.2 **Seat limits.** Use is limited to the number of licensed seats on the Order Form. A “seat” is one unique User who accesses the Services during a rolling thirty (30) day period. Customer will not exceed licensed seats without purchasing additional seats.

2.3 **Restrictions.** Customer will not: (a) sublicense, resell, or provide the Services to third parties except affiliates under Customer’s control; (b) reverse engineer the Services except where prohibited by law; (c) use the Services to build a competing product; (d) remove proprietary notices; or (e) use the Services in violation of applicable law.

2.4 **Open source.** Portions of the Services may include open-source software subject to separate licenses identified in documentation.

## 3. Customer responsibilities

3.1 **Accounts and credentials.** Customer is responsible for User accounts, API tokens, IdP configuration (SSO), and integration credentials. Customer will promptly revoke access for terminated Users.

3.2 **Acceptable use.** Customer will not submit unlawful content or use the Services to compromise third-party systems. Customer is solely responsible for reviewing AI-generated output before production use.

3.3 **Integrations.** Customer authorizes Coop to receive webhooks and API data from code hosts and chat systems Customer connects (e.g., GitHub, GitLab, Bitbucket, Slack, Jira). Customer represents it has authority to connect those systems.

3.4 **BYOK.** If Customer uses Bring Your Own Key (“**BYOK**”), Customer is responsible for its agreements with LLM providers and for key rotation. Coop stores only encrypted key material and hashes as described in the Security documentation.

## 4. Fees and payment

4.1 **Order Form fees.** Customer will pay fees set forth on the Order Form. Fees are as agreed separately per public Terms §8 (Fees and payment).

4.2 **Invoicing.** Unless otherwise stated on the Order Form, Coop invoices annually in advance. Payment is due net thirty (30) days unless a different term is specified.

4.3 **Taxes.** Fees exclude taxes. Customer is responsible for applicable sales, VAT, and similar taxes excluding taxes based on Coop’s net income.

4.4 **Late payment.** Overdue amounts may accrue interest at 1.5% per month (or the maximum permitted by law) and Coop may suspend Services after written notice.

4.5 **No training use.** Coop does not use Customer code, prompts, or completions to train machine learning models. This does not limit LLM providers’ processing under Customer’s or Coop’s provider agreements.

## 5. Data protection

5.1 **Roles.** For personal data processed on Customer’s behalf through the Services, Coop acts as a processor (or service provider) and Customer acts as controller (or business), as defined by applicable privacy law.

5.2 **DPA.** The Parties will execute Coop’s Data Processing Addendum (`docs/gtm/dpa-customer-addendum.md` or successor) when required by law or Customer policy. The DPA is incorporated by reference upon execution.

5.3 **Security.** Coop will maintain administrative, technical, and organizational measures described on [coop-ai.dev/security](https://coop-ai.dev/security) and in architecture documentation provided during enterprise evaluation.

5.4 **Subprocessors.** Coop may use subprocessors listed in the DPA. Coop will provide notice of material subprocessor changes per the DPA.

5.5 **Incident notification.** Coop will notify Customer without undue delay upon becoming aware of a confirmed security incident affecting Customer personal data in Coop’s control, and will cooperate on remediation as required by law.

## 6. Confidentiality

6.1 **Definition.** “**Confidential Information**” means non-public information disclosed by either Party that is marked confidential or would reasonably be understood as confidential, including Customer source code excerpts, prompts, business plans, and Coop product roadmaps.

6.2 **Obligations.** The receiving Party will use Confidential Information only to perform under this Agreement, protect it with reasonable care, and disclose it only to personnel and contractors with a need to know under confidentiality obligations.

6.3 **Exclusions.** Confidential Information does not include information that is public without breach, already known, independently developed, or rightfully received from a third party.

6.4 **Compelled disclosure.** A Party may disclose Confidential Information when required by law, with reasonable notice to the other Party where permitted.

## 7. Intellectual property

7.1 **Coop IP.** Coop retains all rights in the Services, documentation, and improvements thereto. No rights are granted except as expressly stated.

7.2 **Customer data.** Customer retains all rights in data Customer submits. Customer grants Coop a limited license to process Customer data solely to provide the Services.

7.3 **Feedback.** Customer may provide suggestions; Coop may use feedback without restriction or attribution.

## 8. Warranties and disclaimers

8.1 **Coop warranty.** Coop warrants that it will provide the Services in a professional manner substantially consistent with documentation.

8.2 **Disclaimer.** EXCEPT AS EXPRESSLY PROVIDED, THE SERVICES ARE PROVIDED “AS IS.” COOP DISCLAIMS ALL OTHER WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. COOP DOES NOT WARRANT THAT AI OUTPUTS WILL BE ACCURATE OR SUITABLE FOR PRODUCTION.

8.3 **Customer warranty.** Customer warrants it has rights to connect repositories and integrations and to submit data to the Services.

## 9. Limitation of liability

9.1 **Exclusion.** NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF PROFITS, DATA, OR GOODWILL.

9.2 **Cap.** EXCEPT FOR (A) CUSTOMER’S PAYMENT OBLIGATIONS, (B) BREACH OF CONFIDENTIALITY, OR (C) CUSTOMER’S VIOLATION OF §2.3, EACH PARTY’S TOTAL LIABILITY ARISING FROM THIS AGREEMENT WILL NOT EXCEED THE FEES PAID OR PAYABLE BY CUSTOMER IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.

9.3 **Alignment with public Terms.** This cap aligns with public Terms §10 (Limitation of liability) for consistency; the Order Form fees replace the public Terms’ $100 floor.

## 10. Term and termination

10.1 **Term.** This Agreement begins on the Effective Date and continues until all Order Forms expire or are terminated.

10.2 **Order Form term.** Each Order Form specifies its Subscription Term and renewal.

10.3 **Termination for cause.** Either Party may terminate for material breach not cured within thirty (30) days of written notice.

10.4 **Effect.** Upon termination, Customer’s license ends. Coop will delete or return Customer personal data per the DPA. Sections that by nature should survive (confidentiality, liability limits, governing law) survive.

10.5 **Wind-down.** For self-hosted deployments, Customer may continue operating licensed software already deployed until the end of the paid Subscription Term unless terminated for cause.

## 11. Service levels (optional)

If an SLA exhibit is attached to the Order Form, it governs service credits. Absent an SLA exhibit, Coop targets commercially reasonable availability for Coop-hosted Services but does not guarantee uptime.

## 12. General

12.1 **Governing law.** Delaware law, excluding conflict-of-law rules (consistent with public Terms §13).

12.2 **Disputes.** Exclusive jurisdiction in state or federal courts located in Delaware, unless the Parties agree to arbitration in the Order Form.

12.3 **Assignment.** Customer may not assign without Coop’s consent, except to a successor in a merger or acquisition. Coop may assign to an affiliate or acquirer.

12.4 **Notices.** Legal notices to Coop: legal@coop-ai.dev. Notices to Customer: billing contact on the Order Form.

12.5 **Entire agreement.** This Agreement, Order Forms, DPA, and executed exhibits supersede prior discussions. If conflict, Order Form commercial terms control for fees and term; DPA controls for data protection; MSA controls otherwise.

12.6 **Amendment.** Amendments must be in writing signed by both Parties, except Coop may update security documentation and non-material policies with notice.

12.7 **Public Terms.** The [CoopAI Terms of Service](https://coop-ai.dev/terms) and [Privacy Policy](https://coop-ai.dev/privacy) apply to website use and are incorporated for Services except where this Agreement expressly supersedes them (including §8 fees, which are set on the Order Form).

---

# Part B — Order Form

**Order Form #:** `[OF-YYYY-NNN]`  
**Effective Date:** `[DATE]`  
**Subscription Term:** `[12] months` (auto-renews for successive `[12]`-month periods unless either Party gives `[60]` days’ notice before renewal)

### Customer information

| Field | Value |
|-------|-------|
| Legal entity name | `[CUSTOMER LEGAL NAME]` |
| Billing address | `[ADDRESS]` |
| Primary contact | `[NAME, EMAIL]` |
| Technical contact | `[NAME, EMAIL]` |
| Billing contact | `[NAME, EMAIL]` |

### Subscription

| Item | Details |
|------|---------|
| **Plan** | ☐ Enterprise (includes Pro features + enterprise controls) |
| **Deployment** | ☐ Coop-hosted cloud &nbsp; ☐ Customer self-hosted |
| **Licensed seats** | `[N]` Users (minimum commit: `[N]` seats) |
| **Repositories** | Up to `[N]` repos under Lightning indexing (if applicable) |
| **SSO** | ☐ SAML (Okta / Azure AD / generic) — included with Enterprise |
| **BYOK** | ☐ Enabled |
| **Zero-retention routing** | ☐ Enabled (default for Enterprise) |
| **Support tier** | ☐ Priority email &nbsp; ☐ Dedicated onboarding (hours: `[N]`) |

### Fees

| Line item | Amount |
|-----------|--------|
| Enterprise platform fee (annual) | `$[AMOUNT]` |
| Per-seat fee (`[N]` × `$[RATE]` / seat / year) | `$[AMOUNT]` |
| **Minimum annual commit** | **`$[TOTAL]`** |
| One-time onboarding (optional) | `$[AMOUNT]` |
| **Total due at signing** | **`$[AMOUNT]`** |

> **Note:** Pro list price is **$20/user/month** on the public pricing page. Enterprise pricing is custom per Terms §8. Typical enterprise packaging uses annual commits with volume discounts — see [pricing-and-packaging.md](./pricing-and-packaging.md).

### Payment terms

☐ Annual invoice, net 30 &nbsp; ☐ Quarterly invoice, net 30 &nbsp; ☐ Other: `[SPECIFY]`

### Special terms

`[Optional: pilot period, phased rollout, custom SLA, data residency, approved LLM providers, etc.]`

### Exhibits (check all that apply)

- ☐ Data Processing Addendum (`dpa-customer-addendum.md`)
- ☐ LLM Zero-Retention Addendum (`docs/templates/dpa-zero-retention-template.md`) — per provider: `[PROVIDER NAMES]`
- ☐ SLA exhibit
- ☐ Security exhibit / questionnaire responses (`security-questionnaire-sig-lite.md` or `security-questionnaire-caiq.md`)

### Signatures

**Customer**

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

## Redline guidance (internal)

| Topic | Default position | Common customer asks |
|-------|------------------|-------------------|
| Liability cap | 12 months fees | 24 months fees; carve-outs for data breach |
| DPA | Coop form DPA | Customer paper — negotiate subprocessors & SCCs |
| Audit rights | Per DPA (questionnaire + attestation) | On-site audit — offer SOC 2 when available |
| Data residency | US-hosted default; self-host for strict residency | EU region (roadmap) |
| SLA | Optional exhibit | 99.9% with credits |
| AI indemnity | Not included | Rare; refer to Customer review obligations |
