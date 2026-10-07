# Turn isolation — no leftover repo / tool / file bleed

Paste this **entire file** into a **new** agent chat. This chat is closed. Do not continue work from the chip-swap thread.

Research first with subagents. Write the inspection table. Then ship **one shared isolation choke**. Evaluate with tests. Come back with Pass/Fail per command. Do **not** land a Blast-only regex, a heading strip, or “reload and try again.”

Do not weaken: L vs R chip jump, file-assistant leftover-hunt rules, empty-blast honest unverified, named Slack/Jira/docs on **this turn**, `/compare` when the user named two repos.

---

## Why this session exists (live Fail — 2026-09-22 11:31)

The user proved they can jump **local file → remote Use-repo file** and the chip stays honest (`L` then `R`). That is shipped. Do not reopen it unless a test proves it regressed.

Then they ran **Blast Radius** (explicit Workflows action, not plain English) on:

- File: `.idx/dev.nix`
- Use-repo: `coop-ai/plane` (owner `coop-ai`, repo `plane`)
- Branch: `preview`
- Chip: `R`

**What they saw (Fail):**

- Lead: impact unverified / no dependents — **honest, keep**.
- **Related documentation** listed Coop-AI product pages:
  - `ADR: Backend service extraction (COOP-101)` — `github:raneyja/Coop-AI`, `coop-ai-core`, `coop-backend`
  - `Developer onboarding — VS Code extension`
  - `ADR: Webview vs native sidebar (COOP-55)` — same Coop-AI repos

**That is unacceptable.** Blast on `coop-ai/plane` must not attach, cite, or search **raneyja/Coop-AI**. Soft prompt text already failed (`orgDocsSynthesisGuardrail` is Gaps-only and says “especially Coop-AI ADRs”). Soft prompt is not the product.

Do not special-case `.idx/dev.nix`, `COOP-101`, `plane`, or the string “Related documentation.” The Fail is the **class**: leftover or foreign evidence from another repo, another file, another tool, or another turn.

---

## Product law (enterprise isolation)

**This turn has one scenario.** Every gather, search, bundle merge, Sources card, synthesis prompt, and finish enricher must stay inside it.

| This turn is | Evidence may include | Evidence must not include |
|---|---|---|
| Use-repo `owner/repo` + optional file chip | Indexed code, graph, docs, Slack/Jira/Teams **about that repo**, and only if this turn asked for that tool or that workflow auto-fetches **for that repo** | Another GitHub/GitLab/Bitbucket repo, leftover thread docs, EH workspace (Coop-AI disk), a prior file’s timeline |
| L file-assistant (Desktop / untitled scratch / git / workspace that is not the Use-repo pin) | The attached local file. Named Slack/Jira/docs **if the user named them this turn** | Use-repo hunts, Blast/Trace/Gaps injectors, leftover locate |
| Explicit `/slack` (or `/jira` / `/teams` / `/confluence` / `/notion` / `/docs`) | That one integration, scoped to this Use-repo (or honest “no hits”) | Other integrations, other repos, leftover Blast dependents |
| Explicit `/compare` with two named repos | Those two repos only | A third leftover Use-repo or EH clone |
| Plain English, no slash, no Workflows | Plain chat. No silent Blast/Trace/Gaps/Owner | Confirm chips, sticky last `/blast`, leftover jobs |

**Slug, not a substring.** `coop-ai/plane` is not `raneyja/Coop-AI`. Owner `coop-ai` is not product Coop-AI. `/coop/.test(repo)` is a Fail if `plane` is treated as Coop or if `coop-ai/plane` keeps Coop-AI ADRs.

**Zero-clone.** Extension Development Host with Coop-AI open on disk + Use-repo `plane` must never read Coop-AI files, ADRs, or Slack as plane evidence. See `.cursor/rules/zero-clone-remote-only.mdc` and `src/workspace/repoEvidenceIsolation.ts`.

**Plain English stays plain.** See `.cursor/rules/plain-chat-must-not-promote.mdc`.

**Code-host parity.** Isolation must work for GitHub, GitLab, Bitbucket (`CODE_HOST_PROVIDERS`). Do not hardcode `github:`.

---

## What already shipped (do not regress)

