# Autocomplete production acceptance

Formal thresholds and rollout criteria for Coop AI inline autocomplete (Phase D).

## Acceptance thresholds

| Metric | Target | Source | Notes |
|--------|--------|--------|-------|
| **p50 latency** | **< 400 ms** | `completion.performance` (client) or `completion.requested` metadata `latencyMs` (server) | End-to-end ghost-text time, rolling window |
| **p95 latency** | **< 800 ms** | Same as above | Alert locally at 600 ms (`AutocompletePerformanceMonitor`) |
| **CAR** (completion acceptance rate) | **> 20%** | `completion.accepted` ÷ `completion.suggested` | **Suggested** = shown in editor, not server request |

### Event model

| Event | Emitter | Purpose |
|-------|---------|---------|
| `completion.requested` | Server (`inlineCompletionApi`) | LLM token billing + server-side latency |
| `completion.suggested` | Extension (`trackShownItem` → usage telemetry) | CAR denominator — ghost text actually displayed |
| `completion.accepted` | Extension (Tab accept) | CAR numerator |
| `completion.rejected` | Extension (Escape / superseded) | Quality signal |
| `completion.performance` | Extension (batched every 10 requests) | Client rolling p50/p95 snapshot |

CAR must use **shown** suggestions, not server requests. A request may return text that VS Code never displays (filtered, cancelled, or superseded).

## Validation

### Automated

```bash
npm run test:autocomplete
npm run test:inline-completion
npm run smoke:autocomplete:mock    # ephemeral API + mock LLM (no Docker)
npm run smoke:autocomplete         # live Docker API + Extension Dev Host checklist
npm run smoke:autocomplete:live    # live API only (same as smoke script step 1)
```

### Manual (Extension Development Host)

1. **File** — User/workspace settings: set `coopAI.autocomplete.enabled` to `true`.
2. **Extension UI** — Open a `.ts` file; type mid-statement and wait for ghost text.
3. **Success** — Status bar shows ready + latency; Tab accepts; admin **Completions** tab shows suggested/accepted counts.

### Admin portal

**Browser** → `https://admin.coop-ai.dev/analytics` → **Completions** tab:

- **Suggested** — client show events
- **Requested** — server inline calls
- **CAR** — accepted ÷ suggested
- **Server p50/p95** — from `completion.requested`
- **Client p50/p95** — from `completion.performance` batches

## Rollout ladder

Extension default remains **off** (`coopAI.autocomplete.enabled: false` in `package.json`) until thresholds are met in dogfood.

| Stage | Gate | Action |
|-------|------|--------|
| **0 — Opt-in** | Current | Default `false`; early adopters enable in settings |
| **1 — Org allowlist** | p50 < 400 ms, p95 < 800 ms, CAR > 20% for 7 days in internal dogfood | Document org IDs; optional server flag (below) |
| **2 — Org default on** | Same thresholds for 2 weeks across ≥ 3 orgs | Server returns `autocompleteDefaultOn: true` for allowlisted orgs; extension reads on activate |
| **3 — Global default on** | Stable CAR + latency for 30 days | Flip `package.json` default to `true` |

### Optional server feature flag (pattern)

Not required for Stage 0. When moving to Stage 2, add an org-scoped flag the extension can read from `/v1/me` or a features payload:

```env
# .env.backend — comma-separated org UUIDs that should default autocomplete on
COOP_AUTOCOMPLETE_DEFAULT_ON_ORGS=org-uuid-1,org-uuid-2
```

Server pseudocode:

```typescript
const allowlist = (env.COOP_AUTOCOMPLETE_DEFAULT_ON_ORGS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function autocompleteDefaultOnForOrg(orgId: string): boolean {
  return allowlist.includes(orgId);
}
```

Extension: on activate, if user has not set `coopAI.autocomplete.enabled` explicitly, apply server default when `autocompleteDefaultOn` is true. User/workspace setting always wins.

## References

- Provider: `src/autocomplete/coopAutocompleteProvider.ts`
- Server route: `src/api/inlineCompletionApi.ts`
- Performance batches: `src/autocomplete/performance.ts`
- Admin analytics: `src/server/adminAnalyticsApi.ts`
- Mock smoke: `scripts/autocomplete-smoke.mjs` (`npm run smoke:autocomplete:mock`)
- Live smoke: `scripts/autocomplete-smoke-live.mjs` + `scripts/smoke-autocomplete.sh` (`npm run smoke:autocomplete`)
