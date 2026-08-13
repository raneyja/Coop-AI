# Agent → Apply → PR ship loop — editor build plan

**Created:** 2026-08-13  
**How to use this:** Build in **Cursor editor** (Composer / local Agent), not Cloud Agents. One phase per chat. Stop on any FAIL gate.  
**Talk track (unchanged lead):** Enterprise readiness + deep stack context. Agent/PR is the *closer* — context becomes a reviewed change — not a Copilot-replacement pitch.

**Companions (do not contradict):**

| Doc | Role |
|-----|------|
| [AGENTS.md](../AGENTS.md) § Boris bar | Ship quality bar |
| [codegen-cody-replacement-plan.md](./codegen-cody-replacement-plan.md) | Prior codegen phases 0–5 (**complete**); this plan continues at **5b** |
| [llm-prompt-architecture.md](./llm-prompt-architecture.md) § Agent loop | Deferred Phase 5b definition |
| [engineering/chat-intent-planner-gates.md](./engineering/chat-intent-planner-gates.md) | Pass/fail gate style to copy |
| [autocomplete-acceptance.md](./autocomplete-acceptance.md) | Rollout ladder pattern for defaults |
| [code-host-capability-matrix.md](./code-host-capability-matrix.md) | Write APIs must be host-honest |
| `.cursor/rules/zero-clone-remote-only.mdc` | Product law for read path |
| `.cursor/rules/response-latency.mdc` | Soft 15s gather for Q&A — **not** agent job budget |

---

## Current state (honest)

| Surface | Today | Gap this plan closes |
|---------|--------|----------------------|
| Chat / quick actions | Prefetch evidence → one LLM answer; structured cite/Sources | Keep as-is for Trace/Owner/Blast/Gaps |
| Agent mode (`coopAI.chat.agentMode`) | Deterministic `search` → `read` prefetch | **5b:** LLM chooses tools in a loop |
| `/edit` | SEARCH/REPLACE → Apply into open buffer / local disk | Multi-file apply on **remote Use-repo** without clone |
| Integrations | Parallel fetch before answer (~15s soft budget) | On-demand tool calls inside agent jobs |
| Indexed repos | Map + on-demand bodies; Zero-Clone reads | Index stays read map; **code host** becomes write target |
| Ship | No create-branch / commit / open-PR | Patch card → confirmed PR |
| Instructions | Local AGENTS.md / `.cursor/rules`; prompt library opt-in | Always-on from **indexed remote** + light memory |
| Autocomplete | Ghost text + optional graph; no NES | Phase D only after A–C trusted |

**Do not rebuild:** Deep-Index, Zoekt/SCIP, live Slack/Jira/etc connectors, cite/edit/anonymous contract, quick-action report templates.

---

## Product laws (every phase)

1. **Zero-Clone for intelligence** — agent `read_file` / search use `IndexedRepoWorkspace` / index only. Never “answer from the open Coop-AI folder” when Use-repo is remote.
2. **Index = read map; code host = write target** — do not invent a durable working tree in the index.
3. **Q&A ≠ agent job** — Trace / Owner / Understand Repo stay prefetch + soft 15s gather. Agent loop gets a **separate, visible** progress budget.
4. **Cite / edit / anonymous** — explaining repo code = citation fences; changes = patch blocks; never lang-fence dumps of repo code meant for Apply.
5. **Opt-in → dogfood → default** — same ladder as autocomplete. Default `agentMode` stays **off** until gates pass.
6. **Fail open** — invalid tool JSON / tool errors → degrade to best answer or clear error; never hang “Preparing answer,” never silent wrong apply.
7. **Boris bar** — wired hot path, graph-grounded when claimed, close the loop, tested, honest scope. See checklist per phase.

---

## How we historically pass / fail (apply the same here)

| Pattern | Pass looks like | Fail looks like (stop) |
|---------|-----------------|------------------------|
| **Cody plan phases** | End-to-end on hot path + `build:extension` + named tests | Orphan registry / docs claim ship before wire |
| **Intent planner gates** | Explicit P*-G* table; one FAIL blocks merge of that behavior | Partial JSON forces a workflow |
| **Autocomplete ladder** | Metrics + opt-in before default on | Flip default without dogfood |
| **Honest deferred** | Docs say “prefetch, not LLM tools” until true | Marketing “agent” oversell |

