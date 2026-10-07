# Plane locate ranking — auth + states + C2 (not the reject tripwire)

Paste this **entire file** into a **new** agent chat. Prior chat closed the **API-reject false-positive** tripwire (`isApiRejectAsk` + ValidationError scavenger hunt). That fix **Passed** dogfood. Do **not** reopen it unless a test proves it regressed.

This thread fixes the **next Fail class**: calm locate and on-call reject hunts that search vaguely right words, then **read / rank the wrong files** (live secret middleware, config vars, frontend MobX hooks) instead of the Django API auth / state write paths.

Research first. Write a short inspection table (where ranking / skip / search aliases decide). Then ship **shared, repo-agnostic** fixes. Evaluate with tests. Come back with Pass/Fail per dogfood ask. Do **not** special-case the string `plane`, `CoopAI-Corp`, or one filename.

Do not weaken: the calm-locate vs API-reject gate already shipped; Zero-Clone; evidence-bound short answers; plain chat must not promote; code-host parity.

---

## Why this session exists (live Fail — 2026-09-28)

Use-repo: indexed **plane** (e.g. `CoopAI-Corp/plane`), branch `preview`, **no file chip**, Extension Host.

### Already Pass (do not break)

**Tripwire:**  
`Where is API key / request authentication defined, and where do work-item states live in the backend?`  
→ Not ValidationError / not “rejects that field.” Found `apps/api/.../api_authentication.py` on that turn.

**Create locate:**  
`Where does the API create an issue?`  
→ `IssueViewSet` + `IssueCreateSerializer` under `apps/api/...` — Pass enough.

### Live Fails to fix

| ID | Ask | What happened | Fail |
|----|-----|---------------|------|
| **L1** | `Where is API key / request authentication defined in this repo?` | Searched `api key authentication`, `requireSecretKey`. Read `instance_config_variables/core.py` + `apps/live/.../auth-middleware.ts`. Answer led with live secret-key middleware; said REST API key auth wasn’t visible. | Same intent as the Pass compound ask, but **missed** `api_authentication.py` / `APIKeyAuthentication`. Config + live stole the turn. |
| **L2** | `Where do work-item states live in the backend?` | Searched work-item/IssueState; read a frontend commands file + `issue.py` serializer (`comment_html` only). Honest “I don’t see it.” | Calm locate must land a **backend** state model/view (or honest miss **after** trying server paths) — not frontend. |
| **L3** | Compound auth + states (wording variant) | Auth half found `api_authentication.py` (good). States half stayed on serializers / “model not opened.” | Auth ranking must be **stable** (not luck). States half must open a real state definition path when indexed. |
| **C2** | Copilot C2 ask (API returns an error / can’t move work item / what rejects) | Primary search `get("state")` (correct playbook). **Read** `apps/space/hooks/store/use-state.ts`. Answer: only frontend hook; asked user to open `apps/api`. | Right scavenger hunt, **wrong building**. Client UI must not be the evidence. |

### Confirmed code hole (verify; find siblings)

`isClientUiPath` in `src/indexing/evidencePathNoise.ts` only matches `(web|frontend|client)/`.

Live check:

- `apps/space/hooks/store/use-state.ts` → `isClientUiPath` **false**, `shouldSkipEvidencePath(..., COPILOT_C2_ASK)` **false**
- So C2’s “skip client UI” rule **does not** cover Plane’s `apps/space` (or `hooks/`, `live/` collab UI).

Do **not** hardcode `plane` or `apps/space` as a product name. Expand the **class**: client/app UI trees (hooks/stores/components for product UI) vs API/server write trees — repo-agnostic.

Also verify: for **API key / request authentication** locate, ranking currently allows `requireSecretKey` / live auth and instance **config** catalogs to beat `APIKeyAuthentication` / `api_authentication` middleware. Prefer request-auth **enforcement** over env/config catalogs and over secondary service secret gates when the ask is API key / request authentication for the API.

---

## Product law

| Ask shape | Must prefer | Must not win |
|-----------|-------------|--------------|
| Calm locate: API key / request authentication | Server/API auth middleware or DRF `*Authentication` class that validates API keys / request credentials | Live-collab secret middleware alone; signup/config variable lists; “open a file for me” |
| Calm locate: where do work-item / issue **states** live (backend) | Backend model / view / serializer that defines or serves **states** | Frontend hooks/stores/commands; reject ValidationError hunt (already gated); comment_html-only serializer slices as the answer |
| C2 / `isApiRejectAsk`: where state written + what rejects | Server write / serializer / view ValidationError or transition reject | Client hooks (`use-state`, MobX stores), web commands that POST `state_id`, locale/seed/OpenAPI (existing skips — keep) |

**Honesty:** If after preferring the right class there is still no hit, short honest miss is Pass. Inventing paths or asking the user to open `apps/api` when the index had server hits is Fail.

**Latency:** Soft gather budget still applies; do not add long sequential searches. Fix ranking/skip/aliases so the **first** reads are the right class.

---

## What already shipped (keep green)

