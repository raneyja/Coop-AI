---
title: LLM request controls and retention
description: Understand request controls and the provider account evidence needed for retention claims.
section: enterprise
order: 2
lastUpdated: "2026-10-11"
---

Chat/messages requests through Coop’s maintained formatter receive confidentiality instructions, payload sanitization and provider-compatible formatting. Controls differ by endpoint: some fill-in-the-middle completion paths send code prefixes/suffixes with provider headers and do not pass through that formatter. Check those bodies separately. These are application controls. A custom header, system instruction or source-code flag does not establish provider-side zero retention or no-training terms.

## Qualify the actual provider account

Retention depends on the API product, provider account/project, enabled features, account settings and applicable agreement. Verify those details for the deployment before relying on a zero-retention claim. Missing account evidence leaves that claim unqualified.

Chat, quick actions and inline completion each need their actual outbound path checked. An inline-completion use-case label distinguishes routing; it is not a separate retention agreement or proof of faster responses.

## Provider keys

For a deployment on your infrastructure, its server operator configures supported provider API keys. This is deployment configuration. Customer-owned-key routing per organization, a self-service key-management flow and additional Bedrock/Azure/Vertex connectors are not available product capabilities.

Coordinate provider/account selection with the deployment operator. Do not weaken enterprise provider admission to enable a provider whose account and data-handling terms have not been qualified. See [Enterprise deployment](/docs/enterprise-deployment).

## Evidence and reporting

Automated retention dashboards and signed zero-retention attestations are not available product features. Review the actual deployment's request paths, account settings and data flow with the Coop team, and discuss applicable contractual evidence and a DPA. A generated statement alone is not compliance evidence or certification.

## Next steps

- [Security architecture](/docs/security-architecture)
- [API reference](/docs/api-reference)