**Rule for this plan:** each phase has a **Pass / Fail** table. You do not start phase *N+1* until every gate in *N* is Pass and Boris review is Pass.

---

## Architecture target

```text
Q&A / quick actions (unchanged)
  Integrations + Index ── prefetch (soft 15s) ──► one structured answer

Agent / Edit job (new control loop)
  Optional soft prefetch
       │
       ▼
  LLM tool loop ──► search / read (index) + integration tools on demand
       │
       ▼
  propose_patch (SEARCH/REPLACE) ──► multi-file Apply session
       │
       ├─► open remote files → WorkspaceEdit (VS Code)
       └─► (Phase B) user confirm → code-host commit + PR
```

---

## Phase map

| Phase | Name | Depends on | Default after ship |
|-------|------|------------|--------------------|
| **A0** | Foundation audit + budgets + docs honesty | — | n/a |
| **A** | LLM tool loop (read-only) | A0 | `agentMode` still off / opt-in |
| **B** | `propose_patch` + multi-file remote apply | A | Edit/agent opt-in |
| **C** | Branch / PR handoff (GitHub first) | B | Explicit button; never silent |
| **D** | Always-on instructions + light memory | A (can parallel late B) | On for indexed Use-repo |
| **E** | NES / inline polish | B trusted + autocomplete gates | Opt-in first |

```text
A0 → A → B → C
         ↘
           D (after A; safe parallel with B if no file fights)
B dogfood green → E
```

---

## Editor workflow (how to build in Cursor today)

### Setup (once)

1. **Terminal** — `git checkout main && git pull` then `git checkout -b cursor/agent-ship-<phase>-2e13` (or continue one long-lived branch per phase).
2. **Extension UI** — Run Extension Development Host against a **Deep-Indexed Use-repo you do not have cloned locally** (Zero-Clone acceptance).
3. Open this file pinned: `docs/agent-ship-loop-build-plan.md`.

### Each phase chat (Composer / Agent in editor)

1. Paste the **Copy-paste prompt** for that phase only.  
2. Require: research → minimal diff → tests → `npm run lint` → Boris checklist.  
3. **Do not** ask the model to start the next phase in the same chat.  
4. When gates Pass: commit with message `phase <id>: …`, update the status table in this doc, then open a fresh chat for the next phase.

### Global paste preamble (prepend to every phase prompt)

```
You are building Coop AI in the Cursor editor (not a Cloud Agent).

Laws (non-negotiable):
- Zero-Clone: IndexedRepoWorkspace / codehost for repo intelligence reads. No workspaceFolders scans for gather/agent.
- Soft 15s gather applies to Q&A prefetch only. Agent jobs use a separate visible budget; never abort with a latency timeout bubble.
- Cite/edit/anonymous from CURSOR_STYLE_OUTPUT_CONTRACT — patches for edits, citations for existing repo code.
- Quick actions stay prefetch reports — do not force Trace/Owner through the agent tool loop.
- Opt-in only: do not flip coopAI.chat.agentMode default to on.
- Run npm run lint before claiming done. Follow AGENTS.md Boris bar.
- Minimal diffs. No drive-by refactors. Update this plan's status table when gates pass.
```

---

## Boris gate (all phases)

| # | Gate | Pass | Fail |
|---|------|------|------|
| B1 | Wired on hot path | User can exercise feature in Extension Host without dead settings | Code exists but nothing calls it |
| B2 | Graph / index honest | Remote Use-repo answers from index/codehost | Local Coop-AI disk used as “repo” |
| B3 | Close the loop | Apply / PR / accept path works end-to-end | Chat-only demo |
| B4 | Tested | Named unit/gate tests + `npm run lint` green | “It compiled” |
| B5 | Honest scope | Docs/manual match behavior; deferred called deferred | Oversell vs Copilot Agent |
| B6 | Cost / safety | Caps, confirm on writes, fail open | Unbounded loops or silent push |

---

# Phase A0 — Foundation audit

**Goal:** Lock budgets, settings, and doc truth before writing the loop. No product behavior change required beyond docs/config clarity.

### Research first