- `isApiRejectAsk` / `isLocateWithoutRejectComplaint` — calm locate with `API` + `work-item` must **not** enter ValidationError hunt. Tests: `PLANE_LOCATE_AUTH_AND_STATE_ASK`, `WORK_ITEM_STATE_LOCATE_ASK` in `dogfoodContract.ts` + `searchQuery.test.ts`.
- C2/T2/assignee still `isApiRejectAsk === true` and still search field-access / ValidationError.
- Existing C2 skips: locale, seed, OpenAPI, query filters, schema **catalog** models when hunting **reject** (prefer write handler). Do not blindly un-skip `db/models/state.py` for C2 if that re-breaks “catalog vs reject” — prefer **views/serializers/services** that reject transitions. For **calm L2 locate**, models/views that **define** states are in-bounds.
- `COPILOT_C2_ASK` in `dogfoodContract.ts` — shared fixture.

---

## Required implementation direction (shared choke, not one-off)

1. **Client UI path class** — Extend `isClientUiPath` (or a sibling used by `shouldSkipEvidencePath` / pick ranking) so product UI trees are skipped on API-reject hunts: e.g. `hooks/`, `store(s)/`, typical app UI package segments — **without** skipping `apps/api/...`. Prove with `apps/space/hooks/store/use-state.ts` skipped for C2 and still readable for an explicit frontend ask.

2. **API key / request-auth locate ranking** — When the ask is about API key / request authentication (calm locate), prefer hits that look like auth **middleware / Authentication class / api_authentication**-style enforcement over:
   - instance config / env catalogs
   - secondary service secret middleware (`requireSecretKey`-shaped) when a primary API auth hit exists  
   Shared ranking in `pickSearchHitsToRead` / score helpers — not a prompt footnote.

3. **Work-item / issue state calm locate** — Aliases and ranking so “where do states live in the backend” prefers server state model/view/serializer paths, not web/space commands. Must not re-enable ValidationError primary.

4. **C2 pick** — With client UI skipped, `pickSearchHitsToRead` for `COPILOT_C2_ASK` must prefer a server write/reject hit over any remaining UI path. Add/extend an orchestrator or searchQuery unit test that mirrors the live Fail: hits include `use-state.ts` + a server reject snippet → server wins; `use-state` never read.

5. **Tests** — Dogfood **class**, not one customer slug:
   - L1-shaped ask → top picks include api auth middleware path, not only live auth-middleware / config vars
   - L2-shaped ask → not reject mode; prefers backend state path over frontend commands/hooks
   - C2 → `shouldSkipEvidencePath('…/hooks/store/use-state.ts', COPILOT_C2_ASK) === true` (or equivalent class path)
   - Keep existing C2/T2/plane calm-locate tripwire tests green

---

## Dogfood Pass/Fail (Jon re-runs after ship)

Use-repo plane, no file chip, reload Extension Host first.

| ID | Ask | Pass | Fail |
|----|-----|------|------|
| L1 | `Where is API key / request authentication defined in this repo?` | Cites `…/api_authentication.py` or `APIKeyAuthentication` (API request auth). Live secret may be secondary only. | Leads with live `auth-middleware` / config vars only; “REST auth not visible” when API auth is indexed |
| L2 | `Where do work-item states live in the backend?` | Backend path under API (state model/view/serializer that is about **states**) | Frontend hook/store/commands; ValidationError hunt |
| L3 | `Where does the API authenticate requests with an API key, and where are issue/work-item states defined on the server?` | Auth file **and** a real state definition path opened or cited from read evidence | Auth OK but states only “model not in snippets” when index had state views/models; or reject playbook |
| C2 | Exact `COPILOT_C2_ASK` | Server write/reject under API; not `apps/space/.../use-state.ts` as the opened evidence | Opens space/web hook; “open apps/api for me” |
| Tripwire | `PLANE_LOCATE_AUTH_AND_STATE_ASK` | Still not ValidationError-first | Regresses to reject scavenger hunt |
| Create | `Where does the API create an issue?` | Still IssueViewSet / create serializer class | Breaks |

---

## Anti-patterns (reject)

- Special-casing `plane`, `CoopAI-Corp`, `use-state.ts`, or `api_authentication.py` as the only fix.
- Prompt-only “prefer Django” with no ranking/skip change.
- Deleting the API-reject scavenger hunt.
- Letting calm locate skip all `db/models` globally (breaks L2) or un-skipping every model on C2 (re-breaks catalog vs reject).
- Local disk / workspace walk (Zero-Clone).
- Asking the user to open files when server hits were available.

---

## Boris bar

Would a staff engineer trust “where is API key auth?” and “what rejects a bad work-item transition?” on an indexed service they don’t own? If L1 still leads with live secret config, or C2 still opens a React hook, you are not done.

---

## Deliverable

1. Inspection table (choke points + what you changed).  
2. Minimal diff + tests green.  
3. Pass/Fail against L1, L2, L3, C2, tripwire, create — based on tests; note what Jon must still re-dogfood in Extension Host.  
4. Do not commit unless asked.
