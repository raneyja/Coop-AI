# Agent dogfood — production-readiness eval (wave PRB)

**Primary surface for Jon:** the Cursor canvas **[agent-dogfood](/Users/jonraney/.cursor/projects/Users-jonraney-Coop-AI/canvases/agent-dogfood.canvas.tsx)**.

This markdown is the backup / git copy. Prefer the canvas. Paste answers there, then **Ask chat to review**.

**Companions:** [agent-ship-loop-build-plan.md](./agent-ship-loop-build-plan.md), [agent-ship-loop-notes.md](./agent-ship-loop-notes.md).

---

## What this eval is

14 product features, **two completely different runs each** (different repo, different surface, different ask). You are one engineer on a **500-person** team — ticket pickup, review, blast, ship — not vibe coding.

**Ship claim:** zero Fail on required tests. Skip is allowed only when Slack/Jira is disconnected. One required Fail = not production-ready.

---

## Fixture map — do not mix

| Use-repo | What’s actually there | Run | Do not run |
|----------|----------------------|-----|------------|
| **plane** (indexed, not cloned) | Django `APIKeyAuthentication`, `StateGroup` in `apps/api/plane/db/models/state.py` | Locate, explain, Trace, Blast, /edit, autocomplete, Stop, Understand | Slack or Jira. **Never submit a PR to plane** (10a is typed-edit → Create a PR → **Cancel** only) |
| **raneyja/Coop-AI** | `requireAuth` in `src/server/authMiddleware.ts`. Slack `#epd` + Jira **COOP-101** (peel auth into coop-backend) | Hunt+Slack/Jira, slash integrations, Coop /edit, editor Create-PR, autocomplete TS | Zero-Clone proof — this folder is already open |

`requireAuth` is a Coop name. Slack and Jira seeds are Coop-only. Asking those on Plane is a bad test, not a product miss.

---

## Before you start

| Check | Detail |
|-------|--------|
| Fixture | Extension Development Host. Reload Window once. |
| Autocomplete | Settings → Preferences → Model & chat → enabled. Success = Autocomplete On. |
| Open folder | Coop-AI may be open — Plane answers must still come from plane |
| Slack / Jira | Connected for 12–13. Skip those rows if not. |

---

## The 28 tests (run from the canvas)

| ID | Feature | Surface | Repo | File |
|----|---------|---------|------|------|
| 1a | Explain open file | Plain chat | plane | `apps/api/plane/db/models/state.py` — one-screen briefing, ≤2 citations |
| 1b | Explain open file | Plain chat | Coop-AI | `src/server/authMiddleware.ts` — same length bar |
| 2a | Locate symbol | Plain chat, no file | plane | — |
| 2b | Locate symbol | Plain chat, no file | Coop-AI | — |
| 3a | Ticket pickup | Plain chat | plane | `apps/api/plane/utils/issue_relation_mapper.py` |
| 3b | Ticket pickup (COOP-101) | Plain chat, no file | Coop-AI | — |
| 4a | Understand Repo | Workflows | plane | — |
| 4b | Understand Repo | `/understand` | Coop-AI | — |
| 5a | Trace Decision | `/trace` | plane | `state.py` — select StateGroup |
| 5b | Trace Decision | Workflows | Coop-AI | `src/config/responseDeadline.ts` |
| 6a | Find Owner | Workflows | plane | `apps/api/plane/app/permissions/workspace.py` |
| 6b | Find Owner | `/owner` | Coop-AI | `authMiddleware.ts` — select requireAuth |
| 7a | Blast Radius | `/blast` | plane | `state.py` — StateGroup |
| 7b | Blast Radius | Workflows | Coop-AI | `responseDeadline.ts` |
| 8a | Knowledge Gaps | `/gaps` | plane | — |
| 8b | Knowledge Gaps | Workflows | Coop-AI | — |
| 9a | `/edit` | Slash | plane | `state.py` — select **get_queryset** |
| 9b | `/edit` | Slash | Coop-AI | `authMiddleware.ts` — requireAuth JSDoc |
| 10a | Create PR from editor | Type in file, then chat **Create a PR** → **Cancel** | plane | after a typed comment in `state.py` |
| 10b | Create PR from editor | Type in file, then chat **Create a PR** | Coop-AI | after a typed comment; branch `coop/dogfood-prb` |
| 11a | Autocomplete **line** | Type `def ` inside StateGroup | plane | `state.py` — blank line after TRIAGE |
| 11b | Autocomplete **block** | Type `export function demo() {` then Enter | Coop-AI | `authMiddleware.ts` — empty line inside braces |
| 12a | Slack | Plain chat hunt + Slack | Coop-AI | — |
| 12b | Slack | `/slack` only | Coop-AI | — |
| 13a | Jira | Plain chat hunt + Jira | Coop-AI | — |
| 13b | Jira | `/jira` only | Coop-AI | — |
| 14a | Stop | Mid-hunt | plane | — |
| 14b | Stop | Mid-`/understand` | Coop-AI | — |

Exact asks, Pass/Fail text, and paste boxes live in the canvas.

---

## Review bar (what chat will enforce)

- Invented path or wrong-repo bleed = Fail
- Generic essay with no clickable path on locate/explain/ticket = Fail
- Trace / Owner / Blast / Gaps / Understand must **not** enter the agent hunt loop
- `/slack` and `/jira` must **not** hunt the repo
- Jira 20-ticket dump instead of COOP-101 = Fail
- Stop that still posts a finished answer, or a timeout bubble = Fail
- `/edit` that duplicates the selected lines = Fail
- Skip is not Pass
- Wrong fixture (wrong repo/file/ask) = Invalid run / retest, not a product Pass
- Both ways of a feature must Pass or the feature Fails

---

## After dogfood

1. Paste Pass/Fail + the full Coop answer into each canvas card.
2. Click **Ask chat to review** on the canvas (opens a **new** Cursor chat). If nothing happens, stay in the current chat and type: `Review the production-readiness dogfood canvas`.
3. Close the Coop-AI dogfood PR from 10b when the eval is done. Never leave a plane PR open.
