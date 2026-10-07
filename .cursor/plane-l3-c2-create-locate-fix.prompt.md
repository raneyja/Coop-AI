# Plane L3 + C2 + Create — compound locate, reject hunt noise, finish honesty

Paste this **entire file** into a **new** agent chat.

Prior threads already shipped and dogfood-**Passed**:

| ID | Status | Do not reopen unless a test proves regression |
|----|--------|-----------------------------------------------|
| Calm vs reject tripwire | Pass | `isApiRejectAsk` / `isLocateWithoutRejectComplaint` — compound “API key + states live” must **not** enter ValidationError hunt |
| L1 | Pass | API key / request auth → `api_authentication` / `APIKeyAuthentication` |
| L2 | Pass | Backend states → `State` / `StateSerializer` / state views — not seeds, not UI hooks |
| Tripwire (re-dogfood 2026-09-29) | Pass | Auth + `StateSerializer`; not ValidationError-first |

This thread fixes the **next Fail class** from live Extension Host dogfood (2026-09-29): three different holes.

1. **L3** — compound auth + states ask: auth half works; **states half** still latches onto the wrong serializer window (`comment_html` validate) and claims the state definition is missing — even though the same session’s Tripwire wording found `StateSerializer`.
2. **C2** — on-call reject hunt: client UI skip worked (no `use-state.ts`); hunt still **reads noise** (icons, empty-state types, seed tasks, migrations, OpenAPI, HTML templates) and ends in canned miss without a server write/reject.
3. **Create** — locate finds `IssueViewSet` / issue serializer paths, then the **answer ignores attached reads** and tells the user to open files already read.

Research first. Write a short inspection table (choke points per Fail ID). Plan **shared, repo-agnostic rules** (ask shape → evidence class), not dogfood string special-cases. Implement. Unit-test. Come back with Pass/Fail per ID. Do **not** special-case `plane`, `CoopAI-Corp`, or one filename.

Do not weaken: calm-locate vs API-reject gate; L1/L2 ranking/skip already shipped; Zero-Clone; evidence-bound short answers; plain chat must not promote; code-host parity.

---

## Why this session exists (live Fail — 2026-09-29)

Use-repo: indexed **plane** (`CoopAI-Corp/plane`), branch `preview`, **no file chip**, Extension Host. Reload before dogfood.

### Live Fails to fix (exact pastes)

| ID | Ask | What happened | Fail class |
|----|-----|---------------|------------|
| **L3** | `Where does the API authenticate requests with an API key, and where are issue/work-item states defined on the server?` | Auth: found `apps/api/.../middleware/api_authentication.py` (good; briefly touched `apps/live/.../auth.ts`). States: searched `work item state` / `IssueState` / bare `work item`; **read** `apps/api/.../serializers/issue.py` at `validate` / `comment_html` only. Answer: no state catalog visible; “open backend models for me.” | **Compound locate incomplete.** Same product need as Tripwire/L2, different wording (“defined on the server”). Must open a **state definition** path when indexed — not a wrong-field slice of the issue serializer. Must not ask the user to open what the index has. |
| **C2** | Exact `COPILOT_C2_ASK` | Primary `get("state")` (correct). Did **not** open `use-state` (prior fix held). Instead read: notification HTML, `done-icon.tsx`, `empty-state/types.ts`, `workspace_seed_task.py`, `dummy_data_task.py`, migration `0112_…`, OpenAPI `__init__.py`, `csrf_failure.html`. Canned: “I couldn't find where the API rejects that field.” | **Reject hunt noise.** Skip/rank must keep only **server write/reject** class. Icons, empty-state packages, migrations, OpenAPI, seed/dummy tasks, CSRF HTML must not burn reads. Prefer ValidationError / transition reject under API serializers/views. |
| **Create** | `Where does the API create an issue?` | Searched `create_issue`, `IssueViewSet`, `IssueCreateSerializer`. **Read** `…/views/issue/base.py` and `…/serializers/issue.py` (and a test). Answer claimed create/save not visible; told user to open `IssueViewSet` create in the same `base.py` already read. | **Finish honesty / evidence use.** Routing found the right class. Synthesis must cite create/create-related evidence from attached reads — not “open the file I already opened.” Thin evidence → short honest limit is OK; inventing a miss after reading the viewset is Fail. |

### Contrast — already Pass (do not break)

