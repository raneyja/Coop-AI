# Agent dogfood — Extension Host checklist

**Primary surface for Jon:** the Cursor canvas **[agent-dogfood](/Users/jonraney/.cursor/projects/Users-jonraney-Coop-AI/canvases/agent-dogfood.canvas.tsx)**.

This markdown is the backup / git copy. Prefer the canvas.

**Companions:** [agent-ship-loop-build-plan.md](./agent-ship-loop-build-plan.md) (full S1–S15), [agent-ship-loop-notes.md](./agent-ship-loop-notes.md) (log results).

---

## Fixture map — do not mix

| Use-repo | What’s actually there | Run | Do not run |
|----------|----------------------|-----|------------|
| **plane** (indexed, not cloned) | Django `APIKeyAuthentication` in `apps/api/plane/api/middleware/api_authentication.py` | Locate, Stop, `/edit` | Slack or Jira — nothing is seeded for Plane |
| **raneyja/Coop-AI** | `requireAuth` in `src/server/authMiddleware.ts`. Slack `#epd` + Jira **COOP-101** (peel auth into coop-backend) | Hunt+Slack, Hunt+Jira, Slack-only | Zero-Clone proof — this folder is already open |

`requireAuth` is a Coop name. Slack and Jira seeds are Coop-only. Asking those on Plane is a bad test, not a product miss.

---

## Before you start

| Check | Detail |
|-------|--------|
| Branch | Combined test branch with always-on hunts, hunt-quality fixes, and allowlisted mid-loop tools |
| Fixture | Extension Development Host |
| Open folder | Coop-AI may be open — Plane answers must still come from plane |
| Slack / Jira | Connected for Block B only (skip those rows if not) |

**Terminal (once):** from repo root

```bash
npm run lint && npm run test:agent-ship && npm run test:agent-ship:pressure && npm run test:chat-intent
```

**Success:** all exit 0. Any red → stop; do not dogfood a red tree.

---

## Product laws (what “Pass” means now)

| Law | Expect |
|-----|--------|
| Agent is **on** | No Coop Settings toggle. Hunts run without you flipping anything. |
| Locate / change | Repo hunts run the tool loop automatically. |
| Prefetch + mid-loop | Named Slack/Jira/… prefetch first; agent may call **only allowlisted** `search_jira` / `search_slack` / … mid-loop (max 3) when it finds a ticket key / topic. |
| Still out of the loop | Trace / Owner / Blast / Gaps / Understand, `/edit`, local “explain this”, Slack-only (no repo hunt), Thanks. |
| NES | Still **default off**. |
| PR | Still an explicit **Create pull request** button after Apply. |

---

## Block A — plane (not cloned)

### 1. Extension UI — Locate a real Plane symbol

1. Remote workspace → Use-repo = **plane** (In use). Do not clone it.  
2. Close every editor tab.  
3. Ask: *Where is APIKeyAuthentication defined in this repo?*

**Success:**
- Activity shows Searched / Read.  
- Answer cites a real plane path such as `apps/api/plane/api/middleware/api_authentication.py`.  
- Jump-to-file lands on `APIKeyAuthentication`.  
- Not Coop-AI. Not live collab / Hocuspocus.

---

### 2. Extension UI — Stop mid-hunt

Same ask as test 1. Click **Stop** while Preparing answer or streaming.

**Success:** Turn cancels. Stopped. No latency timeout bubble.

---

### 3. Extension UI — `/edit` on a Plane file

1. Open `apps/api/plane/db/models/state.py` (or the file locate just cited).  
2. Select a function. Confirm the chat chip shows that file and line range.  
3. Ask: */edit add a one-line comment above the selected function.*

**Success:** Patch is on the open plane file. Comment sits above the selection. Original line is not pasted twice.

---

## Block B — Coop-AI (Slack / Jira seeded)

**Switch first:** Remote workspace → Use-repo = **raneyja/Coop-AI**. Success = In use.

### 4. Extension UI — Hunt + Slack (COOP-101)

**Requires Slack connected.**

Ask: *Where is requireAuth defined, and what did Slack say about COOP-101?*

**Success:**
- Hunt found `src/server/authMiddleware.ts` (real requireAuth).  
- Slack on the **same** turn mentions peeling auth into coop-backend / COOP-101.  
- **Open in Slack** opens the native message.

---

### 5. Extension UI — Hunt + Jira (COOP-101)

**Requires Jira connected.**

Ask: *Where is requireAuth defined, and check Jira for COOP-101?*

**Success:**
- Hunt found the real requireAuth file.  
- Jira shows **COOP-101** (extract auth / coop-backend) — not a 20-ticket dump.  
- **Open in Jira** works.

---

### 6. Extension UI — Slack-only (COOP-101)

Ask: *What's in Slack about COOP-101?*

**Success:** Slack fetch about COOP-101. **No** Searched / Read repo stack. Hits have Open in Slack.

---

## Scorecard

| ID | Result | What you saw |
|----|--------|--------------|
| S1 Locate APIKeyAuthentication on plane | | |
| S2 Stop on plane | | |
| S3 /edit on a plane file | | |
| S4 Hunt + Slack (Coop-AI, COOP-101) | | |
| S5 Hunt + Jira (Coop-AI, COOP-101) | | |
| S6 Slack-only (Coop-AI, COOP-101) | | |

**Ship claim:** all rows Pass (or Skip only if that tool is disconnected). One Fail = do not demo as production.

---

## Only if blocked

| Blocker | What to do |
|---------|------------|
| Terminal red | Fix or stop; do not dogfood |
| No indexed plane | Deep-Index plane first (Block A) |
| Slack/Jira not connected | Skip S4–S6; still run Block A |

---

## After dogfood

1. Paste Pass/Fail into the canvas (preferred) or the table above.  
2. Note wrong citations or missing Open in Slack/Jira with the exact ask you used.