| Area | Key paths |
|------|-----------|
| Prefetch agent | `src/api/agent/AgentOrchestrator.ts`, `tools/registry.ts` |
| Routing | `src/chat/agentRouting.ts`, `src/config/agentModeConfig.ts` |
| Wire-in | `CoopChatSession.enrichWithAgentToolsIfEnabled` |
| Latency | `src/config/responseDeadline.ts` |
| Edit apply | `src/edit/patchTarget.ts`, `patchApplier.ts`, `handlePatchComplete.ts` |
| Instructions | `src/context/projectInstructionsLoader.ts` |

### Tasks

1. Document in this plan (or a short `docs/agent-loop-budgets.md`) the split: **gather soft budget** vs **agent job budget** (proposed defaults below).
2. Confirm `llm-prompt-architecture.md` Phase 5b still matches code (prefetch only).
3. List file conflicts between A/B/C so parallel work doesn’t thrash `CoopChatSession.ts`.
4. Add empty gate test file stub pattern (mirror `src/chat/intentPlanner/gates.ts`) for later phases: `src/api/agent/gates.ts` + `phaseA.gates.test.ts` (can be TODO asserts until A implements).

### Proposed budgets (product decision — set in A0)

| Mode | Budget | UX |
|------|--------|-----|
| Plain chat / quick actions | Soft gather ≤ `MAX_USER_FACING_RESPONSE_MS` (~15s) | Start answering; partial evidence OK |
| Agent job (`agentMode` on/auto) | e.g. max **8** tool rounds, **60–120s** wall, max **N** files read | Activity panel steps; never “Preparing answer” hang |
| Integration-on-demand (inside agent) | Count against agent budget, not Q&A soft gather | Named tool in activity |

### Pass / Fail — A0

| Gate | Pass | Fail |
|------|------|------|
| A0-G1 | Budget split written and referenced from `responseDeadline` / agent config comments | Agent still shares only the 15s gather with no documented escape |
| A0-G2 | Docs say agent is prefetch until A ships | Docs claim LLM tool loop already ships |
| A0-G3 | Conflict list for `CoopChatSession` / edit / agent owners agreed | Two phases editing the same functions blindly |

### Copy-paste prompt — A0

```
(Global preamble)

Phase A0 only — Foundation audit for docs/agent-ship-loop-build-plan.md.

1. Read AgentOrchestrator, agentRouting, responseDeadline, patchTarget, projectInstructionsLoader, docs/llm-prompt-architecture.md § Agent loop, docs/codegen-cody-replacement-plan.md Phase 5.
2. Write the budget split (Q&A vs agent job) into docs/agent-ship-loop-build-plan.md A0 section if missing; add brief code comments pointing at the constants you will add in Phase A (do not implement the LLM loop yet).
3. Align docs/llm-prompt-architecture.md honesty if drifted.
4. Create src/api/agent/gates.ts with Phase A gate IDs as documentation constants + a failing-or-skipped stub test file that will turn green in Phase A.
5. Stop. Report Pass/Fail for A0-G1..G3. Do not implement LLM tool calling.
```

### Status — A0

| Item | Status |
|------|--------|
| A0 gates | ☐ Not started |

---

# Phase A — LLM tool loop (read-only)

**Goal:** Model chooses `search_code` / `read_file` / `list_directory` / `git_blame` iteratively; synthesizes one answer. **No writes.**

### Key files

| Touch | Path |
|-------|------|
| Loop | `src/api/agent/AgentOrchestrator.ts` |
| Types | `src/api/agent/agentTypes.ts` |
| Tools | `src/api/agent/tools/*` |
| Model routing | `src/config/featureModelAssignments.ts` + chat use-case for agent |
| UI activity | existing `agent:activity` / AgentActivityPanel |
| Session | `CoopChatSession` — call new loop **after** soft gather handoff, not instead of first token forever |
| Gates | `src/api/agent/gates.ts`, `phaseA.gates.test.ts` |

### Design constraints

- Keep deterministic prefetch as fallback when model returns no tool calls or `agentMode: auto` heuristics say skip.
- Tool results must cite `repoId:path:line` / paths from index — no invented files.
- Cap rounds; on cap → synthesize with what you have.
- Quick actions: **do not** enter this loop.
- Cost: prefer cheaper model for tool-routing turns if router already supports it; final answer can use chat model.

### Pass / Fail — A

