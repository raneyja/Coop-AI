# Agent → Apply → PR ship loop — editor build plan

**Updated:** 2026-08-17 — Agent is **always on** (no Settings toggle). Hunt-quality fixes + allowlisted mid-loop Slack/Jira. Dogfood → [agent-dogfood.md](./agent-dogfood.md). Do not follow the Wave 1 default-off / gather-bolt-on UX freeze below as current product law.

**Created:** 2026-08-13  
**Updated:** 2026-08-13 — Wave 1 = A only; Wave 2 = B + C + D + E in parallel; Wave 3 = join + production eval. **Historical UX freeze** (default-off, Settings toggle) is superseded by the 2026-08-16 always-on decision. Tools / Zero-Clone / Apply constraints in this doc still apply.  
**How to use this:** Build in **Cursor editor** (Composer / local Agent), not Cloud Agents.  
**Talk track (unchanged lead):** Enterprise readiness + deep stack context. Agent/PR is the *closer* — context becomes a reviewed change — not a Copilot-replacement pitch.

**Companions (do not contradict):**

| Doc | Role |
|-----|------|
| [**agent-dogfood.md**](./agent-dogfood.md) | Extension Host dogfood (always-on + mid-loop Slack/Jira) |
| [AGENTS.md](../AGENTS.md) § Boris bar | Ship quality bar |
| [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) | **Required** stage log (every stage writes here) |
| [codegen-cody-replacement-plan.md](./codegen-cody-replacement-plan.md) | Prior codegen phases 0–5 (**complete**); this plan continues at **5b** |
| [llm-prompt-architecture.md](./llm-prompt-architecture.md) § Agent loop | Always-on hunt conversation (not gather-then-synthesis) |
| [engineering/chat-intent-planner-gates.md](./engineering/chat-intent-planner-gates.md) | Pass/fail gate style to copy |
| [autocomplete-acceptance.md](./autocomplete-acceptance.md) | Rollout ladder + NES latency/CAR bar |
| [code-host-capability-matrix.md](./code-host-capability-matrix.md) | Write APIs must be host-honest |
| `.cursor/rules/zero-clone-remote-only.mdc` | Product law for read path |
| `.cursor/rules/response-latency.mdc` | Soft 15s gather for Q&A — **not** agent job budget |

---

## How this run works

```text
Wave 1 (serial)     A  ── includes former A0 as Stage 0 ──► A must Pass
                         │
Wave 2 (parallel)        ├── B  multi-file remote Apply
                         ├── C  GitHub PR handoff (APIs + confirm UI)
                         ├── D  remote AGENTS.md + visible memory
                         └── E  next-edit suggestions (opt-in)
                         │
Wave 3 (join)            └── J  wire B↔C, regression, YOUR eval scorecard
```

| Wave | What | Rule |
|------|------|------|
| **1** | Phase **A** only (foundation + LLM read-only tool loop) | Do not start B/C/D/E until every A gate is Pass |
| **2** | **B, C, D, E at the same time** | Four chats / four branches. One FAIL stops **that** track, not the others |
| **3** | Join + production eval | No customer-facing “ship loop” claim until Join gates Pass **and** you have run the scorecard below |

Former **A0 is not a separate phase.** It is **A Stage 0**. Same wave, same branch, must Pass before A writes the loop.

---

## Your test process (when we return)

This is the evaluation you run. Agents cannot mark a wave done without it. Every step names **where** (Terminal / Extension UI / Browser) and **success**.

**Fixture (all waves):** Extension Development Host. Use-repo = a **Deep-Indexed GitHub repo you do not have cloned**. Coop-AI may be the open VS Code folder — that must **not** be the answer source.

### After Wave 1 (Phase A) — you can ship-test the loop

**Do this now:**

1. **Terminal** — from repo root: `npm run lint && npm run test:agent-ship:a`  
   **Success:** both exit 0. Any FAIL = A is not done.

2. **Extension UI** — No Agent setting. Remote workspace → Use-repo = indexed GitHub repo, **no local clone**. Ask: *Where is auth middleware enforced and what calls it?*  
   **Success:** activity shows **≥2** search/read steps; answer cites **real paths from that repo**; you are not stuck on “Preparing answer.”

3. **Pressure (same session)**  
   - Run **Trace Decision** (Workflows menu). **Success:** it does **not** enter the agent tool loop.  
   - Click **Stop** mid-answer. **Success:** turn cancels; no latency timeout bubble.  
   - Ask a Use-repo question while Coop-AI is the open folder. **Success:** cites the Use-repo, not Coop-AI files.

4. **Feel freeze (same session)**  
   - Ask *Explain this function* (or any local explain). **Success:** Sources (if any) sit above the answer; **no** agent tool-step list.  
   - Ask *What’s in Slack about this?* (no repo hunt). **Success:** Slack is fetched if the planner named it; you do **not** get a stack of search/read rows.  
   - After a successful repo hunt, send **Thanks** then **Explain this function**. **Success:** neither follow-up shows a tool-step list (every turn re-plans).  
   - Run `/edit` or a Workflows chip. **Success:** existing edit/workflow path, not the agent loop.  
   - Settings has **no** Agent on/off — **nothing new** in the Workflows header.

5. **Terminal** — `npm run test:chat-intent`  
   **Success:** exits 0 (this week’s planner gates still hold).

6. **File** — open [agent-ship-loop-notes.md](./agent-ship-loop-notes.md).  
   **Success:** Wave 1 has dated notes for Stages 0–4 with Pass/Fail, including UX-G* .

If any of 1–6 fails, Wave 2 does not start.

### After Wave 2 + Wave 3 (B–E + join) — production-grade scorecard

Run **in this order**. One FAIL = that row is Fail; do not demo the full loop as production.

| # | Surface | What you do | Pass | Fail |
|---|---------|-------------|------|------|
| S1 | Terminal | `npm run lint && npm run test:agent-ship` | All green | Any red |
| S2 | Terminal | `npm run test:agent-ship:pressure` | All green | Any red |
| S3 | Extension UI | A dogfood (steps 2–4 above) still Pass | Loop still works | Wave 2 broke A |
| S4 | Extension UI | Close every editor. `/edit` a log line in file A **and** a caller in file B. Apply, then Undo | Both files open → diff → Apply → Undo restores | “Open it first” dead-end, or no undo |
| S5 | Extension UI | Same patches → **Create pull request** → confirm | GitHub PR URL in the extension; files match | Local-only diff, or PR without confirm |
| S6 | Extension UI | Start Create PR → **Cancel** | Nothing created on GitHub | Branch/PR exists after cancel |
| S7 | Extension UI | Plain chat on remote Use-repo that has `AGENTS.md` | Answer follows those instructions; not from a local clone | Instructions missing, or only work if cloned |
| S8 | Extension UI | Autocomplete: NES setting **off** (default). Type as usual | Ghost text still feels like today; no new NES | Default-on NES or slower ghost text |
| S9 | Extension UI | Turn NES **on**. Tab-accept once | A next-edit ghost appears at a predicted place | Nothing, or autocomplete CAR/latency tanked |
| S10 | File | [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) | Every Wave 2 track + Join has notes | Empty or “it compiled” |
| S11 | Terminal | `npm run test:chat-intent` | This week’s planner still green | Agent work undid named-tool / explain-only routing |
| S12 | Extension UI | Local explain. | No tool-step list; Sources still above the answer; empty chrome still skipped | Eight search/read rows on a normal ask |
| S13 | Extension UI | Create PR | Dialog is the existing Coop modal family; Patch card still Apply / Reject plus one quiet **Create pull request** | New overlay look, or a fat extra button row |
| S14 | Extension UI | Plain chat with remote AGENTS.md | Answer follows it; **no** new banner/chip every turn | Instructions advertised as chrome |

