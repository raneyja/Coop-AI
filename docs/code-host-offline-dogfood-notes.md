# Code host offline dogfood notes

**Purpose of this round:** Confirm connections / evidence paths still work when the code host is under stress or offline.  
**Not this round:** Fix answer quality. Capture gaps here for a later improvement pass.

---

## GitLab

**Host under test:** GitLab (`coopai-group/Coop-AI`, branch `main`)  
**Date:** 2026-09-28

### Connection check

| Quick action | Connected? | What we saw |
|--------------|------------|-------------|
| Trace Decision | Yes | GitLab commit source (`a40e353`), medium evidence |
| Find Owner | Yes | GitLab commits & reviews + Slack presence |
| Understand Repo | Yes | Manifest + anchor files from GitLab |
| Blast Radius | Partial | Sources card rendered; graph returned 0 dependents / engine unavailable |
| Knowledge Gaps | Partial | Ran end-to-end; ownership signals present; docs path polluted (see quality) |

**Connection verdict:** Trace, Owner, and Understand proved GitLab evidence still attaches. Blast and Gaps still *run*; Blast’s graph path did not return usable dependents.

---

## Bitbucket

**Host under test:** Bitbucket (`coop-ai/documenso`, branch `main`)  
**Date:** 2026-09-28

### Connection check

| Quick action | Connected? | What we saw |
|--------------|------------|-------------|
| Understand Repo | Yes | Repository overview sources; monorepo answer from inventory + anchors |
| Find Owner | Yes | Bitbucket commits & reviews; orphaned / unknown author for `render.yaml` |
| Blast Radius | Partial | Bitbucket sources + dependency graph; 0 code dependents / engine unavailable |
| Knowledge Gaps | Yes | Bitbucket gap scan (3) + ownership (0) + deps (0); honest orphaned + docs gaps |
| Trace Decision | Yes | Bitbucket commit `cb77a40` (Mythie, 2023-04-13); decision status active |

**Connection verdict:** Understand, Owner, Gaps, and Trace proved Bitbucket evidence attaches. Blast still *runs* with Bitbucket sources; graph returned 0 dependents (same pattern as GitLab).

---

## Quality gaps (backlog — fix after dogfood)

Do **not** block the connection pass on these. Track for a post-dogfood quality pass.

**Status (2026-09-28 quality pass):** Evidence-bound answers law + Blast replace-essay finish gate + Understand thin-anchor mode + L fileAssistant system contract shipped. Re-dogfood Blast / Understand / L “what else should I check?” to confirm.

### 1. Blast Radius — overclaims when graph is empty

- **Symptom (GitLab):** “Impact is unverified” / engine unavailable, then a long write-up treating the test file as the main impact surface.
- **Symptom (Bitbucket):** Same pattern on `docker/development/compose.yml` — correctly says unverified / 0 dependents, then long Direct impact / APIs / Testing from file body alone (~40s).
- **Sources:** Weak evidence, 0 code dependents.
- **Wanted later:** Stop at unverified when dependents aren’t confirmed. No invented impact surfaces from reading the file. Prefer cached graph when available; otherwise short + honest.
- **Also:** Prepare time too long (GitLab ~58s, Bitbucket ~40s).
- **Shipped:** `enrichBlastRadiusResponse` replaces empty-graph essays; thin-evidence prompt + evidence-bound OPERATING_CONTEXT. Latency still open.

### 2. Understand Repo — wrong product story from thin anchors

- **Symptom (GitLab):** Framed Coop-AI as mainly webhook ingestion, not an IDE / AI coding product.
- **Symptom (Bitbucket):** Framed documenso around `apps/openpage-api` + GitHub issues route — thin-anchor overfit, not the real product story (document signing / monorepo apps).
- **Sources:** Manifest + narrow anchors — enough to *connect*, not enough to *summarize correctly*.
- **Wanted later:** When anchors are narrow, say confidence is low / partial. Don’t overfit architecture to whatever one route came back.
- **Shipped:** `isNarrowRepoSummaryEvidence` + thin-anchor prompt block.

### 3. Knowledge Gaps — wrong-project `AGENTS.md` bleed

- **Symptom (GitLab only):** “Out-of-scope @ attachments” cited **Strata — AI Keyboard** `AGENTS.md`, unrelated to `coopai-group/Coop-AI`.
- **Bitbucket Gaps:** No wrong-project bleed observed. Honest: orphaned ownership, no external docs, recommended assign owner + document compose setup.
- **Wanted later:** Never attach local/other-project AGENTS into a remote Use-repo gaps turn. Empty scan → say scan couldn’t verify gaps, not “no gaps.”
- **Shipped (prompt):** Gaps system rule forbids wrong-project AGENTS as gaps evidence. Gather isolation still rely on existing projectInstructions sessionMode work — re-dogfood.

### 4. Trace / Owner — keep as quality bar

- **GitLab:** Trace and Owner looked good enough: real commit, real owner, Slack active, bus-factor called out.
- **Bitbucket Trace:** Strong — real introducing commit, Mythie as author, honest “alternatives / trade-offs unknown,” active status.
- **Bitbucket Owner:** Connection works; authors often “unknown” and files look orphaned. May be Bitbucket author mapping / identity gaps — quality ticket if GitHub/GitLab show names for the same kind of commit history.
- No Trace quality ticket unless later rounds regress.

---

## How to use this later

1. Finish host connection dogfood (~~GitLab~~ → ~~Bitbucket~~ → any remaining GitHub offline cases).
2. Open a quality pass from this backlog (Blast honesty, Understand thin-anchor, Gaps attachment scope, Bitbucket author “unknown”).
3. Re-run only the failing actions above; don’t re-score connection unless wiring changed.
