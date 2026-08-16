# Agent rebuild roadmap (Boris bar)

**Status:** P0 in progress (2026-08-14).  
**Companion:** landscape diagnosis in chat; ship gates in `docs/agent-ship-loop-build-plan.md`.

## Rule

| User promise | Owner |
|---|---|
| Structured Workflow / org evidence (Trace, Owner, Blast, Gaps, inventory) | Programmed prefetch + synthesis |
| Find / understand / change repo code | Agent-owned tools + Apply |
| Ghost text while typing | Autocomplete (not chat agent) |

Prefetch is not the enemy. **Bolted** agent-inside-gather without clear ownership is.

## P0 — Trust (this wave)

| ID | Work | Done when |
|---|---|---|
| P0.1 | Unify change: no open file → agent hunt→patch (not hard error) | `resolveChangeSendRouting` + session wiring |
| P0.2 | Edit-tier model on agent change + hunt synthesis | `turnAgentAction` drives `code_edit` / edit assignment |
| P0.3 | Fail loud on empty/broken hunts | Honest `skipNote` in bundle; no silent catch |
| P0.4 | Agent hunts use `AGENT_JOB_WALL_MS` (not the 15s Q&A gather) | `agentJobBudget.ts` |
| P0.5 | No user Agent on/off; comments match always-on hunts | Settings + routing + docs |

## P1 — One coding loop

- Agent owns locate/understand/change turns (one conversation: tools then the streamed answer)
- No user Agent on/off; routing decides when it runs
- Shared Apply stack for `/edit` and agent patches
- Multi-hop understand; wrong first hit must read again before answering
- Live GitHub Apply→PR dogfood

## P2 — Craft

- Carve agent + edit out of `CoopChatSession`
- Honest autocomplete / NES claims
- Optional on-demand integration tools inside agent jobs

## Do not

- Replace Trace/Owner/Blast with a free-form agent
- Grow `CoopChatSession` further when a helper module will do