**Production-grade means:** S1–S14 all Pass, Boris B1–B6 Pass, **UX-G2..G6 Pass**, hunts always on (no Agent setting), NES default **off**, PR button still **explicit**.

---

## Current state (honest)

| Surface | Today | Gap this plan closes |
|---------|--------|----------------------|
| Chat / quick actions | Prefetch evidence → one LLM answer; structured cite/Sources | Keep as-is for Trace/Owner/Blast/Gaps |
| Intent planner (this week) | Named tools only; local explain = no tools; workflows stay workflows; `none` plan = no activity chrome | Agent loop **obeys** this plan — does not spray every tool |
| Agent (always on for hunts) | One model conversation: tools → same-conversation answer. No Settings toggle. `propose_patch` → Patch Apply card | Trace/Slack/Jira/`/edit` stay off this loop |
| `/edit` | SEARCH/REPLACE → Apply into open buffer / local disk | Multi-file apply on **remote Use-repo** without clone |
| Integrations | Parallel fetch before answer (~15s soft budget) | On-demand tool calls inside agent jobs |
| Indexed repos | Map + on-demand bodies; Zero-Clone reads (`read_file` already remote-only) | Index stays read map; **code host** becomes write target |
| Ship | No create-branch / commit / open-PR | Patch card → confirmed PR |
| Instructions | Local disk `AGENTS.md` / `.cursor/rules` | Always-on from **indexed remote** + light visible memory |
| Autocomplete | Ghost text + optional graph; no NES | Phase E opt-in, after Join |

**Do not rebuild:** Deep-Index, Zoekt/SCIP, live Slack/Jira/etc connectors, cite/edit/anonymous contract, quick-action report templates, Workflows header, Sources-above-answer, intent planner, Patch card Apply/Reject chrome.

---

## Product laws (every phase)

1. **Zero-Clone for intelligence** — agent `read_file` / search use `IndexedRepoWorkspace` / index only. Never “answer from the open Coop-AI folder” when Use-repo is remote.
2. **Index = read map; code host = write target** — do not invent a durable working tree in the index.
3. **Q&A ≠ agent job** — Trace / Owner / Understand Repo stay prefetch + soft 15s gather. Agent loop gets a **separate, visible** progress budget.
4. **Cite / edit / anonymous** — explaining repo code = citation fences; changes = patch blocks; never lang-fence dumps of repo code meant for Apply.
5. **Always on for hunts** — locate / understand / change run the Agent conversation with no user toggle. NES default **off**. PR handoff stays an explicit button.
6. **Fail open** — invalid tool JSON / tool errors → degrade to best answer or clear error; never hang “Preparing answer,” never silent wrong apply, never silent push.
7. **Boris bar** — wired hot path, graph-grounded when claimed, close the loop, tested, honest scope.
8. **Notes or it didn’t happen** — a stage with no log entry in `docs/agent-ship-loop-notes.md` is Fail.
9. **Chrome freeze** — this week’s look stays (Sources-on-top, Patch Apply/Reject, no new header toggle). Agent hunts are always on; they must not spray tools on Trace / Slack / local explain.

---

## UX freeze — intent first, chrome last

**Superseded 2026-08-16:** there is no user `agentMode` off/auto/on. Locate / understand / change always run the Agent conversation. The rows below that mention default-off / Settings toggle are **historical Wave 1 notes**, not current product law. Tools, Zero-Clone, Apply, Trace/Slack/`/edit` exclusion, and “don’t spray tools on every chat” still apply.

This week’s product already decides **why the user asked** before it fetches. The ship loop must use that, not replace it.

**Already true (must stay green: `npm run test:chat-intent`):**

| Planner decision | What happens today | What the agent loop may do |
|------------------|--------------------|----------------------------|
| Local explain / `none` / `plain` | No integrations; **no** activity chrome (P3-G4) | **Nothing.** No search/read loop, no tool-step rows |
| Named tool(s) (`tools-only`) | Prefetch **only** those tools | Still prefetch those tools. Agent does **not** add Slack/Jira/etc the model “felt like” calling |
| Workflow (Trace / Owner / Blast / Gaps / Understand) | Existing report path; Workflows menu | **Never** enter the LLM agent loop — even if `agentMode` is on |
| Repo investigation + `agentMode: on` | Deterministic search→read | LLM may loop **only** `search_code` / `read_file` / `list_directory` / `git_blame` |

**The sloppy failure we will not ship:** the model gets a bag of every integration + every repo tool and “figures it out,” then the UI prints eight tool-step rows on every reply.

### If we get sloppy → what it undoes → gate

| If we get sloppy | What it undoes | Gate | Pass | Fail |
|------------------|----------------|------|------|------|
| Agent loop on by default, or `auto` that’s too eager | This week’s plain-chat feel. Answers get slower and noisier. | **UX-G1** | Default `agentMode` remains **off**. `auto` does **not** start the loop for local explain, short asks, or “context bundle is empty.” | Default on; or `auto` fires because the bundle was empty / the user said “where” in a 20-character question |
| Eight tool-step rows on every reply | Sources-on-top, skip-empty-chrome | **UX-G2** | Loop runs only when the planner says this turn is a **repo hunt** and `agentMode` is **on**. Integrations stay on the planner allowlist. After the answer starts, activity **collapses** (≤3 visible steps, rest folded; not a permanent stack above Sources). | Every turn searches every tool; 8 rows sit above the answer on explain/Slack/Trace |
| New Confirm / Create PR overlay that doesn’t match existing dialogs | The Coop look | **UX-G3** | Confirm uses `coop-prompt-modal` (same family as Prompt Library). Escape and backdrop dismiss. | VS Code validation box, full-screen black overlay, raw `vscode-button-*` |
| Fat new button row on Patch cards | Apply / Reject surface | **UX-G4** | Same card. Apply / Reject unchanged. **One** quiet `coop-text-btn`: Create pull request (after Apply). | Extra primary row, duplicate Apply, or a second card chrome |
| Next-edit ghosts with no opt-in | “We’re not Copilot” in the editor | **UX-G5** | NES setting default **off**. No toast that turns it on. Base ghost text unchanged when off. | Default on, or a prompt to enable |
| Banner every turn for AGENTS.md / memory | Extra chrome you just removed | **UX-G6** | Instructions inject into the **system prompt only**. Memory is visible in Settings (or an equivalent place the user opens) — not a chat banner/chip every turn. | “Using AGENTS.md” strip, extra Sources chip, or activity row for instructions |

