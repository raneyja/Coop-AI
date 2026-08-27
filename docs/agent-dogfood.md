# ICP dogfood — staff engineer Monday

**Primary surface:** Cursor canvas **[ICP dogfood](/Users/jonraney/.cursor/projects/Users-jonraney-Coop-AI/canvases/enterprise-icp-dogfood.canvas.tsx)**.

This markdown is the backup / git copy. Prefer the canvas. Seven jobs. Fresh sheet — last round’s ship probes (locate / Apply / Stop) already Pass. Do not re-run those.

**ICP claim:** zero Fail on E1–E7. One required Fail = not ready for a staff engineer’s Monday.

Do **not** fail for: long-but-correct explain, extra Slack bot noise, citation count, slash vs Workflows, honest “history unavailable” on Trace.

---

## You are the ICP

Staff engineer, 200–2000 person product company. VS Code. Will not clone every service. Slack and Jira are how decisions survive. Plane = a service you don’t own. Coop-AI = your team’s repo.

## Do this first

1. Extension UI — Command Palette → Developer: Reload Window. Success = Coop sidebar comes back.
2. Sign-in still valid. Slack/Jira connected if you have them.
3. Run **E1** on plane, then **E7** (no new send). Then Coop-AI for **E2–E6**.

## The seven jobs

| ID | Job | Fixture | Pass |
|----|-----|---------|------|
| E1 | Onboard without cloning | plane, `/understand` | Real plane subsystems + 5 files. Not a generic template. |
| E7 | Wrong repo never | Score E1 | No Coop-AI paths on plane. |
| E2 | Cover the epic | Coop-AI, COOP-101 | `authMiddleware.ts` + COOP-101. No ticket dump. |
| E3 | Who do I ping? | `authMiddleware.ts`, `/owner` | Owner or CODEOWNERS path + escalation. |
| E4 | What else breaks? | same file, `/blast` | Real dependents (jobs / SAML). Not invented callers. |
| E5 | Why did we decide this? | `responseDeadline.ts`, `/trace` | 15s is soft gather, not abort. Honest “unavailable” is Pass. |
| E6 | Pre-ship blind spots | Coop-AI, `/gaps` | Real hunt-loop / Slack-Jira gaps for a 500-person org. |

Exact asks live on the canvas.

## After

Paste answers on the canvas, mark Completed, then **Ask chat to review**.
