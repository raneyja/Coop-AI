# LLM request controls and retention qualification

The maintained chat/messages formatting path uses `src/api/requestFormatter.ts`, `src/api/dataSanitization.ts`, and `src/api/zeroRetentionConfig.ts`. These implement request formatting, sanitization and configured provider admission. They do not establish a provider account's retention settings or contractual terms.

## Implemented controls

`formatZeroRetentionRequest` sanitizes the payload, adds the confidentiality system instruction, applies configured provider admission unless an explicit permitted override is used, and formats a provider-compatible request. `ModelRouter` also enforces the configured provider boundary on its maintained paths. Mistral and DeepSeek fill-in-the-middle completion paths send prefixes/suffixes with provider headers and bypass this formatter; do not claim those bodies received its system instruction or sanitization. Qualify endpoint-specific controls separately.

The common configuration defines confidentiality headers and retention annotations. Actual provider bodies differ: Anthropic accepts only its supported Messages fields and `metadata.user_id`; Gemini formatting emits supported generation fields and does not attach tools for web search. Do not describe every common annotation as an accepted provider retention switch. A system instruction or custom header is not evidence of provider-side zero retention.

Sanitization is a bounded transformation with covered cases. It is not proof that arbitrary source, prompts, logs or telemetry contain no sensitive data. Validate the actual outbound request and error/telemetry path for each supported provider and deployment.

## Capabilities not implemented

Customer-owned-key routing (BYOK), customer retention dashboards, signed compliance attestations and an automatic provider-compliance startup check have no maintained application entrypoint. Their uncalled prototype modules have been removed. They are not supported product capabilities and must not be included in buyer promises or qualification evidence. Historical roadmap and template material is not an implementation or certification claim.

A future BYOK or reporting feature requires an explicit design, credential storage/access boundary, wired request path, durable audit source and end-to-end qualification. An in-memory example or generated attestation is insufficient.

## Enterprise release evidence

For each enabled provider, record the exact API product, account/project, credentials owner, permitted feature set, configured retention controls and independently verified applicable agreement/settings. Keep this evidence separate from source-code flags and static policy dates. Missing account evidence leaves that provider's retention claim unqualified.

Use the current enterprise execution plan and release ledger for deployment-specific data-flow, retention/deletion, offboarding and security gates. Verify what is actually logged, persisted, exported and deleted, including backups and external providers. No source configuration or document alone establishes compliance certification or successful operational deletion.
