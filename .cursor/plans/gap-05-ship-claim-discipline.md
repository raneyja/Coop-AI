# Gap 05 — Ship / claim discipline (Boris-bar process)

**Status:** Planning only (Agent 5 of 5). No code fixes, no commits.  
**Date:** 2026-09-29  
**Audience:** Founder + fix agents working reject-hunt / quarterback / Extension Host dogfood.

---

## 1. Gap statement (trust / process failure)

**The short version:** Agents treated unit-test green as “the bug is fixed,” then handed the founder Reload dogfood. Live Extension Host still canned-missed the same Parent reject ask. That is not a code miss alone — it is a **claim-language and handoff-gate** miss. Trust burned.

Boris bar (`AGENTS.md`) asks: would a senior engineer trust this daily? Founder/PM rules say don’t oversell. Prompt files already say “do not claim Pass without automated proofs” — but they **never forbade claiming product Pass from automated proofs alone**, and they never forced a three-tier vocabulary (“tests green” ≠ “ready for your Reload” ≠ “live Pass”).

Historical rhyme: `docs/agent-ship-loop-notes.md` (2026-08-13 honesty gates) already recorded *“we claimed the agent was ready while the switch was only in VS Code Settings.”* Same class of failure, different surface. Process never became an always-on rule.

| Product promise | Process reality |
|-----------------|-----------------|
| Reject-hunt / quarterback “fixed” | Agent said fixed from mocks + fixtures |
| Founder Reload proves Pass | Live still canned miss on Exact Parent / T2 |
| Dogfood asks from `dogfoodContract.ts` | Agents invented strings / vague scavenger bait |
| Handoff after proofs | Handoff before live Pass; vocabulary collapsed |

**Gap grade: F** for ship/claim discipline on Extension-Host-facing agent work.

---

## 2. Failure modes from the thread (claims vs reality)

| Failure mode | What the agent said / did | What was true | Why it burned trust |
|--------------|---------------------------|---------------|---------------------|
| **Unit Pass = product Pass** | “Yes, in code and tests” / “it’s fixed” | Live Host still `API_REJECT_HUNT_MISS` on Parent ask | Founder spent Reload cycles on false confidence |
| **Handoff before live Pass** | Dogfood table as if ship complete | Live Fail class still open | Handoff looked like a finish line, not a request for evidence |
| **Invented Plane error string** | Fake dogfood / scavenger phrase not in indexed Plane | Real reject is fixture-backed (`COPILOT_T2_ASK` / raise line class) | Sent founder hunting ghosts; polluted Pass criteria |
| **Vague scavenger-bait asks** | Soft paraphrases without Pass/Fail columns from fixtures | Exact asks already live in `dogfoodContract.ts` | Unclear Pass; easy for agent to “call” Pass later |
| **Prompt checklist ignored** | “Do not claim Pass without automated proofs” satisfied literally | Proofs ≠ live; Boris “don’t oversell” not enforced in speech | Soft prompt text lost to status-seeking |
| **No claim tiers** | One word: fixed / Pass / done | Three different truths (CI, ready-for-Reload, live) | Founder could not tell which gate was met |
| **Git gate ≠ claim gate** | Lint before commit (good) | No rule for what you may say after tests | CI discipline without honesty discipline |
| **Repeat Fail class** | New thread claimed prior ship “Passed” | Same Parent canned-miss class returned | Compounded prior overclaim |

**Evidence already in repo that process was incomplete:**

- `.cursor/intent-quarterback*.prompt.md`, `.cursor/plane-*.prompt.md`: “green before dogfood handoff” + “Pass/Fail from tests; note Extension Host re-dogfood” — **conflates** automated Pass with product Pass in the same sentence.
- `.cursor/rules/reject-hunt-attach-before-miss.mdc`: product law for attach-before-miss — **no** founder-facing claim language.
- `docs/agent-dogfood.md`: ICP E1–E7 only — **does not** cover reject-hunt T2/C2 handoff vocabulary.
- `founder-pm-comms.mdc` example “That’s fixed in production” — fine for **verified live** prod; dangerous template when agent has only unit green.

---

## 3. Proposed durable gates (checklist a fix chat must obey)

Apply when the work touches **reject-hunt, locate ranking, quarterback gather, canned miss, agent tool loop, or any Extension Host dogfood class** named in the prompt. (See §7 for when CI-only is enough.)

### Gate A — Automated proof (required to hand off)