**`auto` in this program:** today’s `shouldUseAgentMode` treats “empty bundle” or a long “where/find/repo” string as enough. That is **too eager**. Wave 1 must tighten it: `auto` ⊆ repo-investigation **and** planner is not workflow **and** planner is not local-explain **and** never “because we lacked context.” Until that tightening has tests, treat `auto` as **off**.

**Activity chrome rules (UX-G2):**

1. No agent activity panel on planner `none` / `plain` / workflow turns.
2. While an opted-in repo hunt is running: compact steps, **cap 3 visible**, “N more” for the rest. Cap is UX, not an excuse to call 8 integration tools.
3. When the first answer token arrives: collapse to one line (or hide). Sources stay **above** the answer. Empty Sources still skipped.
4. Do not add a second working stack. Reuse `AgentActivityPanel`.

**Routing law (code):** Intent planner runs **before** `shouldUseAgentMode`. Agent repo tools are a second allowlist, not a replacement for `tools[]`. Phase A must add gate tests that a Slack-named ask does not execute `search_code` unless the user also asked a repo hunt.

Any **UX-G\*** FAIL fails the wave. Same as A-G\* / B-G\*.

### Operate inside the existing product (do not grow a second one)

The loop is a **capability inside Coop chat**, not a Cursor-style agent session sitting on top of Coop.

| Law | Why | Gate | Pass | Fail |
|-----|-----|------|------|------|
| **Every turn re-plans** | `agentMode: on` is a permission, not a sticky “this thread is now Agent.” A follow-up “thanks” or “explain that function” must go through the planner again. | **UX-G7** | Each send runs planner first; only repo-hunt turns loop | After one hunt, the rest of the thread keeps searching |
| **Slash, Workflows, and chips still win** | `/edit`, `/jira`, `/slack`, Trace from the Workflows menu, and this week’s suggest chips already own those turns. Incident-shaped asks stay on the incident path. Compound “blast + Slack” stays planner. | **UX-G8** | Those paths never enter the LLM tool loop, even with `agentMode` on | `/edit` or a chip or an incident ask becomes an agent job |
| **No new home in the chrome** | Workflows header and composer were just cleaned up. `agentMode` already lives in **Settings**. NES lives with **autocomplete** settings. No model picker (operators assign models). | **UX-G9** | Zero new header/composer toggles | “Agent” next to Workflows, or a new mode switch in the input |
| **Same question target as chat** | Use-repo (and collection, if that’s the session). Lightning/index already required for `search_code`. Don’t search Coop-AI disk, the whole org, or a repo the user isn’t in. | **UX-G10** | Hits match the active Use-repo/collection | Org-wide spray, wrong repo, or local Coop-AI paths |
| **Same error furniture** | Missing GitHub PR scopes, index off, reconnect-needed — use existing CoopNotice / Connect / reconnect patterns (this week’s Slack reconnect is the model). | **UX-G11** | Familiar error + where to fix it | A new “agent failed” page or silent 500 |
| **One apply surface, no todo product** | `/edit` and `propose_patch` both land on the **existing Patch card**. Activity reuses `AgentActivityPanel`; do not invent a Cursor-style persistent todo list. Restored threads must not replay an eight-step novel. | **UX-G12** | One Patch card; collapsed/no replay of tool rows in history | Second edit UI, sticky todos, or restored messages full of steps |

**Also do not:** add an Agent onboarding toast; put NES in the Workflows menu; treat Cmd+O / external uploads as the Use-repo; bypass integration **scope** (if the user scoped Slack/Jira, the agent does not search wider); change operator model assignment.

---

## Evidence rules (testing + notes)

A stage is not Pass because it compiled. Each stage must leave **three artifacts**:

| Artifact | Where | Required contents |
|----------|-------|-------------------|
| **Automated gates** | Named `*.gates.test.ts` + `npm run test:agent-ship:<phase>` | One test (or explicit manual-only tag) per gate ID |
| **Pressure tests** | Named `*.pressure.test.ts` + pressure script | Adversarial cases in that phase’s pressure table |
| **Notes** | [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) | Date, stage, commands, Pass/Fail, what broke, what you should re-run |

**Pressure test** = not the happy path. Wrong host, missing token, Stop, round cap, garbage JSON, Coop-AI folder open + remote Use-repo, huge file, GitLab honesty, Cancel, double-click.

**Stop rules**

| Event | What happens |
|-------|----------------|
| Any gate FAIL in A | Wave 1 stops. No Wave 2. |
| Any gate FAIL in B/C/D/E | That track stops. Other Wave 2 tracks continue. |
| Any Join gate FAIL | Do not demo ask → apply → PR as production. |
| Notes missing for a stage | Treat as FAIL even if tests are green. |
| Agent claims done without `npm run lint` | FAIL. |
| Any **UX-G1..G6** FAIL | That wave is not Pass. Do not “fix look later.” |

---

## Parallel ownership (Wave 2 — do not fight)

After A is merged to the integration branch, four tracks run **at once**. They share **contracts**, not files.

| Track | Owns (write freely) | Must not edit | Consumes |
|-------|---------------------|---------------|----------|
| **B** | `src/edit/*`, Patch card apply/reject/undo, `propose_patch` tool | GitHub write APIs, autocomplete, instruction loader | A’s agent registry + activity UI |
| **C** | Code-host **write** client, backend PR routes, confirm modal, audit | `patchApplier` internals, agent loop, autocomplete | **Patch session contract** (fixture until B lands) |
| **D** | `projectInstructionsLoader`, remote `IndexedRepoWorkspace.readFile` for AGENTS.md, visible memory | Agent loop, patch apply, NES | A’s session injection hook |
| **E** | `src/autocomplete/*` NES only | Agent, patch, PR, instructions | Existing autocomplete telemetry |

**Shared files — split or don’t touch:**

| File | Rule |
|------|------|
| `src/chat/CoopChatSession.ts` | A leaves a **small documented hook**. D uses it for instructions. B/C/E do **not** edit this file in Wave 2. |
| Patch card UI | B owns apply/undo chrome. C adds a **Create pull request** slot B already reserved (empty button OK until C). |
| `src/api/agent/AgentOrchestrator.ts` | A owns Wave 1. B adds `propose_patch` only via registry + types, minimal orchestrator diff. |
| `package.json` scripts | Each track adds **only** its `test:agent-ship:<letter>` lines. Join adds the aggregate scripts. |

**Honest parallel (what C and E can finish without B):**

| Track | Can Pass **solo** in Wave 2 | Wait for **Join** |
|-------|-----------------------------|-------------------|
| **C** | Write APIs, authz, audit, confirm/cancel, GitLab “not yet”, tests against a **fixture patch set** | Real button on a B apply session → live GitHub PR |
| **E** | NES opt-in, default off, unit tests, no disk walk, no p50/p95 blowup vs [autocomplete-acceptance.md](./autocomplete-acceptance.md) | Claim “close the loop” next to Apply/PR; dogfood after B apply-rate exists |

---

## Architecture target

