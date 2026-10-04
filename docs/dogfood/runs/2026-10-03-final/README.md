# Candidate remediation run — 2026-10-03

This run records the repaired development candidate and final local gates. It does not certify production readiness: the exact VSIX installed into an isolated extension directory, but a clean-profile Extension Host window did not appear; the reloaded development host also exposed no indexed repositories for live repo scenarios.

## Candidate

- Source HEAD: `c7796ed10c8bcc5cd2848d44b0bab6eb283684fc`; working tree remains dirty and preserved.
- Dirty working-tree identity SHA-256: `e3bb8080f24ad744821dfa42d54898ad36db8002a4a518625545f6309ddab41d` (tracked and untracked paths/content; this run directory excluded to avoid self-reference).
- Extension bundle SHA-256: `5c9e57a1c820e994450ae630d5b7e53d05b12cc18c387c041292c49ed7228d06`.
- Webview JavaScript SHA-256: `f4b581c38087fe272ec5fe2dc0fc2f69bab87475307c4ad166c2559abdb79f0e`.
- Webview CSS SHA-256: `7fe0c091395e717db3a9ebcdf557ab516423a365cfaa94ed86451f3cd4a7d2bc`.
- Packaged VSIX SHA-256: `d255f8007808b1ddb3c721a35e9847a02fe8bd1f2a3c65ae31289e7a75679d1a`.
- Read-only production health endpoint reported backend commit `c7796ed10c8b`; no deployment was performed.
- Local environment: VS Code 1.139.1 (`04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`, arm64), macOS 26.6.2 build 25G83.

## Automated and build results

`lint`, `test:ci`, `test:agent-ship`, the separately required release suites, `build:extension-dev`, the root extension/webview/backend/worker/admin build, the website/admin/ops Next.js builds, and `npm run package` completed successfully. Their logs are in `evidence/`. The full dogfood ledger retains all 120 scenario/mode rows: 118 `NOT_RUN` and 2 `BLOCKED`. Prior run statuses and attempts are preserved under `priorCandidateHistory` with stale hashes; they do not carry forward as current passes. DF-044 and DF-074 record their exact prerequisites.

Source repairs and regression coverage are described in `../2026-10-03-remediation/` evidence and in the current working-tree diff. Automated success means **Automated Pass** only; affected live claims remain open.

## Live limitation and provider restoration

The Extension Host's Remote workspace picker stated “No repositories found. Connect GitHub in Settings.” The local fixture could be opened, but Coop produced no visible suggestion when `CoopAI: Trigger Inline Autocomplete` ran. Therefore provider provenance is unverified. The user had explicitly approved temporarily disabling Copilot; only the workspace `github.copilot.enable` override was changed, then removed. The workspace JSON was restored exactly to its prior contents; user-level settings were untouched. See [`evidence/live-host-observations.json`](evidence/live-host-observations.json).

The run is not release-certified. Missing live prerequisites include the signed-in account/org/tier and remote indexed fixture refs, clean-profile package activation, and the remaining scenario-specific fixtures/accounts/fault controls.