| ID | Ask | Why Pass |
|----|-----|----------|
| L1 | `Where is API key / request authentication defined in this repo?` | Led with `APIKeyAuthentication` / `api_authentication.py` |
| L2 | `Where do work-item states live in the backend?` | `State` / `StateSerializer` / workspace state views under API |
| Tripwire | `Where is API key / request authentication defined, and where do work-item states live in the backend?` | Auth file + `StateSerializer`; not ValidationError-first |

**L3 vs Tripwire:** Nearly the same job. Tripwire wording (“states **live** in the backend”) Passes. L3 wording (“states **defined on the server**”) Fails states half. The rule must be about **compound auth+state locate ask class**, not one lucky phrase.

---

## Product law (rule-based — not dogfood patches)

| Ask shape | Must prefer | Must not win |
|-----------|-------------|--------------|
| **Compound calm locate** (auth/API key **and** work-item/issue **states** on server/backend) | (1) Request-auth enforcement **and** (2) state **definition** (model/serializer/view about states) — both from read evidence when indexed | Auth alone + “state model not in snippets”; wrong-field issue serializer (`comment_html`); live/secondary auth as the only auth story; asking user to open `apps/api` when hits existed |
| **C2 / `isApiRejectAsk`** | Server serializer/view/service that **writes or rejects** state/transition | Icons, empty-state UI packages, migrations, OpenAPI, seed/dummy tasks, CSRF/HTML templates, client hooks (already skipped) |
| **Create locate** (“where does the API **create** an issue/work item”) | ViewSet/`create` action / create serializer — cite from **attached** reads | “Open IssueViewSet for me” after `base.py` was read; wrong playbook (reject hunt); answering only from tests |

**Honesty:** If after preferring the right class there is still no hit → short honest miss is Pass. Claiming miss while definition/create evidence was attached is Fail. Inventing paths is Fail.

**Latency:** Soft gather budget still applies. Fix ranking/skip/aliases/finish gates so **first** reads are the right class — do not add long sequential hunts.

**Rule test:** Would the same fix help a random indexed Django/Rails service with API auth + State model + issue create ViewSet + ValidationError on bad transition — without naming that customer? If no → reject the design.

---

## Confirmed / suspected holes (verify; find siblings)

### L3 — compound states half

- Tripwire/L2 aliases and `isBackendStateLocateAsk` may not fire equally for “**defined on the server**” vs “**live in the backend**.”
- Compound pick may keep auth enforcement and then allow a **non-state** issue serializer window to satisfy “something under api was read.”
- Finish gate may treat any API read as enough for the whole compound ask.
- Wrong-field `validate(comment_html)` must not count as state definition (same class as reject wrong-field filters — for **locate** definition).

Inspect: `isBackendStateLocateAsk`, `isDefinitionLocateAsk`, `pickSearchHitsToRead` compound branch, `classifyLocateRead` / `isBackendStateDefinitionHit`, `canAnswerNow` in `AgentOrchestrator`, search aliases for compound wording.

### C2 — reject noise after UI skip

- `shouldSkipEvidencePath` / `isActionableApiRejectHit` may not cover: `migrations/`, icon packages, `empty-state/`, `bgtasks/*seed*`, OpenAPI packages, `*.html` templates.
- Expand **noise classes** repo-agnostically (migrations, static icons, HTML templates, openapi already partially skipped — verify).
- Ranking must prefer `contentLooksLikeAskedFieldReject` / write-reject under serializers/views over any remaining noise.
- Canned miss is correct only after actionable server hits were tried/skipped properly — not after reading icons.

Inspect: `evidencePathNoise.ts`, `shouldSkipEvidencePath`, `pickSearchHitsToRead` API-reject branch, `huntWriteReject`, `COPILOT_C2_ASK` fixtures in `dogfoodContract.ts` + `searchQuery.test.ts`.

### Create — finish honesty

- Search found ViewSet + serializer; answer ignored bodies.
- Likely finish/synthesis / grounding: model allowed “done” without citing create from attached files, or read window missed `create`/`perform_create` and finish did not expand/jump.
- Rule: for **create-locate** asks, prefer ViewSet create / create serializer declaration; if those paths were read, answer must bind to them (or jump in-file to `create` / `perform_create` / `IssueCreateSerializer`) — never “please open the file we read.”

Inspect: create-locate ask detection (new shared class or existing locate), `locateReadCountsAsGrounding`, read windows, `finishWithAnswer` / customer-facing miss copy, AgentOrchestrator `canAnswerNow` for create-shaped asks.

---

## Required implementation direction