| Gate | Pass | Fail |
|------|------|------|
| A-G1 | With `agentMode: on`, a multi-file question triggers ≥2 model-chosen tool calls visible in activity | Still only deterministic search→read |
| A-G2 | Remote Use-repo (no local clone): `read_file` bodies come from codehost/index | Reads workspace disk for Use-repo |
| A-G3 | Tool JSON invalid → fail open to answer or clear error; no hang | Infinite retry or frozen Preparing |
| A-G4 | Quick action Trace does **not** enter LLM tool loop | Trace runs agent loop |
| A-G5 | Gate tests + `npm run lint` green; `test:agent-routing` still green | Untested loop |
| A-G6 | Docs: Phase 5b marked shipped for **read-only** loop; default still off | Default on or oversell “full agent” |

### Manual dogfood (Extension Host)

1. Settings → `coopAI.chat.agentMode`: **on**.  
2. Use-repo = indexed remote, **no** local clone.  
3. Ask: “Where is auth middleware enforced and what calls it?”  
4. **Success:** activity shows search/read steps; answer cites real paths; latency UX shows steps (not blank Preparing for minutes).

### Copy-paste prompt — A

```
(Global preamble)

Phase A only — LLM-chosen read-only tool loop (Phase 5b).

Implement AgentOrchestrator.run() as: stream/plan → parse tool calls → execute registry → loop → final synthesize.
Tools: search_code, read_file, list_directory, git_blame only. No propose_patch yet.
- Separate agent job budget from soft Q&A gather.
- Keep deterministic prefetch as fallback.
- Wire activity steps to existing UI.
- Add phaseA.gates.test.ts covering A-G1..G5 as automated as practical; document manual A dogfood in the plan status.
- Update docs/llm-prompt-architecture.md and this plan's status table.
Stop after Phase A. Boris checklist required in the PR description.
```

### Status — A

| Item | Status |
|------|--------|
| A gates | ☐ Not started |

---

# Phase B — propose_patch + multi-file remote apply

**Goal:** Agent (and `/edit`) can change code on a Zero-Clone Use-repo: patches → Apply session that doesn’t require files already open.

### Key files

| Touch | Path |
|-------|------|
| New tool | `src/api/agent/tools/proposePatch.ts` (name flexible) |
| Parser/UI | `src/edit/patchParser.ts`, `patchActions.ts`, `handlePatchComplete.ts`, Patch card |
| Target resolve | `src/edit/patchTarget.ts` — **auto-open remote** via existing VFS/remote explorer before apply |
| Session bridge | Agent result → same patch pipeline as `/edit` |

### Design constraints

- Patches remain SEARCH/REPLACE (`PATCH_OUTPUT_CONTRACT`). No silent disk writes for “intelligence.”
- Multi-file: one session, per-file / per-hunk accept+reject+undo (extend existing undo snapshots).
- GitHub remote open works today per capability matrix; GitLab/Bitbucket: honest degrade (“open file or clone”) — do not fake VFS.
- Agent may call integrations **on demand** only if Phase A activity model already supports extra tools; otherwise keep integration prefetch for edit asks that need Slack/Jira (don’t block B on full MCP).

### Pass / Fail — B

| Gate | Pass | Fail |
|------|------|------|
| B-G1 | `/edit` or agent `propose_patch` yields Patch card for 2+ files | Single-file only |
| B-G2 | Remote Use-repo, files **not** previously open: Apply succeeds after auto-open | “Open it in the editor” dead-end for GitHub remote |
| B-G3 | Reject / undo restores buffers | Partial apply with no undo |
| B-G4 | Citation fences never go through Apply; only patch blocks | Lang-fence Apply of repo dumps |
| B-G5 | `npm run test:patch` (or equiv) + lint green | Parser-only change |
| B-G6 | Dogfood apply-rate tracked (telemetry already exists) — note baseline | No way to see apply/reject |

### Manual dogfood

1. Remote Use-repo, close all editors.  
2. `/edit` add a log line in file A and update a caller in file B.  
3. **Success:** both open → diff → Apply → Undo works.

### Copy-paste prompt — B