- L ↔ R chip jump: untitled API viewing buffer keeps remote identity (`rememberRemotePatchBuffer` / `remoteIdentityForUntitledUri`). Leftover `Untitled-N` must not steal `R`. Tests: `sessionMode.test.ts` phantom-swap, `remoteViewBuffer.test.ts`, `fileChipIdentity.test.ts`.
- L leftover hunt: `applyFileAssistantIntentPlan`, `fileAssistant` on enrichers, N5 empty-R locate canned text stays.
- Code isolation helpers (keep, extend if needed — do not replace with a parallel copy):
  - `filterCodeEvidenceToActiveRepo`
  - `dropForeignActiveFileEvidence`
  - `shouldIsolateActiveFileForQuickAction` (already lists blast / gaps / understand / owner / trace)
  - `shouldSkipLocalEditorAttachForRepoScope`
  - `filterDocPagesForUseRepo` (fetch-time only today — **not sufficient**)
  - `orgDocsSynthesisGuardrail` (Gaps prompt only today — **not sufficient**)
- Sticky `/blast` on a later plain turn is already blocked (`resolveEffectiveQuickAction`). Keep that.

---

## Confirmed holes (verify; do not treat as the full list)

Research proved these. Confirm in code. Find the rest.

1. **`filterDocPagesForUseRepo`** (`src/context/integrationDocRelevance.ts`): if no page scores ≥ 50 (repo-linked), pool = **score ≥ 0**. Neutral foreign pages survive (“Developer onboarding — VS Code extension”). Foreign-ticket −40 can drop `COOP-101` at **fetch**, and they still appeared — so another path attached them.

2. **`pageLooksLikeForeignProduct` / `pageLooksLikeForeignTicket`** key off **repo name only** (`/coop/.test(repo)`). They do not compare **full owner/repo slugs**. `coop-ai/plane` vs `raneyja/Coop-AI` is the dogfood pair.

3. **`mergeContextBundleResults`** (`CoopChatSession.ts`): keeps prior bundle types not replaced this turn. `decision_history` is file-gated. **Confluence/Notion/Slack/Jira are not repo-gated.** Switching Use-repo or file can keep leftover org docs.

4. **`extractConfluencePagesFromBundle` / Notion / Google Docs** and **`blastRadiusFromBundle`**: no Use-repo re-filter. Enrichers inject whatever is in the bundle.

5. **`enrichCompactIntegrationDocs`**: ranks by active **file path** and **+6 ADR boost**. No Use-repo filter. That is the “Related documentation” block the user saw.

6. **`appendIntegrationDocsResponseContract`** on Blast (and Understand): tells the model to **name every attached title**. If leftover pages are attached, the model is required to spill them.

7. **`orgDocsSynthesisGuardrail`**: Gaps only. Blast / Understand / Trace / Owner do not get it. Even if added, it is **not** a substitute for a hard drop.

8. **`enrichChatContextWithIntegrations`**: owner/repo can fall through `request.params` → `currentContext` → **`preferences`**. Settings leftover `raneyja/Coop-AI` while the chip is `coop-ai/plane` is a Fail.

9. **`collectCrossToolSearchText`**: one foreign Confluence title can widen Jira/Slack/Docs on the same turn.

10. **`hydrateContextBundleFromArtifacts` / thread artifacts**: can replay old integration evidence.

Existing test `filterDocPagesForUseRepo drops COOP ticket ADRs when Use-repo is not Coop` uses `makeplane/plane` at **fetch**. It does **not** cover: `coop-ai/plane` + leftover bundle + Blast enricher. That is why CI was green and dogfood failed.

---

## Required behavior after this ship

### Isolation choke (one owner)

Add **one** shared function (name it; put it next to `repoEvidenceIsolation` or extend `filterDocPagesForUseRepo` + Slack/Jira siblings). It takes **this-turn** `{ owner, repo, provider?, file? }` and drops foreign:

- Confluence / Notion / Google Docs pages
- Slack / Teams threads
- Jira issues
- Code snippets with a `repoId`
- Bundle entries / artifacts from a different `owner/repo`

Apply it at **every boundary**, not only Blast:

