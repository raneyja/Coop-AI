# Zero-Retention LLM Configuration

CoopAI routes code-intelligence requests through a zero-retention configuration layer before any LLM provider receives enterprise code context.

## Request Controls

Every request is formatted through `src/api/requestFormatter.ts` and receives:

- A system instruction declaring CoopAI code context enterprise-confidential.
- Standard headers: `x-data-retention-policy`, `x-use-case`, `x-enterprise-mode`, `x-no-training`, and `x-no-logging`.
- Body annotations under `retention_policy` with `store_conversation`, `use_for_training`, `use_for_fine_tuning`, and `allow_logging` set to `false`.
- Provider-specific no-retention metadata where supported.

All request bodies should pass through `sanitizeLlmRequestPayload` before transmission.

## Provider Posture

- OpenAI: standard inference endpoints only. API data is not used for training by default, but default abuse-monitoring retention may still apply unless the customer has approved zero data retention.
- Anthropic: standard Claude Messages API only. Commercial API data is not used for training by default unless the customer explicitly opts in or submits feedback.
- Google Gemini: use paid Gemini API or Vertex AI terms for no-training assurances. Disable web search, context caching, Interactions API storage, and Live API session resumption for zero-retention workloads.
- DeepSeek: blocked for enterprise-confidential routing unless legal approves a DPA or equivalent no-training/no-retention contract. Public policy language is not sufficient for automatic enterprise approval.

## BYOK

`src/api/byokHandler.ts` routes customer-owned keys through the customer's provider account. CoopAI stores only an API key hash and encrypted key material. Decrypted keys must exist only for the duration of the outbound request and must never be logged.

BYOK audit logs include customer ID, provider, model, timestamp, request ID, status, and status code. They must not include API keys, prompts, responses, or raw code context. Audit retention is 90 days.

## Compliance Reporting

`src/compliance/retentionReport.ts` builds dashboard summaries and signed attestation payloads:

- Percentage of requests sent with zero-retention flags.
- Count of BYOK requests.
- Provider policy links and verification dates.
- Sanitization rules applied before transmission.
- Configuration changes in the last 90 days.

Use a deployment-specific `PdfRenderer` to convert the attestation HTML into a PDF for SOC 2 evidence.

## Operational Requirements

- Run `runProviderComplianceStartupCheck` on backend startup and alert on critical findings.
- Treat stale policy verification dates as requiring review.
- Log configuration changes for BYOK, provider enablement, and policy overrides.
- Exclude request bodies, response bodies, API keys, and prompt content from error logs and crash dumps.
- Keep provider allowlists tied to `requireEnterpriseApprovedProvider`.
