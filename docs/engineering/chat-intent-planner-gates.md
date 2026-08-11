# Chat Intent Planner gates

Each phase ships only when every gate in that phase passes. Phase gate tests use the
criteria in `src/chat/intentPlanner/gates.ts` as the canonical checklist.

## Phase 1 — plain-chat tool routing

| Gate | Pass | Fail |
| --- | --- | --- |
| P1-G1 | A named, connected tool is added to the fetch allowlist. | The named tool is omitted. |
| P1-G2 | A local code explanation plans no integrations. | The planner over-fetches an integration. |
| P1-G3 | Disconnected tools are removed from the plan. | A disconnected tool is fetched. |
| P1-G4 | Every integration fetcher honors `fetchIntegrations`. | An allowlisted provider is skipped. |
| P1-G5 | Multi-tool synthesis includes a section for every planned tool. | Any planned tool's evidence is absent. |
| P1-G6 | Two or more tools do not set the single-provider route. | Multi-tool chat is routed to one provider's synthesis. |

Run: `npx tsx src/chat/intentPlanner/phase1.gates.test.ts`

## Phase 2 — workflow promotion

| Gate | Pass | Fail |
| --- | --- | --- |
| P2-G1 | A high-confidence Blast ask with an open file runs silently. | It stays plain chat or asks for confirmation. |
| P2-G2 | A compound ask keeps both the workflow and named tools. | Either side of the compound plan is dropped. |
| P2-G3 | A medium-confidence workflow with no tools offers confirmation chips. | It runs silently or disappears. |
| P2-G4 | Model-plan parsing accepts workflow-plus-tools JSON. | Valid compound JSON is rejected or reduced. |
| P2-G5 | Silent execution resolves to the workflow path. | It resolves to plain chat or confirmation. |
| P2-G6 | Invalid model output fails open without forcing a workflow. | Invalid output triggers an action. |

## Phase 3 — trust UX

| Gate | Pass | Fail |
| --- | --- | --- |
| P3-G1 | Status text names the workflow and tools. | Planned work is hidden or mislabeled. |
| P3-G2 | Activity messages cover the workflow and each tool. | Any planned activity is missing. |
| P3-G3 | The trust preamble carries the status into synthesis context. | Synthesis lacks the plan disclosure. |
| P3-G4 | A `none` plan emits no status or activity. | Normal chat shows planner noise. |

Run: `npx tsx src/chat/intentPlanner/phase3.gates.test.ts`

## How to run all gates

```bash
npm run test:chat-intent
# or per phase:
npm run test:chat-intent:phase1
npm run test:chat-intent:phase2
npm run test:chat-intent:phase3
```

**Ship gate:** every phase script exits 0. A single FAIL in any phase blocks merge of that phase's behavior.

## Session wiring (all phases)

Plain `handleChatSend` runs the planner after slash parse:

| Decision | Behavior |
| --- | --- |
| `silent-workflow` | Re-enters with the quick action + `fetchIntegrations` (Phase 2) |
| `confirm-workflow` | Existing suggest chips (Phase 2) |
| `tools-only` | Sets `fetchIntegrations` (+ single `integrationProvider` when exactly one tool) (Phase 1) |
| Activity / preamble | Status line + tool checklist + `<coop_intent_plan>` (Phase 3) |

Slash commands and explicit `/jira`-style routes still win.
