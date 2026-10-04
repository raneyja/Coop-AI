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
