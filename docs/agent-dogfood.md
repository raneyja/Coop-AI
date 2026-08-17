# Agent dogfood — Extension Host checklist

**Primary surface for Jon:** the Cursor canvas **[agent-dogfood](/home/ubuntu/.cursor/projects/workspace/canvases/agent-dogfood.canvas.tsx)** (instructions + Pass/Fail + answer boxes).

This markdown is the backup / git copy. Prefer the canvas tomorrow.

**Companions:** [agent-ship-loop-build-plan.md](./agent-ship-loop-build-plan.md) (full S1–S15), [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) (log results).

---

## Before you start

| Check | Detail |
|-------|--------|
| Branch | `main` (includes always-on agent + allowlisted mid-loop tools) |
| Fixture | Extension Development Host |
| Use-repo | Deep-Indexed **GitHub** repo you do **not** have cloned |
| Open folder | Coop-AI may be open — answers must still come from Use-repo |
| Slack / Jira | Connected in Coop for the compound tests (skip those rows if not) |

**Terminal (once):** from repo root

```bash
npm run lint && npm run test:agent-ship && npm run test:agent-ship:pressure && npm run test:chat-intent
```

**Success:** all exit 0. Any red → stop; do not dogfood a red tree.

---

## Product laws (what “Pass” means now)

| Law | Expect |
|-----|--------|
| Agent is **on** | No Coop Settings toggle. Model & chat hub shows **Agent on**. |
| Locate / change | Repo hunts run the tool loop automatically. |
| Prefetch + mid-loop | Named Slack/Jira/… prefetch first; agent may call **only allowlisted** `search_jira` / `search_slack` / … mid-loop (max 3) when it finds a ticket key / topic. |
| Still out of the loop | Trace / Owner / Blast / Gaps / Understand, `/edit`, local “explain this”, Slack-only (no repo hunt), Thanks. |
| Kill switch | VS Code only: `coopAI.chat.agentMode: off` — not in Coop Settings. |
| NES | Still **default off**. |
| PR | Still an explicit **Create pull request** button after Apply. |

---

## Do this now (happy path)

### 1. Extension UI — Agent is on (no flip)

1. Coop Settings → Preferences → **Model & chat**.  
2. Confirm hub subtitle shows **Agent on**.  
3. Confirm there is **no** AgentMode checkbox.

**Success:** Agent on without you changing anything.

---

### 2. Extension UI — Locate hunt (always on)

1. Remote workspace → Use-repo = indexed GitHub repo (no local clone).  
2. Ask: *Where is requireAuth or authentication middleware defined in this repo?*

**Success:**
- Activity shows Searched / Read (compact, ≤3 visible steps).  
- Answer cites **real paths from that Use-repo**.  
- Not stuck on “Preparing answer.”  
- Not citing Coop-AI’s open folder.

---

### 3. Extension UI — Change → Apply → PR

1. Close every editor tab.  
2. Ask a concrete change on the Use-repo (or `/edit` two remote files).  
3. **Apply** the Patch card → **Undo** once.  
4. Apply again → quiet **Create pull request** → confirm modal.  
5. Repeat once with **Cancel** on the modal.

**Success:**
- Apply works without “open the file first.”  
- Undo restores.  
- Confirm → GitHub PR URL in the extension.  
- Cancel → nothing created on GitHub.  
- Dialog looks like existing Coop modals (not a new overlay).

---

### 4. Extension UI — Hunt + Slack / Jira (same turn)

**Requires connected Slack and/or Jira.**

1. Ask: *Where is requireAuth defined, and what did Slack say about the auth change?*  
2. Ask: *Where is requireAuth defined, and check Jira for related tickets?*

**Success:**
- Agent hunts the repo (Searched / Read).  
- Slack and/or Jira evidence appears on the **same** turn.  
- Optional: activity shows **Searched Slack/Jira for \`…\`** (mid-loop focused query after a key/topic shows up in code).  
- Slack-only ask (*What’s in Slack about this?*) still has **no** repo search/read stack.

---

### 5. Extension UI — Feel freeze (must still feel like Coop)

| Ask / action | Success |
|--------------|---------|
| *Explain this function* (local) | No agent tool-step list; Sources above answer if any |
| Trace Decision (Workflows) | Does **not** enter the agent loop |
| After a hunt: *Thanks* then *Explain this function* | No tool-step list (every turn re-plans) |
| `/edit` or a Workflows chip | Existing path, not the agent loop |
| Remote Use-repo with root `AGENTS.md` | Answer follows it; **no** new banner every turn |
| NES left **off** | Ghost text feels like today |

---

### 6. Pressure (same session)

| Action | Success |
|--------|---------|
| **Stop** mid-answer | Turn cancels; no latency timeout bubble |
| Use-repo ask while Coop-AI folder is open | Cites Use-repo, not Coop-AI disk |
| Start Create PR → Cancel | Nothing on GitHub |

---

## Scorecard (fill tomorrow)

| ID | Result | What you saw |
|----|--------|--------------|
| T1 Terminal green | | |
| T2 Agent on, no Settings toggle | | |
| T3 Locate hunt | | |
| T4 Apply + Undo | | |
| T5 Create PR confirm | | |
| T6 Create PR cancel | | |
| T7 Hunt + Slack | | |
| T8 Hunt + Jira (incl. mid-loop if it fires) | | |
| T9 Slack-only (no hunt chrome) | | |
| T10 Explain / Thanks / Trace feel freeze | | |
| T11 Zero-Clone (not Coop-AI disk) | | |
| T12 Remote AGENTS.md silent | | |
| T13 NES still default off | | |

**Ship claim:** all rows Pass. One Fail = do not demo as production.

---

## Only if blocked

| Blocker | What to do |
|---------|------------|
| Terminal red | Fix or stop; do not dogfood |
| No indexed remote Use-repo | Deep-Index a GitHub repo first |
| Slack/Jira not connected | Skip T7/T8; still run hunt-only rows |
| Need to kill agent | VS Code User settings → `coopAI.chat.agentMode`: `off` (not Coop Settings) |

---

## After dogfood

1. **File** — paste Pass/Fail into the table above (or into [agent-ship-loop-notes.md](./agent-ship-loop-notes.md)).  
2. Note any wrong citations, missing mid-loop, or chrome regressions with the exact ask you used.