1. **Research** — Reproduce each Fail with unit tests that mirror live hit sets (no live plane clone). Inspection table of choke points.
2. **Plan** — One rule table: ask class → prefer class → skip class. No product folder names.
3. **Implement** — Shared helpers in `evidencePathNoise` / `searchQuery` / `locateEvidence` / orchestrator finish — minimal diffs.
4. **Test** — Dogfood **class** fixtures in `dogfoodContract.ts` (L3 exact ask, `COPILOT_C2_ASK`, create ask). Keep L1/L2/tripwire/C2-UI-skip tests green.
5. **Report** — Pass/Fail per ID from tests; list what Jon must re-dogfood in Extension Host.
6. **Do not commit** unless asked.

### Suggested rule sketches (validate; do not cargo-cult)

| ID | Rule sketch |
|----|-------------|
| L3 | Compound auth+state locate requires **both** an auth-enforcement grounding read **and** a state-definition grounding read before `canAnswerNow` / before claiming states missing. “Defined on the server” ∈ backend state locate class. Issue serializer without state definition content ≠ state evidence. |
| C2 | Expand skip noise for API-reject: migrations, icon/asset trees, HTML templates, seed/dummy tasks (if not already), keep OpenAPI skip. Prefer reject snippets; never burn max reads on icons. |
| Create | Create-locate ask class: prefer ViewSet/`create` / CreateSerializer; if those files are in attached evidence, finish must not emit “open that path”; jump or cite from body. |

---

## Dogfood Pass/Fail (Jon re-runs after ship)

Use-repo plane, no file chip, **reload Extension Host** first. Run **each ID alone** (new turn).

| ID | Ask | Pass | Fail |
|----|-----|------|------|
| **L3** | `Where does the API authenticate requests with an API key, and where are issue/work-item states defined on the server?` | Cites API key auth middleware/class **and** a state definition path (State model / StateSerializer / state view) from **read** evidence | Auth only; states = “not in snippets” / open models for me; or reject playbook; or only `comment_html` validate |
| **C2** | Exact `COPILOT_C2_ASK` from `dogfoodContract.ts` | Server write/reject under API (ValidationError / transition / state_id reject). Not icons, empty-state packages, migrations, OpenAPI, seed tasks, or space hooks as the story | Noise reads then canned miss; or UI hook; or “open apps/api for me” when reject was indexed |
| **Create** | `Where does the API create an issue?` | Cites IssueViewSet create / create serializer (or equivalent) **from attached reads** | Tells user to open a path already read; or never finds create class; or reject hunt |
| **Regression — Tripwire** | `Where is API key / request authentication defined, and where do work-item states live in the backend?` | Still both halves; not ValidationError-first | Regresses |
| **Regression — L2** | `Where do work-item states live in the backend?` | Still State / StateSerializer class | Seeds or UI again |
| **Regression — L1** | `Where is API key / request authentication defined in this repo?` | Still APIKeyAuthentication class | Live/config only again |

---

## Anti-patterns (reject)

- Special-casing `plane`, `CoopAI-Corp`, `comment_html`, `done-icon`, or one OpenAPI path as the only fix.
- Prompt-only “prefer Django” with no ranking/skip/finish change.
- Re-enabling ValidationError hunt for calm L3/Tripwire.
- Skipping all `db/models` on calm state locate (breaks L2) or un-skipping every model on C2 (catalog vs reject).
- Local disk / workspace walk (Zero-Clone).
- Asking the user to open files when server hits were attached.

---

## Boris bar

Would a staff engineer trust compound “where is API key auth **and** where are states defined?” and “what rejects a bad work-item transition?” and “where does create issue live?” on an indexed service they don’t own? If L3 still shrugs on states after Tripwire-shaped evidence exists, or C2 still opens icons, or Create gaslights after reading the ViewSet — you are not done.

---

## Deliverable

1. Inspection table (per Fail ID: choke + rule change).  
2. Minimal diff + tests green.  
3. Pass/Fail against L3, C2, Create (+ regression L1/L2/Tripwire) from tests; note Extension Host re-dogfood.  
4. Do not commit unless asked.

## Workflow (mandatory order)

1. **Research** — code + failing unit reproductions for L3/C2/Create live hit patterns.  
2. **Plan** — ask-class → evidence-class rules; inspection table.  
3. **Implement** — shared choke points only.  
4. **Review** — self-check against anti-patterns and Boris bar.  
5. **Test** — unit + report Pass/Fail.  
6. **Hand off** — remaining Extension Host asks for Jon.