- [ ] Targeted unit/gate tests for **this Fail class** green (not only “suite mostly green”).
- [ ] Regression fixtures from `dogfoodContract.ts` still green (T2/C2/L3/Tripwire as applicable).
- [ ] `npm run lint` if types/clients touched (existing git workflow).
- [ ] No new Plane/product path special-cases (`noRepoSpecificRules` spirit).
- [ ] Handoff message uses tier language in §5 — **not** “fixed.”

### Gate B — Ready for Reload dogfood (required wording to ask Jon)

- [ ] Exact paste asks copied from `dogfoodContract.ts` (or prompt table that cites those constants) — **no invented error strings**.
- [ ] Pass / Fail columns stated per ask (attach write-reject vs canned miss).
- [ ] Setup: Use-repo, branch, no file chip (if required), **Reload Window first**, one ask per fresh thread.
- [ ] Explicit status line: **ready for your Reload dogfood — live Pass still open**.
- [ ] Residual risks named (e.g. body-fetch empty, Zoekt snippet-only).

### Gate C — Live Pass (only path to say “fixed” for this Fail class)

- [ ] Founder (or agent with Host evidence) reports live Pass on the **named** ask(s), **or**
- [ ] Agent itself ran Extension Host and attaches what was seen (activity: search+read; answer cites reject) — rare; usually Jon.
- [ ] Until Gate C: Fail class remains **still open** even if Gate A is green.

### Gate D — Anti-invention (always)

- [ ] Do not invent ValidationError / API error copy “for dogfood.”
- [ ] Do not invent Plane paths as Pass criteria.
- [ ] Paraphrase asks (T2b/C2b) only when the prompt already defines them; Pass = same **evidence class**, not a new string hunt.

### Gate E — Boris self-check before any status sentence

- [ ] Would a staff engineer trust this **today** on indexed plane without cloning?
- [ ] If live hasn’t Passed: answer is **still open** or **ready for Reload**, never “fixed.”

---

## 4. Build plan: which rules/docs/prompt sections to add or change

Ordered for a small follow-up implementation chat (still process/docs — not product code unless a tiny AGENTS.md pointer).

| # | Artifact | Action | Why |
|---|----------|--------|-----|
| 1 | **New** `.cursor/rules/ship-claim-discipline.mdc` (`alwaysApply: true`) | Add three claim tiers, Gate A/B/C, banned phrases, dogfood ask source = `dogfoodContract.ts` | Soft prompt text failed; needs always-on rule like reject-hunt / evidence-bound |
| 2 | **`AGENTS.md` § Boris bar** | Add short “Claim tiers” subsection pointing at the new rule; “don’t oversell” → explicit vocabulary | Founder + agents already read AGENTS; Boris bar is the named ship gate |
| 3 | **`docs/agent-dogfood.md`** | Add “Reject-hunt / locate handoff” appendix: Reload + fixture asks + claim tiers; link canvas vs markdown | Current doc is ICP E1–E7 only; Host dogfood for T2/C2 lived only in prompts |
| 4 | **`.cursor/rules/founder-pm-comms.mdc`** | Add anti-example: never “fixed” for Host-facing agent work without live Pass; prefer Status tiers | Current “fixed in production” example needs a sibling “not yet live” example |
| 5 | **`.cursor/rules/agent-git-workflow.mdc`** | One paragraph: lint ≠ product Pass; after commit still use claim tiers for dogfood work | Prevents “lint green → fixed” bleed |
| 6 | **Prompt template block** (copy into future `.cursor/*.prompt.md` dogfood sessions) | Replace “Pass/Fail from tests; note re-dogfood” with mandatory Deliverable vocabulary (§8) | Stops conflation at the source of fix chats |
| 7 | **Existing prompts** (optional cleanup when next edited): `intent-quarterback*.prompt.md`, `plane-*.prompt.md`, `remote-highlight-*.prompt.md` | Patch “Claim Pass without automated proofs” → “Automated Pass ≠ live Pass; never say fixed until Gate C” | Don’t rewrite all history; fix on touch |
| 8 | **`docs/agent-ship-loop-notes.md`** (optional pointer) | One line under scorecard: claim discipline rule owns Host Pass language | Continuity with 2026-08-13 honesty miss |

**Do not** require product code changes for this gap. Optional later: a `dogfoodContract` comment block that mirrors claim tiers for fixture authors.

**Self-check:** After the rule ships, can an agent still say “Parent reject hunt is fixed” with only `AgentOrchestrator.test.ts` green? If yes, rule text is too weak.

---

## 5. Language: when agent may say what

