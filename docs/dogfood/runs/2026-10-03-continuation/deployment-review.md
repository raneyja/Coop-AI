# Approved backend deployment

The remaining Plane retrieval test reaches the correct repository and branch, but production returns a 4,616-file map without `indexedBranch`. The extension correctly refuses to certify that map. The saved run is `7b0ea2a0-8936-4f6e-a846-c2d2769c80ea`; see `evidence/plane-capability-retest.jsonl` and the pinned-source oracle in `evidence/plane-parent-oracle.json`.

The prepared backend supplies branch/commit provenance on indexed maps, validates legacy maps against durable inventory, and supports the cloud content-search contract. Backend source also includes the prior remediation changes and the exact-output prompt correction tested in the disposable API. This is the current backend candidate, not a provenance-only cherry-pick. The production Dockerfile builds backend/worker/admin bundles; it does not publish the extension or website.

Upload directory: `/private/tmp/coop-dogfood-backend-candidate`. Its 1,169-file manifest has SHA-256 `67dbf52bb0b835880bdd125392f3fec253c69581c95c4fa6e7c89896dab70835`. See `evidence/backend-upload-manifest.json` and `evidence/backend-provenance.diff`. No environment files or credentials are in this upload. SQL migration files are unchanged; the unrelated untracked Markdown migration file is excluded.

Target: Railway project `CoopAI_Playwrite_Project`, service `Coop-AI`, environment `production`, API `https://api.coop-ai.dev`. Existing service variables remain configured in Railway. Fresh Railway status confirms active deployment `5eb49c1f-a891-46d6-ad7d-3c3df4360c0c`, with a running instance. The recorded production commit is `c7796ed10c8bcc5cd2848d44b0bab6eb283684fc`.

Before deployment, confirm the exact previous successful deployment ID and snapshot manifest. After deployment, verify health, producer branch/commit fields, and repeat the failed source lookup and affected cold/warm/repository-switch tests. Roll back to the confirmed previous successful deployment if health or isolation regresses. No connector grant changes, external messages, real charges, commits, or pushes are included.

Validation: lint, extension/backend/package build, full `test:ci`, `test:agent-ship`, ten required focused gates, website/admin/ops builds, and disposable API authentication/quota/fault tests passed. The final model SSE retest passed in 2,401 ms. Exact package installation and official Extension Host activation pass; the complete interactive clean-profile matrix remains unexecuted.

The user separately approved deployment. The verified snapshot was deployed as `a9fd94df-f99c-4be5-adaf-f6cd269c6322`; Railway reports SUCCESS, migrations completed, and production health returns `ok: true`. The health commit is `unknown` for this uploaded snapshot, so provenance is recorded using the manifest and Railway deployment identity. See [verification](evidence/deployment-approved-verification.json). The post-deployment Plane lookup still fails and is not certified.