```
(Global preamble)

Phase B only — propose_patch tool + multi-file apply for Zero-Clone.

- Add propose_patch (or reuse /edit synthesis) into the agent tool registry; output must be File: + patch SEARCH/REPLACE.
- Extend patchTarget/applier to auto-open remote GitHub files before WorkspaceEdit; honest error for hosts without VFS.
- One Apply session UX for multi-file (reuse Patch card family; no ChatPanel redesign).
- Gate tests B-G1..G5; run test:patch + lint.
- Do not implement create PR yet.
Update plan status. Stop.
```

### Status — B

| Item | Status |
|------|--------|
| B gates | ☐ Not started |

---

# Phase C — Branch / PR handoff

**Goal:** From an approved patch set: user confirms → create branch → commit file contents via code-host API → open PR. GitHub first.

### Key files

| Touch | Path |
|-------|------|
| Code host client | GitHub (then matrix) — **new** createRef / createCommit / createPull |
| Backend API | Org-scoped authenticated routes + audit log |
| Extension UI | Patch card / notification: **Create pull request** |
| Caps | Capability matrix honesty for GL/BB |

### Design constraints

- **Never** silent push. Confirm branch name + title; show file list.  
- Zero-Clone: commits are API writes of patch results, not `git push` from a worker clone (worker clone for index remains unrelated).  
- PR body may include Sources / decision summary from the chat turn (enterprise talk track).  
- Permissions: fail clearly if token lacks `contents`/`pull_requests`.

### Pass / Fail — C

| Gate | Pass | Fail |
|------|------|------|
| C-G1 | Confirmed action creates branch + commit + PR URL on GitHub | Local-only diff |
| C-G2 | Cancel / dismiss creates nothing on the host | Branch created without confirm |
| C-G3 | Audit/telemetry event for PR handoff | No record |
| C-G4 | Matrix: GL/BB either implemented or explicitly “not yet” in UI | Fake GitHub-only success on GitLab Use-repo |
| C-G5 | Lint + API tests for write endpoints; no secrets in repo | Untested write path |

### Manual dogfood

1. Apply or stage patches → **Create pull request** → confirm.  
2. **Success:** PR opens on GitHub with expected files; Extension shows link.

### Copy-paste prompt — C

```
(Global preamble)

Phase C only — GitHub branch/commit/PR handoff from approved patches.

- Add code-host write methods + backend routes with authz + audit.
- Extension: explicit Create pull request on patch session; confirmation modal.
- Respect code-host-capability-matrix.md (GitHub first; honest elsewhere).
- No silent push. No local git required for Use-repo.
- Tests for API + confirmation gating. Lint green.
Update plan status. Stop. Do not build NES or memory.
```

### Status — C

| Item | Status |
|------|--------|
| C gates | ☐ Not started |

---

# Phase D — Always-on instructions + light memory

**Goal:** Remote Use-repo gets AGENTS.md / team instructions every turn; optional persisted facts so enterprise context compounds.

### Key files

| Touch | Path |
|-------|------|
| Instructions | `src/context/projectInstructionsLoader.ts` — fetch via `IndexedRepoWorkspace.readFile` when remote |
| Prompt library | `src/prompts/workspacePromptLibrary.ts` — always-on vs opt-in distinction |
| Memory (v1) | Prefer **repo-committed** facts or small org table — avoid fake Mem0 scope creep |
| Injection | Chat system prompt assembly in `CoopChatSession` / `systemPrompts.ts` |

### Design constraints

- Always-on instructions are **short** and capped (token budget).  
- Memory must be **visible/editable** (enterprise trust) — e.g. `.coop/memory.md` or admin-visible facts — not a black box.  
- Wrong memory FAIL: if you can’t cite where a fact came from, don’t inject it.  
- Does not replace live Slack/Jira fetch; it reduces repeat pulls.

### Pass / Fail — D

| Gate | Pass | Fail |
|------|------|------|
| D-G1 | Remote Use-repo without local clone injects AGENTS.md when present at repo root | AGENTS only when locally cloned |
| D-G2 | Token cap enforced; overflow truncated with note | Unbounded paste |
| D-G3 | Memory facts user-visible / clearable | Hidden only |
| D-G4 | Plain chat still meets soft gather; instructions fetch inside budget or cached | +15s every turn |
| D-G5 | Lint + loader tests | Docs-only |

### Copy-paste prompt — D