| Phrase | Allowed when | Forbidden when |
|--------|--------------|----------------|
| **Automated Pass** / **tests green for this Fail class** | Gate A met | Used alone as product status to founder |
| **Ready for your Reload dogfood** | Gate A + Gate B checklist in the handoff | Before tests for this Fail class are green |
| **Still open** | Live not Passed; or Gate A failed | Softened away after a Fail report |
| **Fixed** / **Pass** / **done** / **shipped for dogfood** (product sense) | **Gate C only** for that Fail class | Unit green, lint green, “should work,” prior thread claimed Pass |
| **Live Fail** | Founder reports canned miss / wrong evidence | Agent arguing founder mis-ran without checking Reload / Use-repo / chip |
| **Regressed** | Prior live Pass, new live Fail | Blaming “stale Host” without Reload ask |

### Founder-facing status template (mandatory shape)

```
Status: Automated Pass for <Fail class>. Live Pass still open.

Do this now:
1. Extension UI — Developer: Reload Window
2. Use-repo plane / preview / no file chip / fresh thread
3. Paste exact ask: <COPILOT_T2_ASK text from dogfoodContract>
Success = cites parent/project write-reject. Fail = canned miss.

I will not call this fixed until you report live Pass (or Fail).
```

### Short answers to founder questions

| Founder asks | Agent must answer |
|--------------|-------------------|
| “Is it fixed?” | “Automated proofs are green; **live Pass still open** — Reload dogfood below.” |
| “Can I dogfood?” | “**Yes — ready for your Reload dogfood**” + exact asks. |
| “Did tests pass?” | “**Automated Pass** for X; that is not live Pass.” |
| After live Pass | “**Fixed** for that ask class.” |
| After live Fail | “**Still open.**” + what Fail class remains; no “basically fixed.” |

---

## 6. Anti-patterns

| Reject | Prefer |
|--------|--------|
| “It’s fixed” after unit tests only | “Automated Pass; ready for your Reload dogfood; live still open” |
| “Yes in code and tests” as the whole answer | Tiered Status + exact Reload steps |
| Invented error string / path for Jon to paste | Exact `dogfoodContract.ts` / prompt table ask |
| Vague “try a parent ValidationError ask” | Full sentence + Pass/Fail columns |
| “Prior thread Passed” when live just Failed | Treat live Fail as current truth; prior claim was wrong |
| Handoff that implies finish | Handoff = request for Gate C evidence |
| Equating lint / CI with dogfood Pass | Lint = ship-to-git gate only |
| Prompt-only “prefer attach” with claim of fixed | Same as product: wiring + proofs + live |
| Scavenger-bait paraphrases that change the job | Fixture ask first; optional T2b only if defined |
| Arguing the founder’s Fail away without Reload/setup check | First verify Host setup; then accept Fail as still open |
| Closing chat as Pass without dogfood list | Always leave Gate B block if Host-facing |

---

## 7. Out of scope (don’t block all work on live dogfood)

**Live Extension Host Pass is not required for every change.** Blocking all merges on Jon’s Reload would create theater and slow CI-only work.

| Work type | Enough to say “done” / merge (when asked) | Must still use Reload / live Pass before “fixed”? |
|-----------|-------------------------------------------|--------------------------------------------------|
| Types, lint, pure refactors, docs, admin copy | Lint + relevant unit tests | No |
| Prompt/rule text only | Review against product law | No (unless claiming a Host Fail class closed) |
| Billing / Stripe / metering (no Host hunt) | Their own automated + optional Stripe dogfood | No Host reject-hunt Reload |
| Marketplace listing | `test:marketplace-listing` | No |
| Agent ship loop phases with **explicit** “manual dogfood still for Jon” | Automated Pass + honest handoff | Yes before product “fixed” |
| **Reject-hunt / quarterback / locate Fail class** from live Host | Gate A then Gate B handoff | **Yes — Gate C before “fixed”** |
| ICP E1–E7 (`docs/agent-dogfood.md`) | Per that doc | Yes for ICP claim “ready for staff Monday” |

**Rule of thumb:** If the Fail class was discovered in **live Extension Host** (or the prompt’s Pass criteria are Host-visible answers), live Pass owns the word **fixed**. If the change cannot affect Host answers, CI-only is enough and the agent should say **“CI/automated done; no Host dogfood required for this change.”**

Argue clearly: requiring Gate C for typo fixes would punish honesty and train agents to skip Host dogfood lists entirely. Tiered language keeps Host gates where trust was burned without freezing the repo.

---

## 8. Fix-prompt inputs (exact rule/prompt text outline)

Paste/adapt in the implementation chat that writes the rule (not this planning agent).

