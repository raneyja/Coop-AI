# CoopAI Order Form

> **Disclaimer:** Draft template for legal review. Not legal advice. Mirror of standard enterprise SaaS order-form structure (e.g., Sourcegraph). Execute alongside the [Master Services Agreement](./enterprise-msa-order-form.md) (“**Agreement**”).

**Version:** 1.0-draft  
**Last updated:** June 10, 2026

---

```
CONFIDENTIAL — PROPERTY OF COOP AI
```

## ORDER FORM

This Order Form (“**Order Form**”) is entered into as of the date of last signature below (“**Order Date**”), between the customer listed below (“**Customer**”) and **Coop AI, Inc.**, a Delaware corporation, located at `[COOP REGISTERED ADDRESS]` (“**Coop**”), and its affiliates and subsidiaries. Capitalized terms used but not defined in this Order Form shall have the meanings given to them elsewhere in the **Agreement** (as defined below).

“**Agreement**” means the CoopAI Master Services Agreement executed by the parties, together with this Order Form and any exhibits, addenda, or amendments referenced herein (including the [Data Processing Addendum](./dpa-customer-addendum.md) when executed).

---

## Customer Information

| Field | Value |
|-------|-------|
| **Customer** | `[CUSTOMER LEGAL NAME]` |
| **Sponsor Contact** | `[NAME]` |
| **Billing Address** | `[STREET, CITY, STATE/PROVINCE, COUNTRY, POSTAL CODE]` |
| **Sponsor Phone** | `[PHONE]` |
| **Accounts Payable Email** | `[accounts-payable@customer.com]` |
| **Sponsor Email** | `[sponsor@customer.com]` |
| **Payment Schedule** | Annual |
| **Payment Terms** | Net 30 |
| **PO Required** | ☐ Yes &nbsp; ☐ No |
| **If “yes”, PO No.** | `[PO NUMBER]` |
| **Order Number** | `[OF-YYYY-NNN]` |

---

## Products and Fee Information

### Subscription Period

| Field | Value |
|-------|-------|
| **Start Date** | `[MON DD, YYYY]` |
| **End Date** | `[MON DD, YYYY]` |
| **Duration (Years)** | `1` |

### Deployment

| Field | Value |
|-------|-------|
| **Deployment type** | ☐ Cloud (Managed Instance) &nbsp; ☐ Self-hosted |
| **URL format** | `[customername].api.coopai.dev` (cloud) or Customer-provided endpoint (self-hosted) |
| **Metering metric** | Total User Account (“**Users**”) |

### Line items

| Item Name | Quantity | Net price/Unit | Net Price |
|-----------|----------|----------------|-----------|
| Enterprise Code Intelligence | `[N]` | `$[PRICE].00` | `$[TOTAL].00` |
| **Total Net Price** | | | **`$[TOTAL].00`** |

> **Product description:** Enterprise Code Intelligence includes everything in CoopAI Pro (Lightning Mode, managed cloud code graph, usage analytics) plus enterprise controls: zero-retention LLM routing, BYOK, SAML SSO, compliance attestation, and dedicated onboarding. See [pricing-and-packaging.md](./pricing-and-packaging.md).

**Example (internal reference only — do not print on customer form without approval):**

| Item Name | Quantity | Net price/Unit | Net Price |
|-----------|----------|----------------|-----------|
| Enterprise Code Intelligence | 94 | $588.00 | $55,272.00 |
| **Total Net Price** | | | **$55,272.00** |

---

## Terms & Conditions

- This Order Form is governed by the terms, along with any applicable addenda and amendments, executed by and between the parties (“**Terms**”). No terms or conditions of any purchase order will modify this Agreement or affect the obligations of the parties.

- Customer can add Users in packages of **10** at **`$[ADD-ON PRICE PER USER PER YEAR]`** USD per User per year, which will be prorated for Users added during a Subscription Period. If Customer exceeds the Usage Limitations in a given month, Coop will invoice those additional Users for the remainder of the annual Subscription Period at a prorated daily rate. Coop will not provide credits for decreases in Usage Limitations.

- “**Usage Limitations**” will mean the number of Users as outlined in the quantity section above.

- The Terms and Conditions on this Order Form become a part of the Terms for this and any subsequent Order Form, unless otherwise agreed in writing.

- This order will automatically renew unless either party provides the other party with a written notice of non-renewal at least **forty-five (45)** days prior to the end of the subscription period.

- Coop may include Customer name and logo on Coop’s website at [https://coop-ai.dev/](https://coop-ai.dev/) unless Customer opts out in writing on the Order Form: ☐ Customer opts out of logo usage

### Exhibits (incorporated when checked)

- ☐ Data Processing Addendum — [dpa-customer-addendum.md](./dpa-customer-addendum.md)
- ☐ LLM Zero-Retention Addendum — [dpa-zero-retention-template.md](../templates/dpa-zero-retention-template.md) (Provider: `[PROVIDER NAME]`)
- ☐ Security questionnaire responses — [SIG Lite](./security-questionnaire-sig-lite.md) / [CAIQ](./security-questionnaire-caiq.md)

---

## Signatures

| **Coop AI, Inc.** | **`[CUSTOMER LEGAL NAME]`** |
|-------------------|-----------------------------|
| Signature: _________________________ | Signature: _________________________ |
| Name: `[NAME]` | Name: `[NAME]` |
| Title: `[TITLE]` | Title: `[TITLE]` |
| Date: __________ | Date: __________ |

---

## Internal fill guide (do not print on customer copy)

| Field | Guidance |
|-------|----------|
| Net price/Unit | Annual per-User price. Enterprise guideline: **$360–$540/user/year** ($30–$45/mo). Sourcegraph benchmark: **$588/user/year**. |
| Add-on package price | Same per-User annual rate as initial order unless volume discount applies. |
| Order Number | Sequential: `OF-2026-001`, etc. |
| Deployment | Default new enterprise deals: **Cloud (Managed Instance)**. Self-hosted for regulated customers. |
| Agreement | MSA must be executed before or concurrently with this Order Form. |
| Public Terms §8 | This Order Form is the “agreed separately” enterprise pricing referenced in [Terms §8](https://coop-ai.dev/terms). |
