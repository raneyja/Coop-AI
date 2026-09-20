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

## Phase 2 — no silent workflow promotion

Plain English is plain chat. A slash / Workflows / grid `quickAction` is the only way onto Blast, Owner, Trace, Gaps, or Understand.

| Gate | Pass | Fail |
| --- | --- | --- |
| P2-G1 | Blast-shaped English with an open file stays plain chat (agent/tools allowed). | It silently runs Blast or asks “Want Blast Radius?” |
| P2-G2 | A compound impact + Jira ask stays tools-only with Jira on the allowlist. | It silent-runs Blast, or drops Jira. |
| P2-G3 | Repo-overview English does not open suggest-chips. | It confirms or silent-runs Understand Repo. |
| P2-G4 | Model-plan JSON may name tools; `workflow` on unconstrained chat is ignored. | Unconstrained JSON silently becomes Blast. |
| P2-G5 | `resolveChatIntentExecution` never returns silent-workflow or confirm-workflow. | Leftover silent plans re-enter a quick action. |
| P2-G6 | Invalid model output fails open without forcing a workflow. | Invalid output triggers an action. |

## Phase 3 — trust UX

| Gate | Pass | Fail |
| --- | --- | --- |
| P3-G1 | Status text names the workflow and tools. | Planned work is hidden or mislabeled. |
| P3-G2 | Activity messages cover the workflow and each tool. | Any planned activity is missing. |
| P3-G3 | The trust preamble carries the status into synthesis context. | Synthesis lacks the plan disclosure. |
| P3-G4 | A `none` plan emits no status or activity. | Normal chat shows planner noise. |

Run: `npx tsx src/chat/intentPlanner/phase3.gates.test.ts`

## Phase 4 — job list (locate ≠ decision)

| Gate | Pass | Fail |
| --- | --- | --- |
| P4-G1 | N5-class compound ask plans locate + decision jobs with distinct terms. | One favorite keyword to every tool, or a single job. |
| P4-G2 | Named Slack + Confluence both stay on the allowlist. | Either named tool is dropped. |
| P4-G3 | Topical "SQL-injection PR" does not fetch GitHub/GitLab/Bitbucket MRs. | Code-host PR/MR search runs unasked. |
| P4-G4 | Implied decision adds Slack+Jira and connected Teams/Confluence. | Slack-only fork, or siblings ignored. |
| P4-G5 | Empty Slack/Jira stay empty; writer must not invent a decision. | Fabricated "no decision existed." |
| P4-G6 | No jobs → fail open into today's search; locate-only still hunts. | Planner stall blocks the answer. |

Run: `npx tsx src/chat/intentPlanner/phase4.gates.test.ts`

Leading labels (`Pager:`, `On-call:`) are metadata, not search terms. Writer does not search tools — prefetch runs each job on today's index / Slack / Teams / Jira / docs / code-host fetchers, then one model writes. Soft 15s gather still applies; do not abort the turn.

## How to run all gates

```bash
npm run test:chat-intent
# or per phase:
npm run test:chat-intent:phase1
npm run test:chat-intent:phase2
npm run test:chat-intent:phase3
npm run test:chat-intent:phase4
# front door (slash is a constraint, not a bypass):
npx tsx src/chat/intentPlanner/frontDoor.gates.test.ts
```

**Ship gate:** every phase script exits 0. A single FAIL in any phase blocks merge of that phase's behavior.

## Session wiring (all phases)

`handleChatSend` interprets **before** it distributes. A slash command or Workflows
button is a **constraint** (Slack only, blast only) — not a bypass.

| Decision | Behavior |
| --- | --- |
| Slash `/slack` (with a topic) | Interpret focus → Slack-only decision job → existing Slack fetch with those terms |
| Slash `/blast` (optional focus) | Interpret focus for terms → existing blast engine |
| Unconstrained English | Never `silent-workflow` or `confirm-workflow`. Never set `quickAction` from a phrase or model. |
| `tools-only` | Sets `fetchIntegrations` only. Does **not** set `integrationProvider` (that is the slash single-route). |
| `jobs[]` | Per-job terms on existing gather; skip agent wander when decision/docs/code-host jobs exist |
| Activity / preamble | Status line + tool checklist + `<coop_intent_plan>`; may name tools being fetched. Must not say plain chat was routed to a workflow automatically. |

Re-entry sets `skipChatIntentPlanner` and passes `intentPlan`. Interpret once per turn.

## Phase 5 — job verb (search | latest)

The interpreter assigns **work**, not leftover words. `ChatIntentJob.verb` is `search` or `latest` on the shared job (every tool). Recency-only language with no real topic → `latest` and empty terms. A real topic (SQL-injection, a ticket key) → `search` with that topic. Bare `/slack` / `/jira` / `/docs` with no topic and not recency still uses repo fallback (`jobs: []`).

`latest` fetches newest-first **inside the org allowlist**. Empty enforced allowlist blocks. Unenforced/workspace-wide latest is refused (honest scope error), not a Settings lie.

Run: `npx tsx src/chat/intentPlanner/frontDoor.gates.test.ts`


Run front-door gates: `npx tsx src/chat/intentPlanner/frontDoor.gates.test.ts`