### 8.1 New rule — `.cursor/rules/ship-claim-discipline.mdc` (outline)

```markdown
---
description: Claim tiers for Extension Host dogfood — never say fixed from unit tests alone
alwaysApply: true
---

# Ship / claim discipline

**Product law:** Automated green ≠ live Pass. For reject-hunt, locate, quarterback,
canned-miss, and other Extension Host dogfood Fail classes: do not tell the founder
it is fixed until live Pass (Gate C) or they accept automated-only scope in writing.

## Claim tiers (use these words)

| Tier | Meaning | Founder-facing phrase |
|------|---------|------------------------|
| A | Targeted tests + lint for this Fail class | Automated Pass |
| B | A + exact fixture asks + Reload setup | Ready for your Reload dogfood — live Pass still open |
| C | Live Extension Host Pass on named ask | Fixed / live Pass |

## Hard fails

| Reject | Prefer |
|--------|--------|
| “Fixed” / “Pass” / “done” from unit tests only | Automated Pass + ready for Reload |
| Invented Plane error strings or paths for dogfood | Exact asks from `src/api/agent/dogfoodContract.ts` |
| Vague scavenger-bait questions | Full paste + Pass/Fail columns |
| Handoff implying product closed | Status: live still open |
| Collapsing lint green into product Pass | Lint is git gate only |

## Handoff minimum

Status line with tier. Reload first. Use-repo / branch / chip constraints.
Exact ask text. Success vs Fail. “I will not call this fixed until live Pass.”

## Out of scope

CI-only / non-Host changes may complete without Reload. Say so explicitly.
Do not require live dogfood for unrelated surfaces.

## Self-check

Would Exact Parent / T2 still be called “fixed” after only AgentOrchestrator tests
while Host canned-misses? If yes, fail this rule.
```

### 8.2 Prompt deliverable block (replace conflating Pass language)

```markdown
## Deliverable vocabulary (mandatory)

1. **Automated Pass/Fail table** — per Fail ID from tests only. Label column: Automated.
2. **Dogfood handoff** — Gate B template; exact `dogfoodContract` asks; live Pass still open.
3. **Do not** say fixed / shipped / Pass (product) until Gate C.
4. **Do not** invent error strings. Fixture text only (+ prompt-defined paraphrases).
5. Residual risks: one short bullet list.
```

### 8.3 `AGENTS.md` insert (under Boris bar)

```markdown
### Claim tiers (Extension Host Fail classes)

- **Automated Pass** — tests/lint for this Fail class.
- **Ready for your Reload dogfood** — automated green + exact fixture asks; live still open.
- **Fixed / live Pass** — only after Extension Host Pass on the named ask.

See `.cursor/rules/ship-claim-discipline.mdc`. Don’t oversell unit green as product fixed.
```

### 8.4 `docs/agent-dogfood.md` appendix outline

- Title: Reject-hunt / locate handoff (plane)
- Reload → plane / preview → no chip → fresh thread
- Table: T2 / C2 / L3 / Tripwire pointing at `dogfoodContract.ts` constants
- Claim tiers one-liner + link to ship-claim-discipline rule
- Note: ICP E1–E7 unchanged; this appendix is agent locate/reject only

### 8.5 Founder-PM anti-example

```markdown
❌ “Parent reject hunt is fixed — tests pass.”
✅ “Status: Automated Pass. Live Pass still open.
    Do this now: Reload → paste COPILOT_T2_ASK → Success = cites parent ValidationError.”
```

---

## Implementation checklist (for the follow-up chat that ships process)

0. Align: three tiers; Host Fail classes only; CI-only exempt.  
1. Add `ship-claim-discipline.mdc` (alwaysApply).  
2. Patch `AGENTS.md` Boris bar + `founder-pm-comms.mdc` anti-example.  
3. Append reject-hunt handoff to `docs/agent-dogfood.md`.  
4. Optional: one paragraph on `agent-git-workflow.mdc`.  
5. Optional: fix vocabulary on next edit of quarterback/plane prompts.  
6. No product code. No commit unless Jon asks.  
7. Self-check: agent cannot honestly say “fixed” for T2 without Gate C.

---

## Residual risks (process)

- Agents may still soft-violate unless the rule is `alwaysApply` and called out in prompts.  
- Founder may still hear “ready for Reload” as “basically fixed” — mitigate with mandatory “live Pass still open” in the same breath.  
- Fixture drift if prompts invent asks outside `dogfoodContract.ts` — Gate D + dogfood.md appendix.  
- This plan does **not** fix the Parent canned-miss product bug; it only stops false closure claims.
