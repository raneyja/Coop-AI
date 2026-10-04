# October 3 overnight checkpoint

This checkpoint preserves the accumulated Coop AI dogfood repairs, regression tests, sandbox tools and evidence. It is work in progress, not a launch-ready release. Continue on `checkpoint/dogfood-2026-10-03`; main remains unchanged. Unrelated editor settings, agent instructions and planning files remain unstaged in the existing checkout.

## Verified state

All 15 automated gates passed on the recorded candidate. Lint and Marketplace listing checks were repeated before this checkpoint. The exact VSIX installation and official Extension Host activation passed; the complete interactive clean-profile scenario remains open. Local cancellation followed by a narrow rename passed on the final packaged candidate. See [the continuation report](runs/2026-10-03-continuation/README.md) and its linked evidence for exact scopes and candidate hashes.

Production backend deployment `a9fd94df-f99c-4be5-adaf-f6cd269c6322` succeeded after explicit user approval. Migrations, startup and health passed. Its upload manifest is recorded in the evidence. The prior successful deployment `5eb49c1f-a891-46d6-ad7d-3c3df4360c0c` is the rollback identity. No extension or website publication occurred.

## Start tomorrow

1. Diagnose Coop's source retrieval against the Plane test fixture on preview. Cold and warm asks miss known Parent validation source. The saved traces show the shared gather allowance ending while host search waits; subsequent filename discovery and body reads return no evidence. Treat this as a diagnostic lead, not proof of the complete root cause. Remote Workspace can locate and open the serializer. Do not relax provenance checks, inject the oracle into product context, or use a local clone.
2. Verify producer branch/commit provenance on the deployed backend and retest retrieval across GitHub, GitLab and Bitbucket. The GitLab Coop-AI repository-switch lookup passed with a correct source citation, but that does not certify full tenant isolation.
3. Complete the exact packaged core journey: clean install, sign-in, repository selection, verified lookup, citation, Apply/Reject/Undo, Stop, reload and thread switching. Test autocomplete attribution and stale-document handling.
4. Qualify remote fixture branches/index generations, denied integration access and Stripe test mode; then complete the supported release matrix. Its current state is 116 NOT_RUN, two FAIL and two BLOCKED. Do not promote supplemental API checks into full scenario passes.

Plane and Documenso are forks of external projects used as realistic test fixtures. Product fixes belong in Coop AI. Any intentional fixture edits are disposable test changes.

## Local environment and access

The disposable API uses loopback port 28787, Postgres 55432 and the admin portal 13002. See [sandbox instructions](sandbox.md). Provider credentials are outside the repository in protected temporary files; do not commit or print them. Recreate the environment if temporary files or processes disappear. Synthetic plans do not establish real Stripe billing behavior.

The packaged extension is `coop-ai.vsix` in the repository root, ignored by Git; its recorded SHA-256 is `06f564f8d2e18fc01d931b5352b9e8893f11cf31588b9c740a08fc26e5f7fda5`. Rebuild from this source checkpoint if needed. Git does not back up running containers, temporary credentials or ignored build outputs.

The disposable positiveSum source currently retains its intentional loop-bound bug, a renamed accumulator and the intervening test comment. It is test data, not Coop application source.

## Authorization and release

The user authorized this checkpoint commit and branch push. Production backend deployment approval covered the prepared candidate; it is not blanket approval for new deployments. No external integration messages, real charges, production grant changes or Marketplace publication are authorized by this checkpoint. Ask for specific missing access or release authorization only after preparing concrete work.

Saved historical patch snapshots are excluded from the Git checkpoint to avoid duplicating the source tree. They remain in the working directory and the local recovery archive. The source, test code, ledgers and referenced execution evidence are included.