```text
Intent planner (unchanged — this week)
  │
  ├─ workflow (Trace/Owner/Blast/…) ── existing report ──► structured answer
  ├─ named integrations ── prefetch those tools only (soft 15s) ──► one answer
  ├─ local explain / none ── no extra fetch, no activity chrome ──► one answer
  └─ repo hunt (locate / understand / change) — always
         │
         ▼
       LLM tool loop (same conversation) ──► search / read / list / blame
         │
         ▼
       stream the user-visible answer
         │
         ▼
       propose_patch (SEARCH/REPLACE) ──► Patch card (Apply / Reject)
         │
         └─ Create pull request (quiet) → coop-prompt-modal confirm → GitHub PR
```

---

## Phase map

| Phase | Name | Wave | Default after that wave |
|-------|------|------|-------------------------|
| **A** | Foundation + LLM tool loop (read-only) | 1 | `agentMode` still **off** / opt-in |
| **B** | `propose_patch` + multi-file remote apply | 2 | Edit/agent opt-in |
| **C** | Branch / PR handoff (GitHub first) | 2 | Explicit button; never silent |
| **D** | Always-on instructions + light memory | 2 | On for indexed Use-repo (capped) |
| **E** | NES / inline polish | 2 | Opt-in; default **off** |
| **J** | Join + production eval | 3 | Scorecard S1–S14 |

---

## Editor workflow

### Setup (once)

1. **Terminal** — `git checkout main && git pull` then `git checkout -b cursor/agent-ship-a-2e13` for Wave 1.
2. **Extension UI** — Run Extension Development Host against a **Deep-Indexed Use-repo you do not have cloned locally**.
3. Pin this file and [agent-ship-loop-notes.md](./agent-ship-loop-notes.md).

### Wave 1 chat

Paste the **Wave 1 prompt** only. Finish A Stages 0–4. Commit `phase A: …`. Merge. Then open **four** new chats for Wave 2.

### Wave 2 chats (parallel)

Each chat: one track, one branch (`cursor/agent-ship-b-2e13`, `-c-`, `-d-`, `-e-`). Paste that track’s prompt only. Do not implement another track “while you’re here.”

### Global paste preamble (prepend to every prompt)

```
You are building Coop AI in the Cursor editor (not a Cloud Agent).

Laws (non-negotiable):
- Zero-Clone: IndexedRepoWorkspace / codehost for repo intelligence reads. No workspaceFolders scans for gather/agent.
- Soft 15s gather applies to Q&A prefetch only. Agent jobs use a separate visible budget; never abort with a latency timeout bubble.
- Cite/edit/anonymous from CURSOR_STYLE_OUTPUT_CONTRACT — patches for edits, citations for existing repo code.
- Quick actions stay prefetch reports — do not force Trace/Owner through the agent tool loop.
- Intent planner wins: do not fetch tools the planner did not allowlist. Local explain and workflow turns never enter the LLM agent loop.
- UX freeze (UX-G1..G6): default agentMode off; auto is conservative; no 8-row tool lists on normal chat; Patch card stays Apply/Reject plus one quiet Create PR; confirm uses coop-prompt-modal; NES default off; AGENTS.md is silent (system prompt), not a banner.
- Opt-in only: do not flip coopAI.chat.agentMode or NES default to on.
- Follow file ownership in docs/agent-ship-loop-build-plan.md. Do not edit another track’s files.
- Every stage: automated gates + pressure tests + an entry in docs/agent-ship-loop-notes.md.
- Run npm run lint and npm run test:chat-intent before claiming done. Follow AGENTS.md Boris bar.
- Minimal diffs. No ChatPanel redesign. No drive-by refactors. Update this plan’s status tables when gates pass.
```

---

## Budgets (lock in A Stage 0, implement in A Stage 1)

| Mode | Budget | UX |
|------|--------|-----|
| Plain chat / quick actions | Soft gather ≤ `MAX_USER_FACING_RESPONSE_MS` (~15s) | Start answering; partial evidence OK |
| Agent job (`agentMode` **on**, repo hunt only) | Max **8** repo-tool rounds, **90s** wall, max **10** files read | Compact activity (≤3 visible); collapse when answering |
| Integrations | Planner allowlist only; **prefetch**, not agent “on-demand everything” | Named in activity only if the planner named them |

---

## Boris gate (all phases)

| # | Gate | Pass | Fail |
|---|------|------|------|
| B1 | Wired on hot path | You can exercise it in Extension Host without dead settings | Code exists but nothing calls it |
| B2 | Graph / index honest | Remote Use-repo answers from index/codehost | Local Coop-AI disk used as “repo” |
| B3 | Close the loop | Apply / PR / accept path works end-to-end (or honest “not this wave”) | Chat-only demo claimed as ship |
| B4 | Tested | Named gate + pressure tests + `npm run lint` green | “It compiled” |
| B5 | Honest scope | Docs/manual match behavior; deferred called deferred | Oversell vs Copilot Agent |
| B6 | Cost / safety | Caps, confirm on writes, fail open | Unbounded loops or silent push |

---

## Required scripts (agents add these; Join wires the aggregate)

After each track, these must exist and exit 0:

```bash
npm run lint
npm run test:chat-intent            # this week’s planner — must stay green every wave
npm run test:agent-routing          # must stay green after A
npm run test:patch                  # must stay green after B
npm run test:autocomplete           # must stay green after E
npm run test:project-instructions   # must stay green after D
npm run test:indexed-repo-workspace # Zero-Clone contract
npm run test:response-deadline      # Q&A 15s law

npm run test:agent-ship:a           # A gates + A pressure
npm run test:agent-ship:b
npm run test:agent-ship:c
npm run test:agent-ship:d
npm run test:agent-ship:e
npm run test:agent-ship             # all letter scripts
npm run test:agent-ship:pressure    # pressure-only aggregate
```

Until a track exists, its script must **not** be claimed green. Join adds `test:agent-ship` / `test:agent-ship:pressure`.

---

# Phase A — Foundation + LLM tool loop (read-only)

**Wave:** 1 (serial). **Goal:** Model chooses `search_code` / `read_file` / `list_directory` / `git_blame` iteratively; synthesizes one answer. **No writes.** Default still **off**.

### Key files

| Touch | Path |
|-------|------|
| Loop | `src/api/agent/AgentOrchestrator.ts` |
| Types | `src/api/agent/agentTypes.ts` |
| Tools | `src/api/agent/tools/*` (read-only; `read_file` already Zero-Clone) |
| Routing / mode | `src/chat/agentRouting.ts`, `src/config/agentModeConfig.ts` |
| Latency | `src/config/responseDeadline.ts` — comments + agent budget constants (do not hijack 15s gather) |
| Session | `CoopChatSession` — new loop **after** soft gather handoff; leave a **D injection hook** |
| Gates | `src/api/agent/gates.ts`, `phaseA.gates.test.ts`, `phaseA.pressure.test.ts` |

### Stages (all required)

