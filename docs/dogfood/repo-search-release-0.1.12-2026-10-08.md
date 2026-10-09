# Repository search release 0.1.12 — October 8, 2026

User authorization: push and deploy the verified repair; provide three manual confirmation tests.

Source commit: `16bd23aabf7a0357b3dc0b696c289aaf315c0894`, pushed and verified at `origin/checkpoint/dogfood-2026-10-03`. Existing PR #64 targets main and is conflicting; this release uses committed snapshots and does not merge that PR. This record is a separate documentation checkpoint after the source release.

## Automated and package verification

- Full CI passed on the behavior-qualified candidate in this conversation. Only version, build identity, changelog and evidence documentation changed afterward.
- Release 0.1.12: lint before source commit and again afterward, Marketplace listing 6/6, and repo-search 182/182 pass. Packaging succeeds; the VSIX contains the intended runtime assets and no credentials.
- VSIX: `/Users/jonraney/Coop-AI/coop-ai.vsix`, SHA256 `144877dfb2aafbcae2ed882873a3cfc5424a8fe6c46c5b3cb1759997f090b6a6`.
- Extension bundle: `71712a96fc807ba0ff7f90beec23ce18401b971325a2c3f7d43eb04f4f98155d`; webview: `8f83ff4060dd745ffe2a536ddb7e1334b3eb875bdac492f5dcf9d936eaeeabba`.
- Extension Development Host reloaded into 0.1.12 and verified by final-request build/bundle diagnostics. No Marketplace publication was performed.

## Production deployments

Each upload is exported from the exact source commit through git archive. No untracked files or credential/config environment files are uploaded; tracked example environment files remain templates. Vercel snapshot roots include only the corresponding existing project identity.

- Railway API: project `CoopAI_Playwrite_Project` (`f1d4ad27-4fc8-4b6e-b0c4-227809977af6`), service `Coop-AI`, environment production. Deployment `2aaa435d-fea1-4360-bea6-e59d780357a2`: **SUCCESS**. Startup log confirms server listening on port 8080. https://api.coop-ai.dev/health returns `{"ok":true,"commit":"16bd23aabf7a"}`. Only the non-secret `COOP_BUILD_SHA` variable was set to the source commit, using skip-deploys before uploading. Prior successful deployment / rollback identity: `0abaf540-cbab-43c3-99e2-40bb7c83cd08` (source `72d3f69feda8…`).
- Admin Vercel project `coop-ai-admin`: deployment `dpl_3fC1U6NYzJdsEmDByRteLdK3NwrT`: **READY**, target production, aliased to https://admin.coop-ai.dev. Its Next build, type checks, and static generation succeed; `/login` responds HTTP 200.
- Website Vercel project `website`: deployment `dpl_5LCJMQHvmNCCBN5dSR6PmN3wxVaL`: **READY**, target production, aliased to https://coop-ai.dev. Its Next build, type checks, and static generation succeed; apex responds HTTP 200.

Upload manifest identities:
- api: 2351 files; SHA256 `b2ea55913b3b1485608fbbf97541d00da6ae236a85c8e9af30389f3542175b47`. Local manifest: `/private/tmp/coop-repo-search-api-manifest.json`.
- admin: 2352 files; SHA256 `9afb386ceb6c1c20a3fd677f18abfe7ebb62b633b50cc8653e361d39d2961cc4`. Local manifest: `/private/tmp/coop-repo-search-admin-manifest.json`.
- website: 2352 files; SHA256 `e76fd0c9bfbf578600bd160749a9ceb322553e0fc334d16ef9c7a1cd6b5b0d2f`. Local manifest: `/private/tmp/coop-repo-search-website-manifest.json`.

## Post-deployment Extension Host smoke

Target `CoopAI-Corp/documenso@main`, fresh chat, release bundle above. Exact ask:

> Using only the selected repository, how many files are in this repository and what are its top-level directories? Then read /apps/remix/react-router.config.ts and state appDirectory. Do not read or use /AGENTS.md.

Turn `turn-1791512215097-m96co9`: **live Pass**, first answer at **4.056s**. Answer gives canonical index-stats total 2,381, all 13 verified top-level tree directories, and `'app'` from the full config body. Final-request metadata contains both fact components and only the config requested/read body; excluded AGENTS.md is not used as requested source/guidance. No external integration activity starts. Actual guidance-loader veto is also covered by the automated Session tests.

Diagnostics: local Code logs `20261008T124201/window3/exthost/output_logging_20261008T190853/1-CoopAI Agent Diagnostics.log`. This smoke adds release identity and production verification to the earlier nine functional replays, not a claim of universal parsing or guaranteed provider latency.

## Tonight's manual checks

Run the three exact prompts and pass criteria in [the confirmation instructions](repo-search-contract-2026-10-08.md#tonights-three-manual-confirmation-tests). Use the reloaded Extension Development Host on 0.1.12, select Documenso/main with Use repo in each fresh chat, and record time to first answer text. If using ordinary installed VS Code instead, install the packaged 0.1.12 VSIX through Extensions → … → Install from VSIX, then Reload Window; an API deployment alone does not update the installed extension.
