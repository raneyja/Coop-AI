# October 4 core follow-up

Status: continuing launch qualification. This checkpoint repairs three observed answer failures and records additional packaged-extension checks. It does not certify launch readiness or promote the October 3 scenario matrix.

## Candidate

Bundle SHA-256: `f5df81af2e4463ede4c9deaa4342978a336c30141071dec841b57c0c3605e51c`. VSIX SHA-256: `b44279f63c83e3b3f9fdfdd7a9a11e57a5865fc864dab62b5d407ffca4024032`. Installed with the official VS Code CLI into the existing disposable clean profile, then reloaded.

[Full CI](evidence/test-ci.log), [lint](evidence/lint-final.log), [package](evidence/package.log), and [96 orchestrator regressions](evidence/orchestrator.log) passed. A test initially omitted the explicit preview branch from its synthetic target; the harness now supplies that branch. Sandbox npm DNS failures were rerun with approved network access.

## Repairs

Parent-validation requests no longer inherit a state-persistence completion gate solely from planner labels. ValidationError phrasing without the word API still routes to rejection evidence. Return-value questions such as “what exact string does fixtureBranchLabel return?” now invoke the shared repository lookup path. A new branch-scope guard refuses an explicitly requested branch when the indexed target resolves to another branch; it performs no source search or body read in that case.

The packaged branch mismatch request returned the correct explanation in 2,897 ms. A matching alternate-branch request started answering in 9,946 ms, returned `alternate-oracle`, and opened the same implementation in the editor with lines 9–11 selected. Parent fallback wording passed live on an earlier bundle in this batch; final-bundle Parent paraphrase still needs its own live retest.

Stop diagnostics record only timing, turn registration, partial-answer presence and build identity when existing diagnostic opt-in is enabled. A live Stop occurred after synthesis started (5,151 ms), at 7,083 ms, before any token; no late patch appeared and the next rename applied. Partial-token Stop is a separate remaining check. A local square autocomplete was accepted and independently checked, with buffer-only scope; this is not proof of indexed graph grounding.

## Controlled remote fixture

Private repository: https://github.com/CoopAI-Corp/coop-dogfood-launch. It contains synthetic source only. Main commit: `3d1507d0e999b151b30eaf6d068d92da59ebe87f`; alternate: `cb41ae8bef8bade85dceae2bc7da1385f0c83432`; renamed: `bf1490e7a3ae824e76318e503a6c00963b2e91e9`. Authored source oracles are retained in evidence; they are never supplied as product repository context. Coop reads bodies remotely. The test repository is currently indexed on alternate after changing only its disposable default branch and reindexing through the admin UI. Existing connector access already covered this repository; no new OAuth grant was needed.

The relevant late method was located beyond line 400. Its citation navigation still needs visual qualification. The untrusted document and validator were both remotely read; the answer correctly described the allow-list guard and error without emitting the injection canary or following the hostile instructions. This is a pass for that controlled fixture, not blanket security certification. Unicode citation qualification is in progress.

Plane and Documenso remain external forked fixtures. Product repairs are in Coop AI. The existing Bitbucket Documenso connection is usable; earlier reports that Bitbucket access was absent were stale.

## Continue from here

Verify final-bundle Parent paraphrase, Unicode and late-method citation openings, renamed generation, missing symbol and the remaining edit/session/quick-action scenarios. Preserve exact candidate/ref provenance for each observation. Review integration fixture destinations before requesting authorization to post test content. Teams is not connected. Organization isolation and denied-access extension checks still need distinct account/grant fixtures, even though API-only sandbox checks passed. The existing Stripe test key returns `api_key_expired`; replacement was requested, with no payment attempted. No new production deployment or Marketplace publish occurred.

Detailed scoped results and pending work are in [observations](observations.json). Diagnostic traces preserve failed attempts alongside passing retests.

## Missing-symbol follow-up

The first missing-symbol result honestly reported a miss, but attached an unrelated README and classified it as verified evidence. Mixed PascalCase with an underscore suffix was omitted by identifier extraction. The shared parser now retains that complete identifier. All 100 query regressions passed. On bundle `196c7e7ae7ca309d0a318d0e8e9002324e165ebd624b610b773a34421ef47a55`, the exact ask returned a short miss in 9,003 ms with no evidence files attached and no verified unrelated ledger entries. Full CI, lint and packaging passed for that source repair.

The Parent paraphrase without “API” then returned the correct guard on preview, starting in 9,955 ms. Its citation opening remains unqualified after repeated native UI actions produced no visible editor; an opt-in citation diagnostic is being prepared before attributing the problem to app code. Native coordinate input also reported no available window, so the cause remains uncertain.

The private fixture is now indexed on renamed. The admin UI shows Usable/Complete; [screenshot](evidence/fixture-index-admin.jpg). The corresponding source lookup has not yet run.

## Access pause and website cleanup

Native VS Code input ceased changing the visible page, while browser DOM controls continued to work. An awake, unlocked test window was requested; application diagnosis remains pending instead of inferring a citation bug from the stalled controls. Citation diagnostic bundle `7d8acfc656ad404e1c0d841f1bfd4a46fb69b5b303fae73773acf5e775735265` (VSIX `2769fc7a6073e4491c76a26508c62a5f3b8bd470cfc2676e47eb526fce618e07`) is installed but has not been reloaded. It adds opt-in context metadata at citation click handling without logging file bodies. Lint, package and selected-ref citation regressions passed; the full CI evidence immediately precedes this small diagnostic addition. The first standalone citation command omitted the required VS Code test stub; the correct stubbed command passed.

Live homepage, docs and pricing returned HTTP 200. The homepage’s unfinished “Replace this frame…” screenshot placeholder was removed from Testimonial.tsx. The website build passed and the loopback-only preview was visually checked in Chrome; [preview screenshot](evidence/homepage-placeholder-removed.jpg). Existing testimonials were preserved; their authenticity was not independently verified. This source cleanup is not deployed. The local preview uses port 31801, bound to 127.0.0.1.

Immediate continuation: restore desktop input, Reload the installed diagnostic package, click the existing Parent citation and inspect the citation-open trace. Then select the renamed fixture generation and verify src/mathRenamed.ts and renamed-oracle without stale math.ts. Stripe replacement remains pending. No new production deployment, Marketplace publication or external collaboration message was sent.