| Stage | Name | You do not leave until |
|-------|------|------------------------|
| **A-0** | Foundation | Budgets written, docs honest, ownership map unchanged, gate ID constants exist |
| **A-1** | Build loop | Orchestrator parses tool calls, executes registry, caps, fail-open, activity wired |
| **A-2** | Gate tests | `test:agent-ship:a` covers A-G1..G6 as far as CI can |
| **A-3** | Pressure | A-P* table green + notes |
| **A-4** | Eval notes | Wave 1 notes complete; you can run “After Wave 1” above |

### Design constraints

- Keep deterministic prefetch as **fallback** when the model returns no tool calls or `agentMode: auto` says skip.
- Tool results cite `repoId:path:line` from index — no invented files.
- Cap rounds; on cap → synthesize with what you have.
- Quick actions: **do not** enter this loop.
- Fix stale honesty in `llm-prompt-architecture.md` if it still says `read_file` prefers a local clone (code already does not).

### Pass / Fail — A

| Gate | Pass | Fail |
|------|------|------|
| A-G0 | A-0 complete: budget split in this doc **and** named constants; docs say prefetch until A ships, then read-only loop; `CoopChatSession` conflict map matches Parallel ownership | Agent still only has the 15s gather; docs claim full agent/PR already ships |
| A-G1 | With `agentMode: on`, a multi-file question triggers **≥2 model-chosen** tool calls visible in activity | Still only deterministic search→read |
| A-G2 | Remote Use-repo (no local clone): `read_file` bodies from codehost/index | Reads workspace disk for Use-repo |
| A-G3 | Invalid tool JSON → fail open to answer or clear error; no hang | Infinite retry or frozen Preparing |
| A-G4 | Quick action Trace / Workflows path does **not** enter LLM tool loop | Trace runs agent loop |
| A-G5 | `phaseA.gates.test.ts` + `phaseA.pressure.test.ts` + `test:agent-routing` + `test:chat-intent` + `npm run lint` green | Untested loop or planner regression |
| A-G6 | Docs: 5b shipped for **read-only** loop; default still off | Default on or oversell “full agent” |
| A-G7 | **UX-G1, UX-G2** Pass: `auto` tightened (or treated as off); Slack-named ask does not run `search_code` unless also a repo hunt; local explain has **zero** tool-step rows | Empty-bundle auto; spray every tool; 8 rows on explain |
| A-G8 | Activity: ≤3 visible steps; collapses when the answer starts; Sources still above the answer | Permanent tool list above Sources |

### Pressure — A

| ID | Case | Pass | Fail |
|----|------|------|------|
| A-P1 | Garbage tool JSON mid-loop | Synthesizes or clear error | Hang / crash |
| A-P2 | Hit max 8 rounds | Stops and answers with partial evidence | 9th tool call |
| A-P3 | User Stop | Cancel; no 15s timeout bubble | Ignores Stop or shows latency timeout |
| A-P4 | Use-repo remote + Coop-AI folder open | Cites Use-repo only | Cites Coop-AI paths as the repo |
| A-P5 | `agentMode: off` | No LLM tool loop; no activity chrome | Loop still runs |
| A-P6 | Plain chat still starts within soft gather | Q&A not blocked by agent wall clock | Chat waits on 90s agent budget |
| A-P7 | `list_directory` / `git_blame` only when the model asks (or structure query fallback) | No extra writes, no extra tools | Unexpected tool or write |
| A-P8 | Local explain + `agentMode: on` | Planner keeps it plain; **no** search/read loop | Eight tool calls on “explain this” |
| A-P9 | Named Slack ask + `agentMode: on` | Slack prefetch only (if planned); no repo-tool spray | search_code/read_file fired because agentMode was on |
| A-P10 | `agentMode: auto` + empty context bundle | Loop does **not** start | Today’s eager auto still wins |
| A-P11 | `npm run test:chat-intent` | All P1–P3 gates still Pass | Named-tool / explain-only / none-plan chrome regresses |
| A-P12 | `agentMode: on`, then follow-up “thanks” / local explain | No loop (UX-G7) | Thread stays in agent mode after one hunt |
| A-P13 | `/edit` or Workflows chip with `agentMode: on` | Existing path (UX-G8) | Agent loop intercepts |
| A-P14 | Collection or Use-repo session | `search_code` stays on that target (UX-G10) | Searches the wrong repo / Coop-AI |

### Manual dogfood (Extension Host) — A