```
(Global preamble)

Phase D only — always-on instructions from indexed remote + light visible memory.

- Load AGENTS.md (and agreed team instruction paths) via IndexedRepoWorkspace for remote Use-repo.
- Cap tokens; cache per repo/version.
- Optional v1 memory: persisted visible facts with source; no black-box embeddings store unless already exists.
- Tests for remote load + cap. Lint.
Update plan status. Stop.
```

### Status — D

| Item | Status |
|------|--------|
| D gates | ☐ Not started |

---

# Phase E — NES / inline polish

**Goal:** Next-edit suggestions on top of existing autocomplete — only after B dogfood is trusted.

### Reuse

`src/autocomplete/*`, `inlineGraphContext.ts`, Hot Streak / Smart Throttle, accept telemetry.

### Pass / Fail — E

| Gate | Pass | Fail |
|------|------|------|
| E-G1 | After Tab-accept, ghost next edit at a predicted location (opt-in setting) | Regresses base autocomplete CAR/latency |
| E-G2 | Meets or doesn’t worsen [autocomplete-acceptance.md](./autocomplete-acceptance.md) p50/p95 | Ship with p95 blowup |
| E-G3 | Default **off** until dogfood ladder | Default on day one |
| E-G4 | Zero-Clone: NES context from buffer + graph API, not disk walk | Disk walk |

### Copy-paste prompt — E

```
(Global preamble)

Phase E only — next-edit suggestions opt-in on autocomplete stack.
Do not change agent loop. Respect autocomplete-acceptance thresholds.
Default off. Tests + lint. Update plan status. Stop.
```

### Status — E

| Item | Status |
|------|--------|
| E gates | ☐ Not started |

---

## Cost controls (ship with A/B)

| Control | Default |
|---------|---------|
| `agentMode` default | `off` |
| Max tool rounds | 8 (align `DEFAULT_MAX_STEPS`) |
| Max files read per job | e.g. 10 |
| Max patch files per job | e.g. 5 |
| Integration-on-demand | Only when user ask or agent tool explicitly needs it |
| Metering | Reuse usage_events; tag `use_case=agent_loop` / `pr_handoff` |

Enterprise talk track: show customers they control agent spend; Q&A deep context remains the efficient path.

---

## Talk track (after phases — do not change category)

| Stage | Lead | Closer |
|-------|------|--------|
| **Now** | Deep stack context + enterprise readiness (index + integrations + decision workflows) | — |
| **After A+B** | Same lead | “…and turn that context into reviewed multi-file changes without cloning.” |
| **After C** | Same lead | “…to a pull request your team can review.” |
| **After D** | Same lead | “…that remembers how your org works.” |

**Never lead with:** “We’re a Copilot / Cursor agent.”  
**Always lead with:** context across code + tools, Zero-Clone, evidence, governance — agent is proof context is actionable.

---

## Suggested week-one order in the editor

| Session | Phase | Done when |
|---------|-------|-----------|
| 1 | A0 | A0-G* Pass; branch committed |
| 2–3 | A | A-G* Pass + remote dogfood |
| 4–5 | B | B-G* Pass + multi-file remote Apply |
| 6 | C | C-G* Pass on GitHub test repo |
| parallel | D | After A; D-G* Pass |
| later | E | Only if B apply-rate feels trustworthy |

---

## Rollout ladder (agent features)

Mirror autocomplete:

| Stage | Gate | Action |
|-------|------|--------|
| 0 | Phase A+B Pass internally | Setting opt-in (`off` default) |
| 1 | Dogfood: apply success, no Zero-Clone violations, cost caps hold | Allowlist orgs |
| 2 | Stable for ≥2 weeks | Consider `auto` heuristics richer |
| 3 | Explicit product decision | Only then consider broader default |

PR handoff (C) stays **explicit button** even if agent defaults expand.

---

## Definition of done (program)

- [ ] A–C gates Pass with Boris B1–B6 Pass  
- [ ] Remote-only Use-repo demo: ask → tools → multi-file apply → PR  
- [ ] Quick actions unchanged in latency character  
- [ ] Manual + docs honest; no Copilot-parity oversell  
- [ ] Cost caps + usage tagging live  
- [ ] This plan’s status tables updated  

---

*Continues [codegen-cody-replacement-plan.md](./codegen-cody-replacement-plan.md) Phase 5 deferred work (5b) into an enterprise ship loop without abandoning Zero-Clone or deep stack context as the product lead.*