| Stage | Must filter |
|---|---|
| After fetch | Confluence, Notion, Google Docs, Slack, Teams, Jira |
| Bundle merge | `mergeContextBundleResults` — evict integration + hunt keys when Use-repo or file scenario changed |
| Bundle read | Every `extract*FromBundle`, `blastRadiusFromBundle`, evidence-card builders |
| Enrichment | `enrichChatResponseForAction` before Related docs / Callers / Gaps / Owner / Trace injectors |
| Synthesis | Before `appendIntegrationDocsResponseContract` — contract sees **filtered** pages only |

`preferences.owner/repo` must never win over the chip / request Use-repo on a gather path.

When nothing in-repo remains: **omit** Related documentation. Do not fill with leftover Coop pages. Honest empty is Pass.

### Two-sided test (every command)

| Use-repo this turn | Leftover in bundle / prefs / thread | Pass | Fail |
|---|---|---|---|
| `coop-ai/plane` | Coop-AI ADRs, `raneyja/Coop-AI`, COOP-101, VS Code onboarding for Coop | Dropped. Answer stays on plane (or honest empty) | Any of those titles in the bubble or Sources |
| `raneyja/Coop-AI` | Same Coop-AI ADRs | Allowed (they belong) | Dropping them as “foreign” |
| L Desktop `.cs` | Leftover plane Blast / locate | File-assistant; no remote docs / dependents | Related docs or “in this repo” |
| `/compare` A vs B | Leftover C | Only A and B | C’s Slack or ADRs |

---

## Part 1 — inspect (required, all commands)

Launch explore/generalPurpose subagents. Read the code. **Write the table in the reply** before you ship. For each site: file, function, leftover field, knows this-turn Use-repo + named tool?, user-visible, Pass/Fail, two-sided test.

If a site is already safe, one line why. Do not “fix” it.

### Commands and surfaces you must grade

From `SLASH_COMMANDS` plus Sources-card / Workflows buttons that send the same `actionId` or `integrationProvider`:

| Token / surface | actionId / provider | Isolation question |
|---|---|---|
| `/blast` + Blast Radius button | `blast-radius` | Docs, Slack, Jira, dependents, Related documentation, Sources — this Use-repo + this file only |
| `/trace` + Trace Decision | `trace-decision` | Timeline, docs, discussion — this file / this Use-repo. No leftover other-file timeline |
| `/understand` + Understand Repo | `understand-repo` | Architecture of **this** Use-repo. No leftover file chip from another repo. No Coop ADRs on plane |
| `/gaps` + Knowledge Gaps | `knowledge-gaps` | Gaps for this Use-repo. Guardrail exists — prove hard filter too |
| `/owner` + Find Owner | `find-owner` | Owners for this file/repo. Slack/Teams this repo only |
| `/edit` `/fix` | composer edit | Patch target = this file. No leftover Use-repo open |
| `/compare` | compare | Only the two named repos |
| `/slack` | slack | Slack only, this Use-repo terms. No Jira/docs/Blast leftover |
| `/jira` | jira | Jira only, this Use-repo |
| `/teams` | teams | Teams only, this Use-repo |
| `/confluence` | confluence | Confluence only, this Use-repo |
| `/notion` | notion | Notion only, this Use-repo |
| `/docs` | google-docs | Google Docs only, this Use-repo |
| Sources-card “run this action” | same as button | Inherits the same law |
| Plain chat on R file | none | No auto Blast/docs. Dogfood “what does this file do?” was Pass — keep |
| Plain chat on L file | none | No leftover Use-repo injectors |
| Follow-up after `/blast` | none unless they slash again | No sticky blast, no leftover Related docs |

Also inspect gather that is **not** a slash but still fetches tools: `shouldFetchRepoWideIntegrations` (Blast + Gaps), `shouldFetchTraceDecisionIntegrations`, `shouldFetchDiscussionIntegrations` (Owner + those), `fetchIntegrationsAllowlist`.

### Checklist (not complete — find more)

