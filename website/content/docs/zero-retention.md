---
title: Zero-retention LLM routing
description: Configure zero-retention headers for enterprise-confidential code paths.
section: enterprise
order: 2
lastUpdated: "2026-06-29"
---

Zero-retention routing ensures LLM providers do not retain prompts or completions for training or logging beyond the request lifecycle.

## When zero-retention applies

| Path | Retention |
| --- | --- |
| **Chat** (`POST /v1/chat`) | Standard provider retention policies; Enterprise can enforce zero-retention |
| **Inline completion** | Separate path with `x-use-case: code-completion-only` — distinct from chat |
| **Enterprise confidential** | Zero-retention headers on all inference for flagged orgs |

## Inline completion routing

The VS Code extension sends inline completion requests with:

```http
x-use-case: code-completion-only
```

This routes through a dedicated completion path with stricter retention controls and faster models (e.g. Claude Haiku).

## BYOK (Bring Your Own Key)

Enterprise customers can supply their own LLM provider keys:

- Keys stored in `.env.backend` on your self-hosted API
- Inference routes through **your** provider accounts
- Your existing enterprise agreements with Anthropic/OpenAI apply

See [Enterprise deployment](/docs/enterprise-deployment).

## Supported providers

| Provider | Env variable |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` (Enterprise, requires `COOP_LLM_ALLOW_UNAPPROVED=true`) |

## Attestation

Enterprise plans include a zero-retention attestation document describing:

- Which code paths use zero-retention headers
- Provider retention policies referenced
- Data flow from extension → API → LLM provider

Contact [hello@coop-ai.dev](mailto:hello@coop-ai.dev) for attestation copies.

## Next steps

- [Security architecture](/docs/security-architecture)
- [API reference](/docs/api-reference)
