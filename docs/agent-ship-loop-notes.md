# Agent ship loop — stage notes

**Required log** for [agent-ship-loop-build-plan.md](./agent-ship-loop-build-plan.md).  
A stage with no entry here is **FAIL**, even if tests are green.

Every Wave 1 and Join entry must also record **UX-G1..G12** (intent-first routing, no sticky agent thread, slash/Workflows still win, no new header control, same Use-repo, existing errors, one Patch card). `npm run test:chat-intent` belongs in the commands list.

## How to append (every stage)

Copy this block. Do not edit older entries except to fix a factual error.

```
### YYYY-MM-DD — Phase X Stage N — PASS | FAIL

- **Owner:** (chat / branch)
- **Commands run:** (exact, from repo root)
- **Gate IDs:** (e.g. A-G1 Pass, A-P4 Fail)
- **What we tried:** (1–4 bullets, including pressure cases)
- **What broke / what we skipped:**
- **What Jon re-runs:** (surface + success signal)
```

---

## Wave 1 — Phase A

### 2026-08-13 — Phase A Stages 0–4 — PASS (automated); manual dogfood still for Jon

- **Owner:** editor Wave 1 / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a` (green), `npm run test:agent-routing` (green), `npm run test:chat-intent` (green), `npm run lint` (green)
- **Gate IDs:** A-G0..G8 automated where practical; A-P1, A-P2, A-P3, A-P5, A-P6, A-P8, A-P9, A-P10, A-P12, A-P13; UX-G1/G2/G7/G8/G10
- **What we tried:** Planner-first loop; `auto` no longer fires on empty context; activity cap 3; `read_file` stays remote; invalid JSON fails open; repoId forced to Use-repo
- **What broke / what we skipped:** Live Extension Host dogfood (S3 / feel freeze) is for Jon after this lands. `auto` is conservative, not a full product “auto agent.”
- **What Jon re-runs:** Extension UI → Settings `coopAI.chat.agentMode` **on**; indexed remote Use-repo; ask where auth is enforced; then Trace, Stop, explain-this, Slack-named, thanks follow-up. Terminal: `npm run test:agent-ship:a && npm run test:chat-intent`

### 2026-08-13 — Hunt quality pass — PASS (automated)

- **Owner:** editor / `cursor/agent-ship-a-2e13`
- **Commands run:** `npm run test:agent-ship:a` (green), `npm run test:agent-routing` (green), `npm run test:chat-intent` (green)
- **Gate IDs:** hunt-Q1 short query; hunt-Q2 skip barrels; hunt-Q3 prefer api/middleware
- **What we tried:** Dogfood searched the whole sentence and read `apps/space/components/.../index.ts` barrels. Extract identifiers (`requireAuth`); rewrite LLM/deterministic `search_code` queries; rank hits so API/middleware beats frontend barrels.
- **What broke / what we skipped:** Live Extension Host retest is for Jon. Did not flip `agentMode` default on.
- **What Jon re-runs:** Reload Extension Development Host. VS Code Settings → `Coop AI › Chat: Agent Mode` = **on**. Use-repo **plane**. Ask: *Where is requireAuth or authentication middleware defined in this repo?* Success = activity shows a short search term (not the whole sentence); answer cites `apps/api/...` auth/middleware, not space component barrels. Agent **off** → today’s chat, no hunt steps.

---

## Wave 2 — Phase B

_No entries yet._

---

## Wave 2 — Phase C

_No entries yet._

---

## Wave 2 — Phase D

_No entries yet._

---

## Wave 2 — Phase E

_No entries yet._

---

## Wave 3 — Join

_No entries yet._

---

## Scorecard (Jon)

Fill after Wave 3. Copy results into the plan’s scorecard table as well.

| ID | Result | What I saw |
|----|--------|------------|
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | | |
| S7 | | |
| S8 | | |
| S9 | | |
| S10 | | |
| S11 | | |
| S12 | | |
| S13 | | |
| S14 | | |