Same as **After Wave 1** steps 2–4 in [Your test process](#your-test-process-when-we-return).

### Copy-paste prompt — Wave 1 (A)

```
(Global preamble)

Wave 1 only — Phase A (A-0 through A-4). Do not start B/C/D/E.

A-0 Foundation:
- Read AgentOrchestrator, agentRouting, responseDeadline, patchTarget, projectInstructionsLoader,
  src/chat/intentPlanner/planChatIntent.ts, docs/engineering/chat-intent-planner-gates.md,
  docs/llm-prompt-architecture.md § Agent loop, docs/codegen-cody-replacement-plan.md Phase 5.
- Confirm budget table; add named agent-job constants (do not reuse MAX_USER_FACING_RESPONSE_MS).
- Align llm-prompt-architecture.md honesty (prefetch until this phase’s loop ships).
- Create src/api/agent/gates.ts with A/B/C/D/E/J **and UX-G1..G6** gate IDs as constants.
- Leave a documented instruction-injection hook in CoopChatSession for Phase D (silent system prompt only). Do not implement D.
- Tighten shouldUseAgentMode: auto must not fire on empty bundle or local explain. Until tests pass, auto ≡ off.

A-1 Build:
- Intent planner runs first. AgentOrchestrator.run() only when planner says repo hunt AND agentMode is on.
- Loop = stream/plan → parse tool calls → execute **repo** registry → synthesize.
- Tools: search_code, read_file, list_directory, git_blame only. No propose_patch. No Slack/Jira/etc in the agent registry.
- Named integrations stay on the planner prefetch path — do not re-fetch them as agent tools.
- Activity: reuse AgentActivityPanel; ≤3 visible rows; collapse when the answer starts. No ChatPanel redesign.

A-2 / A-3:
- phaseA.gates.test.ts (A-G* including A-G7/A-G8) and phaseA.pressure.test.ts (A-P* including A-P8..P11).
- package.json: test:agent-ship:a
- npm run lint + test:agent-routing + test:chat-intent + test:agent-ship:a green.

A-4:
- Update this plan’s status table. Append Wave 1 notes including UX-G1/UX-G2 evidence.
Stop. Boris + UX freeze in the PR description. Do not implement B/C/D/E.
```

### Status — A

| Stage | Status | Notes link |
|-------|--------|------------|
| A-0 Foundation | ✅ Wave 1 | budgets in `src/config/agentJobBudget.ts` |
| A-1 Build | ✅ Wave 1 | |
| A-2 Gates | ✅ Wave 1 | `npm run test:agent-ship:a` |
| A-3 Pressure | ✅ Wave 1 | |
| A-4 Eval notes | ✅ Wave 1 | [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) |
| A gates A-G0..G8 | ✅ automated; manual dogfood still required | |
| UX-G1, UX-G2 | ✅ routing + activity cap | |

---

# Phase B — propose_patch + multi-file remote apply

**Wave:** 2 (parallel). **Goal:** Agent and `/edit` change code on a Zero-Clone Use-repo: patches → Apply session that does not require files already open.

### Key files

| Touch | Path |
|-------|------|
| New tool | `src/api/agent/tools/proposePatch.ts` |
| Parser/UI | `src/edit/patchParser.ts`, `patchActions.ts`, `handlePatchComplete.ts`, Patch card |
| Target | `src/edit/patchTarget.ts` — **auto-open remote** via existing VFS before apply |
| Contract for C | Small `PatchSession` type + reserved **Create pull request** slot (disabled until C) |
| Gates | `src/edit/phaseB.gates.test.ts`, `phaseB.pressure.test.ts` |

### Stages

| Stage | Done when |
|-------|-----------|
| **B-0** | Research notes: current apply path, GitHub VFS vs GL/BB, PatchSession contract written |
| **B-1** | `propose_patch` + multi-file Apply + remote auto-open |
| **B-2** | Gate tests green |
| **B-3** | Pressure table green |
| **B-4** | Notes + your S4 dry-run written |

### Design constraints

- SEARCH/REPLACE only (`PATCH_OUTPUT_CONTRACT`). No silent disk writes for intelligence.
- One session, per-file / per-hunk accept + reject + undo.
- GitHub remote open works today; GitLab/Bitbucket: honest “open file or clone” — do not fake VFS.
- **UX-G4:** Do not add a new button row. Apply / Reject stay as they are. Reserve **one** quiet `coop-text-btn` slot for Create pull request (C fills it; disabled/hidden until C).
- Do not implement create PR (C owns that). No ChatPanel redesign.

### Pass / Fail — B

| Gate | Pass | Fail |
|------|------|------|
| B-G1 | `/edit` or agent `propose_patch` yields Patch card for **2+** files | Single-file only |
| B-G2 | Remote Use-repo, files **not** previously open: Apply succeeds after auto-open | “Open it in the editor” dead-end on GitHub remote |
| B-G3 | Reject / undo restores buffers | Partial apply with no undo |
| B-G4 | Citation fences never go through Apply; only patch blocks | Lang-fence Apply of repo dumps |
| B-G5 | `test:patch` + `test:agent-ship:b` + lint green | Parser-only change |
| B-G6 | Apply/reject telemetry still fires; baseline noted in notes | No way to see apply/reject |
| B-G7 | **UX-G4** Pass: Patch card still Apply / Reject (+ Undo). Reserved Create PR is `coop-text-btn`, not a new primary row | Fat new action row or second card family |

### Pressure — B

| ID | Case | Pass | Fail |
|----|------|------|------|
| B-P1 | Malformed SEARCH/REPLACE | Clear error; no partial silent write | Corrupt buffer |
| B-P2 | GitLab/Bitbucket Use-repo | Honest degrade, no fake VFS success | Fake GitHub-only success |
| B-P3 | Apply then Undo then Apply again | Second apply still correct | Undo stack broken |
| B-P4 | One file Apply, one Reject in same session | Independent outcomes | All-or-nothing wrong |
| B-P5 | 5-file cap (or documented max) | Cap + message | Unbounded patch set |
| B-P6 | Cite fence in the same answer as a patch | Only patch is Apply-able | Cite treated as patch |

### Manual dogfood — B

[Your test process](#your-test-process-when-we-return) row **S4**.

### Copy-paste prompt — Wave 2 B

```
(Global preamble)

Wave 2 track B only. Branch cursor/agent-ship-b-2e13. Do not implement C/D/E.

- Research apply path; write PatchSession contract + reserved Create PR slot (disabled).
- propose_patch (File: + SEARCH/REPLACE). Auto-open remote GitHub files before WorkspaceEdit.
- Honest error for hosts without VFS.
- UX-G4: keep Patch card Apply/Reject; one quiet coop-text-btn slot for Create PR (disabled). No new chrome family.
- phaseB.gates.test.ts + phaseB.pressure.test.ts. test:agent-ship:b. test:patch + lint + test:chat-intent.
- Notes in docs/agent-ship-loop-notes.md. Update plan status. Stop.
```

### Status — B

| Stage | Status |
|-------|--------|
| B-0..B-4 | ✅ Automated Pass 2026-08-13 (`cursor/agent-ship-b-2e13`); S4 dogfood still for Jon |
| B gates | ✅ B-G1..G7 + B-P1..P6 automated Pass; S4 pending Jon |

---

# Phase C — Branch / PR handoff

**Wave:** 2 (parallel). **Goal:** User confirms → create branch → commit via code-host API → open PR. GitHub first.

**Solo vs Join:** Wave 2 C Passes against a **fixture patch set**. Live “Apply then Create PR” is **J-G1**.

### Key files

| Touch | Path |
|-------|------|
| Code host | GitHub createRef / createCommit / createPull |
| Backend | Org-scoped authenticated routes + audit log |
| UI | Confirmation modal; Patch card **Create pull request** (fixture-capable until B merges) |
| Caps | Capability matrix honesty for GL/BB |

### Stages

| Stage | Done when |
|-------|-----------|
| **C-0** | Research notes: GitHub git data API, required scopes, audit event name |
| **C-1** | Write APIs + confirm/cancel UI + no silent push |
| **C-2** | Gate tests (incl. cancel creates nothing) |
| **C-3** | Pressure (perms, double-submit, GL honesty) |
| **C-4** | Notes + how you will run S5–S6 after Join |

### Design constraints

- **Never** silent push. Confirm branch name + title; show file list.
- Zero-Clone: API writes of file contents, not `git push` from a worker clone.
- PR body may include Sources / decision summary from the chat turn.
- Fail clearly if token lacks `contents` / `pull_requests`.
- **UX-G3:** Confirm is `coop-prompt-modal` (Prompt Library pattern). Escape + backdrop cancel. No VS Code validation overlay, no full-screen black sheet, no raw `vscode-button-*`.
- **UX-G4:** The trigger is the quiet Patch card text button, not a new header or composer control.

### Pass / Fail — C (solo)

| Gate | Pass | Fail |
|------|------|------|
| C-G1 | Confirmed action creates branch + commit + PR URL on GitHub **from fixture files** | Local-only, or requires B UI that does not exist yet |
| C-G2 | Cancel / dismiss creates **nothing** on the host | Branch created without confirm |
| C-G3 | Audit/telemetry event for PR handoff | No record |
| C-G4 | GL/BB: implemented **or** explicit “not yet” in UI | Fake success on GitLab Use-repo |
| C-G5 | Lint + API tests for write endpoints; no secrets in repo | Untested write path |
| C-G6 | **UX-G3** Pass: confirm dialog is Coop modal family; cancel via Escape/backdrop | Ugly/native overlay that doesn’t match Prompt Library |

Join adds **J-G1**: same flow from a **B apply session**.

### Pressure — C

| ID | Case | Pass | Fail |
|----|------|------|------|
| C-P1 | Missing `contents` or `pull_requests` | Clear permission error; nothing created | 500 / silent fail |
| C-P2 | Double-click confirm | One PR | Two PRs |
| C-P3 | Confirm then API 422 | Error shown; no half-branch claimed as success | Orphan branch billed as success |
| C-P4 | GitLab Use-repo | “Not yet” (unless implemented) | GitHub API called against GitLab |
| C-P5 | Empty file list | Blocked | Empty commit |

### Manual dogfood — C

Fixture path in Wave 2; **S5–S6** after Join.

### Copy-paste prompt — Wave 2 C

```
(Global preamble)

Wave 2 track C only. Branch cursor/agent-ship-c-2e13. Do not implement B/D/E.

- GitHub write methods + backend routes with authz + audit.
- Confirmation = coop-prompt-modal (UX-G3). Cancel/Escape/backdrop creates nothing.
- Create PR control = quiet coop-text-btn on the Patch card (UX-G4), not a new row.
- Drive Wave 2 tests from a fixture patch set (do not wait for B UI).
- Respect code-host-capability-matrix.md. No silent push. No local git required for Use-repo.
- phaseC.gates.test.ts + phaseC.pressure.test.ts. test:agent-ship:c. Lint + test:chat-intent.
- Notes + plan status. Stop. Do not build NES or memory.
```

### Status — C

| Stage | Status |
|-------|--------|
| C-0..C-4 | ☑ Done (Wave 2 C, fixture path) |
| C gates | ☑ Automated Pass — live Apply→PR is Join J-G1 |

---

# Phase D — Always-on instructions + light memory

**Wave:** 2 (parallel). **Goal:** Remote Use-repo gets AGENTS.md / team instructions every turn; optional persisted **visible** facts.

### Key files

| Touch | Path |
|-------|------|
| Instructions | `src/context/projectInstructionsLoader.ts` — fetch via `IndexedRepoWorkspace.readFile` when remote (today this is **local disk**) |
| Prompt library | `src/prompts/workspacePromptLibrary.ts` — always-on vs opt-in |
| Memory v1 | Repo-committed or small org table — **visible/clearable**; no fake Mem0 |
| Injection | Hook A left in `CoopChatSession` / `systemPrompts.ts` **only** |

### Stages

| Stage | Done when |
|-------|-----------|
| **D-0** | Research: current loader is local fs; list paths (AGENTS.md, agreed team files); token cap |
| **D-1** | Remote load + cap + cache + visible memory v1 |
| **D-2** | Gate tests |
| **D-3** | Pressure (huge file, missing file, wrong repo, latency) |
| **D-4** | Notes + S7 dry-run |

### Design constraints

- Short, capped (token budget). Overflow truncated with an **internal** note in the prompt (not a chat banner).
- Memory must be visible/editable **when the user opens Settings** (or equivalent). If you cannot cite where a fact came from, do not inject it.
- **UX-G6:** No per-turn banner, Sources chip, or activity row for AGENTS.md / memory.
- Does not replace live Slack/Jira fetch.
- Must not add 15s to every plain-chat turn — cache per repo/version; fetch inside remaining gather budget.

### Pass / Fail — D

| Gate | Pass | Fail |
|------|------|------|
| D-G1 | Remote Use-repo without local clone injects AGENTS.md when present at repo root | AGENTS only when locally cloned |
| D-G2 | Token cap enforced; overflow truncated in the prompt (not a chat banner) | Unbounded paste or a new banner |
| D-G3 | Memory facts user-visible / clearable **in Settings** (or equivalent), not as chat chrome | Hidden only, **or** a banner every turn |
| D-G4 | Plain chat still meets soft gather; instructions cached or inside budget | +15s every turn |
| D-G5 | `test:project-instructions` + `test:agent-ship:d` + lint | Docs-only |
| D-G6 | **UX-G6** Pass: no AGENTS.md/memory chip, banner, or activity row on ordinary turns | Extra chrome you just removed |

### Pressure — D

| ID | Case | Pass | Fail |
|----|------|------|------|
| D-P1 | No AGENTS.md | Chat works; no fake instructions | Hang or invented rules |
| D-P2 | Huge AGENTS.md | Truncate + note | Prompt blowup |
| D-P3 | Switch Use-repo | Old repo instructions gone | Leak across repos |
| D-P4 | Coop-AI folder has AGENTS.md, Use-repo is other | Injects **Use-repo** instructions | Injects Coop-AI’s AGENTS.md |
| D-P5 | Unsourced memory candidate | Not injected | Black-box fact |
| D-P6 | Ordinary plain chat with AGENTS.md present | No new banner/chip/activity row | Instructions advertised in the thread |

### Manual dogfood — D

**S7** in [Your test process](#your-test-process-when-we-return).

### Copy-paste prompt — Wave 2 D

```
(Global preamble)

Wave 2 track D only. Branch cursor/agent-ship-d-2e13.

- Load AGENTS.md (and agreed team paths) via IndexedRepoWorkspace for remote Use-repo.
- Use the CoopChatSession hook from A. Silent system-prompt injection only (UX-G6). Do not rewrite the agent loop.
- Cap tokens; cache per repo/version.
- v1 memory: visible in Settings with source; no black-box store unless it already exists; no chat banner.
- phaseD.gates.test.ts + phaseD.pressure.test.ts. test:agent-ship:d. Lint + test:chat-intent.
- Notes + plan status. Stop.
```

### Status — D

| Stage | Status |
|-------|--------|
| D-0..D-4 | ☑ Automated pass 2026-08-13 (`cursor/agent-ship-d-2e13`) |
| D gates | ☑ D-G1..G6 + D-P1..P6 automated; S7/S14 still for Jon |

---

# Phase E — NES / inline polish

**Wave:** 2 (parallel). **Goal:** Next-edit suggestions on existing autocomplete. Default **off**. Production claim waits for Join + B dogfood, but **E builds now**.

### Reuse

`src/autocomplete/*`, `inlineGraphContext.ts`, Hot Streak / Smart Throttle, accept telemetry. Thresholds: [autocomplete-acceptance.md](./autocomplete-acceptance.md) (p50 < 400ms, p95 < 800ms, CAR > 20%).

### Stages

| Stage | Done when |
|-------|-----------|
| **E-0** | Research notes: where Tab-accept is tracked; where a second ghost can attach; Zero-Clone context sources |
| **E-1** | NES opt-in setting, default off, predicted next location |
| **E-2** | Gate tests + `test:autocomplete` still green |
| **E-3** | Pressure (default off, latency, disk walk banned) |
| **E-4** | Notes + S8–S9 dry-run |

### Pass / Fail — E

| Gate | Pass | Fail |
|------|------|------|
| E-G1 | After Tab-accept, ghost next edit at a predicted location (**opt-in**) | Regresses base autocomplete CAR/latency |
| E-G2 | Meets or does not worsen autocomplete p50/p95 | Ship with p95 blowup |
| E-G3 | Default **off** (**UX-G5**) | Default on day one, or a toast that enables it |
| E-G4 | NES context from buffer + graph API, not disk walk | Disk walk |
| E-G5 | `test:autocomplete` + `test:agent-ship:e` + lint | Untested |
| E-G6 | With NES off, editor ghost text matches today’s feel (no extra Copilot-like persistence) | Off still shows next-edit ghosts |

### Pressure — E

| ID | Case | Pass | Fail |
|----|------|------|------|
| E-P1 | Setting off | Zero NES requests | NES still fires |
| E-P2 | Rapid typing / throttle | No request storm | p95 blowup |
| E-P3 | Remote Use-repo, no clone | Graph/API context only | Workspace walk of Coop-AI |
| E-P4 | Escape / reject NES | Counted; does not brick Tab | Completions stuck |

### Manual dogfood — E

**S8–S9** in [Your test process](#your-test-process-when-we-return).

### Copy-paste prompt — Wave 2 E

```
(Global preamble)

Wave 2 track E only. Branch cursor/agent-ship-e-2e13.
Next-edit suggestions opt-in on the autocomplete stack (UX-G5).
Do not change agent loop, patch apply, or PR.
Respect autocomplete-acceptance thresholds. Default off. No enable toast.
phaseE.gates.test.ts + phaseE.pressure.test.ts. test:agent-ship:e + test:autocomplete.
Notes + plan status. Stop.
```

### Status — E

| Stage | Status |
|-------|--------|
| E-0 | Done | [notes](./agent-ship-loop-notes.md#wave-2--phase-e) |
| E-1 | Done | Setting default off; predicted location after Tab-accept |
| E-2 | Done | `phaseE.gates.test.ts`; `test:autocomplete` still green |
| E-3 | Done | `phaseE.pressure.test.ts` |
| E-4 | Done | Notes + S8–S9 dry-run for Jon |
| E gates | Automated pass; S8–S9 for Jon |

---

# Wave 3 — Join + production eval

**Goal:** B session feeds C. A still works. D/E did not break chat or autocomplete. **UX freeze still Pass.** **You** run S1–S14.

### Pass / Fail — Join

| Gate | Pass | Fail |
|------|------|------|
| J-G1 | Applied B patches → Create PR → GitHub URL | C only works on fixtures |
| J-G2 | A dogfood still Pass (S3) | Wave 2 regressed the loop |
| J-G3 | `npm run test:agent-ship` and `test:agent-ship:pressure` green | Missing scripts or red |
| J-G4 | Quick actions still prefetch; soft 15s character unchanged | Trace/Owner feel like agent jobs |
| J-G5 | Notes complete for A–E + Join; scorecard filled below | “Looks good” with empty log |
| J-G6 | Defaults: `agentMode` off, NES off, PR still a button | Silent agent or silent push |
| J-G7 | **UX-G1..G12** all Pass on the merged tree; `npm run test:chat-intent` green | Planner, sticky-thread, or chrome regressions |
| J-G8 | S12–S14 Pass (explain has no tool list; PR modal matches Coop; no AGENTS.md banner) | This week’s feel is gone |

### Copy-paste prompt — Wave 3 Join

```
(Global preamble)

Wave 3 Join only. Do not add features.

- Merge B/C/D/E; fix conflicts using the ownership table.
- Wire PatchSession from B into C’s Create PR button.
- Add npm run test:agent-ship and test:agent-ship:pressure.
- Re-run A–E scripts + lint + test:agent-routing + test:chat-intent + test:patch + test:autocomplete + test:indexed-repo-workspace.
- Confirm UX-G1..G6 still Pass (no ChatPanel redesign, no new chrome families).
- Fill Join status + append notes. Print the S1–S14 scorecard for Jon to run.
Stop.
```

### Status — Join

| Item | Status |
|------|--------|
| J-G1..G8 | J-G1 wired 2026-08-13 (Apply → Create PR). J-G2..G8 + S1–S14 still Jon’s scorecard |
| Scorecard S1–S14 | ☐ Not started (Jon) |
| UX-G1..G6 | ☐ Confirm in Extension Host |

### Scorecard (you fill this when we return)

| ID | Result (Pass / Fail) | What you saw |
|----|----------------------|--------------|
| S1 lint + test:agent-ship | | |
| S2 pressure | | |
| S3 A still works | | |
| S4 multi-file remote Apply + Undo | | |
| S5 Create PR confirm | | |
| S6 Create PR cancel | | |
| S7 remote AGENTS.md | | |
| S8 NES default off | | |
| S9 NES opt-in | | |
| S10 notes complete | | |
| S11 test:chat-intent | | |
| S12 explain / agentMode off: no tool-step list | | |
| S13 Create PR modal + quiet button | | |
| S14 AGENTS.md silent (no banner) | | |

---

## Cost controls (ship with A/B)

| Control | Default |
|---------|---------|
| `agentMode` default | always on for hunts (no user setting) |
| Max tool rounds | 8 (`DEFAULT_MAX_STEPS`) |
| Agent wall clock | 90s (not the 15s Q&A gather) |
| Max files read per job | 10 |
| Max patch files per job | 5 |
| Integrations | Planner allowlist only (prefetch). Agent registry stays repo tools. |
| Metering | `usage_events`; tag `use_case=agent_loop` / `pr_handoff` |

---

## Talk track (do not change category)

| Stage | Lead | Closer |
|-------|------|--------|
| **Now** | Deep stack context + enterprise readiness | — |
| **After A+B** | Same lead | “…and turn that context into reviewed multi-file changes without cloning.” |
| **After C + Join** | Same lead | “…to a pull request your team can review.” |
| **After D** | Same lead | “…that remembers how your org works.” |

**Never lead with:** “We’re a Copilot / Cursor agent.”  
**Always lead with:** context across code + tools, Zero-Clone, evidence, governance — agent is proof context is actionable.

---

## Rollout ladder (agent features)

| Stage | Gate | Action |
|-------|------|--------|
| 0 | A+B Pass internally + you signed S1–S4 | Setting opt-in (`off` default) |
| 1 | Dogfood: apply success, no Zero-Clone violations, cost caps hold | Allowlist orgs |
| 2 | Stable for ≥2 weeks | Consider richer `auto` heuristics |
| 3 | Explicit product decision | Only then consider broader default |

PR handoff (C) stays an **explicit button** even if agent defaults expand.

---

## Definition of done (program)

- [ ] A Stages 0–4 Pass; Wave 1 notes complete; **UX-G1/UX-G2** Pass  
- [ ] B, C, D, E each: stages 0–4 Pass (C solo may use fixtures); **UX-G3..G6** Pass on the owning track  
- [ ] Join J-G1..G8 Pass  
- [ ] **You** ran S1–S14; all Pass  
- [ ] `npm run test:chat-intent` green on the merged tree  
- [ ] Remote-only demo: ask → **allowlisted** tools → multi-file apply → PR  
- [ ] Quick actions, Workflows, Sources-above-answer unchanged in look and latency  
- [ ] Docs honest; no Copilot-parity oversell  
- [ ] Cost caps + usage tagging live  

---

*Continues [codegen-cody-replacement-plan.md](./codegen-cody-replacement-plan.md) Phase 5 deferred work (5b). Wave 1 ships the read-only tool loop **on top of this week’s intent planner**; Wave 2 builds apply, PR, instructions, and NES in parallel without a ChatPanel redesign; Wave 3 is the production + UX-freeze eval you run.*
