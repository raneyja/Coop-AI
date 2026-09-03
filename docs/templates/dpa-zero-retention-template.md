# CoopAI Zero-Retention DPA Addendum Template

This template is a starting point for legal review. It is not legal advice.

## When to use this document

| Document | Parties | Use case |
|----------|---------|----------|
| **This template** | Customer ↔ LLM Provider | BYOK or when Customer needs direct zero-retention contractual terms with Anthropic, OpenAI, Google, etc. |
| [Customer DPA](../gtm/dpa-customer-addendum.md) | Customer ↔ Coop AI | Coop as processor of personal data in the CoopAI platform |
| [Enterprise MSA + Order Form](../gtm/enterprise-msa-order-form.md) | Customer ↔ Coop AI | Commercial terms per [Terms §8](https://coop-ai.dev/terms) |

Coop facilitates inference routing but is typically **not a party** to this addendum unless explicitly stated. For Coop-hosted keys, Customer may still request Provider execute this addendum alongside Customer's enterprise provider agreement.

## Customer-specific redlines (legal review checklist)

Before sending to Customer or Provider counsel, complete:

- [ ] Replace `[CUSTOMER LEGAL NAME]` and `[LLM PROVIDER LEGAL NAME]`
- [ ] Set `[PROVIDER]` (e.g., OpenAI, Anthropic, Google)
- [ ] Set `[RETENTION DAYS]` — recommend **0–30** for zero-retention posture; align with provider's ZDR program
- [ ] Confirm provider is enabled in Customer's Order Form (DeepSeek requires separate legal approval)
- [ ] Attach provider's current SOC 2 / ISO report and policy URL from `src/api/zeroRetentionConfig.ts`
- [ ] Cross-reference Customer's executed [Customer DPA](../gtm/dpa-customer-addendum.md) Exhibit A
- [ ] If BYOK: confirm Customer's provider account has zero data retention or equivalent enabled

## Parties

- Customer: `[CUSTOMER LEGAL NAME]`
- Processor/Subprocessor: `[LLM PROVIDER LEGAL NAME]`
- Service: CoopAI code-intelligence inference requests through `[PROVIDER]`

## Data Scope

Customer data may include private source code excerpts, repository metadata, issue references, security findings, and developer-authored prompts. Customer data excludes API credentials, which must be handled only as encrypted key material or transient request authorization.

## Processing Purpose

Provider may process customer data only to perform inference for the specific request submitted by CoopAI or the customer's BYOK account. Provider must not use customer data for model training, model improvement, fine-tuning, evaluation datasets, benchmarking, marketing, or product analytics.

## Retention

Provider must not store prompts, completions, source code, or derived embeddings beyond transient processing needed to return the inference result, except for security diagnostics expressly required by law or approved in writing by Customer.

## Logging

Provider logs must exclude prompt bodies, response bodies, source code, API keys, and secrets. Any permitted diagnostic logs must be access-controlled, encrypted, and deleted within `[RETENTION DAYS]` days.

## Access Controls

Provider must restrict access to authorized personnel with a documented business need, maintain audit trails for access, and provide access reports upon request.

## Subprocessors

Provider must disclose subprocessors involved in inference, logging, abuse monitoring, support, and storage. Provider must not add subprocessors that materially change data retention or training posture without notice.

## Security

Provider must encrypt data in transit with TLS 1.2 or newer and encrypt any permitted transient storage at rest. Provider must maintain SOC 2 Type II or equivalent controls.

## Deletion and Return

Provider must delete customer data upon request and certify deletion when legally permitted. Provider must support reasonable audit evidence for deletion and retention controls.

## BYOK

When Customer uses BYOK, Provider acknowledges all inference calls are routed through Customer's provider account and governed by Customer's provider terms. CoopAI must not receive plaintext API keys except transiently inside the approved request path.

## Audit Evidence

Provider will make available policy documentation, retention configuration evidence, and no-training attestations reasonably necessary for Customer SOC 2, ISO 27001, or regulatory audits.

## Signatures

Customer Signature: ______________________ Date: __________

Provider Signature: ______________________ Date: __________
