# Go-to-market & legal document index

Internal sales, legal, and security artifacts for CoopAI enterprise deals. All templates are **starting points for legal review** — they are not legal advice.

| Document | Path | Audience | Status |
|----------|------|----------|--------|
| Enterprise MSA + Order Form | [enterprise-msa-order-form.md](./enterprise-msa-order-form.md) | Legal, sales | Draft |
| Customer DPA Addendum | [dpa-customer-addendum.md](./dpa-customer-addendum.md) | Legal, security, procurement | Draft |
| LLM Provider Zero-Retention DPA | [../templates/dpa-zero-retention-template.md](../templates/dpa-zero-retention-template.md) | Legal, customer + provider counsel | Template (reviewed) |
| SIG Lite questionnaire | [security-questionnaire-sig-lite.md](./security-questionnaire-sig-lite.md) | Security, procurement | Pre-filled from architecture |
| CAIQ questionnaire | [security-questionnaire-caiq.md](./security-questionnaire-caiq.md) | Security, procurement | Pre-filled from architecture |
| Pricing & packaging | [pricing-and-packaging.md](./pricing-and-packaging.md) | Sales, marketing, finance | Internal GTM |
| Demo script + demo org | [demo-script-and-demo-org.md](./demo-script-and-demo-org.md) | Sales, solutions engineering | Runbook |

## Related public & technical references

- [Terms of Service](https://coop-ai.dev/terms) — §8 Fees and payment (“Enterprise pricing will be agreed separately”)
- [Privacy Policy](https://coop-ai.dev/privacy)
- [Security page](https://coop-ai.dev/security)
- [Pricing page](https://coop-ai.dev/pricing)
- [Enterprise page](https://coop-ai.dev/enterprise)
- [Zero-retention LLM configuration](../zero-retention-llm.md)
- [Webhook backend architecture](../webhook-backend.md)
- [Integration onboarding](../integration-onboarding.md)

## Contacts

| Purpose | Email |
|---------|-------|
| Sales / demos | hello@coop-ai.dev |
| Privacy / DPA | privacy@coop-ai.dev |
| Security / questionnaires | security@coop-ai.dev |

## Deal workflow (typical)

1. **Discovery** — Use [demo script](./demo-script-and-demo-org.md) on the stable demo org.
2. **Security review** — Share [SIG Lite](./security-questionnaire-sig-lite.md) or [CAIQ](./security-questionnaire-caiq.md); offer architecture docs and `/security` page.
3. **Commercial** — Quote per [pricing & packaging](./pricing-and-packaging.md); execute [Order Form](./enterprise-msa-order-form.md) (incorporates MSA).
4. **Legal** — Customer DPA ([dpa-customer-addendum.md](./dpa-customer-addendum.md)); optional LLM provider addendum ([template](../templates/dpa-zero-retention-template.md)) for BYOK or zero-retention attestations.
5. **Provisioning** — `scripts/admin-org.ts` for org, API keys, SSO; integration seeders per demo runbook.
