# Ship probes — production-readiness eval

**Primary surface:** Cursor canvas **[agent-ship-probes](/Users/jonraney/.cursor/projects/Users-jonraney-Coop-AI/canvases/agent-ship-probes.canvas.tsx)**.

This markdown is the backup / git copy. Prefer the canvas. Six jobs, not 28 cards.

**Ship claim:** zero Fail on required probes (S1–S4, S6). S5 may Skip if Slack/Jira is disconnected. One required Fail = not production-ready.

Do **not** fail ship for: long-but-correct explain, extra Slack bot noise, citation count, slash vs Workflows.

---

## Before you start

1. Extension UI — Extension Development Host. Command Palette → Developer: Reload Window. Success = Coop sidebar comes back.
2. Sign-in still valid.
3. Run **S1** and **S3** first (the two bugs that used to fail every wave).

## The six probes

| ID | Job | Fixture | Pass |
|----|-----|---------|------|
| S1 | Find it | plane, no file | Class body loads. Cite is not copyright line 1. |
| S2 | Start the ticket | Coop-AI, COOP-101 | `authMiddleware.ts` + COOP-101. No 20-ticket dump. |
| S3 | Apply is safe | plane `state.py`, click inside `get_queryset` | One comment above the function. No duplicate lines. |
| S4 | Wrong repo never | Score S1 | No Coop-AI paths on plane. |
| S5 | Slack/Jira ride along | Coop-AI | File + COOP-101. Skip if disconnected. |
| S6 | Stop means stop | one hunt, one `/understand` | Cancels. No finished essay. |

Exact asks live on the canvas.

## After

Paste answers on the canvas, mark Completed, then **Ask chat to review**.