1. Every reader of `lastContextBundle`, `threadArtifacts`, `intentPlan.jobs`, `preferences.owner/repo`.
2. Every builder: `buildRepoSearchTerms`, `buildIntegrationSearchTermList`, `buildDiscussionSearchQueries`, `buildConfluenceCql` — leftover extraTerms / crossToolText / contextText from another repo.
3. Every rewriter: `enrichChatResponseForAction`, `enrichCompactIntegrationDocs`, `enrichBlastRadiusResponse`, Gaps/Owner/Trace/incident/caller/package enrichers.
4. Activity / thinking / Sources cards that can **name** a leftover repo or leftover tool.
5. Autocomplete / graph: R plane must not use Coop-AI disk graph.

---

## Part 2 — plan, then implement

After the table, write a short plan (choke + call sites + tests). Then implement.

**Prefer** one filter + every caller. **Reject** Blast-only `if (title.includes("COOP-"))`, Gaps-only prompt append, or ranking tweaks that still attach the page.

When leftover pages are the only docs: **no Related documentation section**. Do not substitute Coop-AI “org docs” on a plane turn.

Named tool this turn (`/slack`, …) still runs. Hits must still be **this Use-repo**. Zero hits → honest empty for that tool, not leftover from `/confluence` last turn.

---

## Tests (required)

Keep existing isolation tests green. Add the dogfood class — **not** the filename.

Minimum:

1. **Bundle leftover:** Use-repo `coop-ai/plane` + Blast enrich/extract with leftover Confluence pages titled `ADR: Backend service extraction (COOP-101)` and `Developer onboarding — VS Code extension` covering `raneyja/Coop-AI`. Assert Related documentation is absent and those titles are not in the enriched answer. `raneyja/Coop-AI` Use-repo + same pages → they may remain.

2. **`mergeContextBundleResults`:** prior bundle has `confluenceSearch` for Coop-AI; incoming is plane Blast without replacing that type **or** with empty docs. Result must not keep Coop pages for plane.

3. **Fetch filter:** `coop-ai/plane` (owner contains `coop`, repo is `plane`) drops Coop-AI ADRs and COOP tickets. Neutral “VS Code extension” onboarding about Coop does not fill the ≥ 0 fallback. `raneyja/Coop-AI` still keeps Coop ADRs.

4. **Slash isolation:** leftover Jira/Slack from another repo does not appear on `/slack` this turn unless this Use-repo matches. Leftover Blast docs do not appear on plain R “what does this file do?”

5. **L unchanged:** leftover Blast/docs bundle on a Desktop file does not inject Related documentation or Use-repo callers.

6. **Empty Blast dependents** stay honest unverified. Do not invent plane callers to “replace” dropped docs.

Run **touched test files only**. Do not run the full matrix unless a change escapes those files.

---

## Evaluate, then come back

Your **reply to Jon** (founder/PM, short):

1. Inspection table (every command: Pass/Fail).
2. What you shipped (one choke, where it is called).
3. Tests run + result.
4. Two-sided proof: plane + leftover Coop ADRs = dropped; Coop-AI Use-repo + same ADRs = kept.
5. What you did **not** change (chip jump, L leftover hunt, N5).

If any command in the table is still Fail, you are not done. Do not say “Blast is fixed” and leave Understand / Gaps / Slack / bundle merge leaking.

---

## Do not

- Special-case `plane`, `.idx/dev.nix`, `SetHtmlEvent.cs`, `COOP-101`, or “Related documentation” as a string kill-switch that also kills in-repo docs.
- Add `rg`, disk walk, or EH workspace search for plane.
- Reopen L file-assistant quality / generic chat prompt.
- Reopen untitled chip identity unless a test proves R→L Untitled-1 is back.
- Leave isolation to `orgDocsSynthesisGuardrail` or ADR ranking.
- Treat `coop-ai/plane` as Coop-AI because the owner slug contains `coop`.

---

## Done when

- A plane Blast with leftover Coop-AI ADRs in the bundle **cannot** show those titles in the bubble or Sources.
- The same pages on a Coop-AI Blast **can**.
- Understand, Gaps, Trace, Owner, `/slack` `/jira` `/teams` `/confluence` `/notion` `/docs`, `/compare`, `/edit`, and plain R/L follow the same choke.
- Bundle merge cannot keep another repo’s integrations after Use-repo changes.
- Fetch fallback cannot fill with score-0 foreign product pages.
- Inspection table is in the reply.
- You did **not** ship a Blast-only patch and call the job done.
