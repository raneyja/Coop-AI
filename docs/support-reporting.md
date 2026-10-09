# Support reports

The website guide is `website/content/docs/reporting-bugs.md`, published at
`https://coop-ai.dev/docs/reporting-bugs` in the existing Help navigation, docs
search, and sitemap. This repository's marketing site lives in `website/`.

## Research and implementation choices

[Amp’s reporting guide](https://ampcode.com/docs/support/reporting-bugs) uses an
in-app submission with diagnostic data, direct delivery to its team, and seven-day
diagnostic retention. Coop uses that interaction pattern with an explicit preview
and optional version/platform metadata. It does not collect conversations, logs,
settings, or repository files. Adding those requires a separate reviewable,
redacted attachment flow; the current form does not support screenshots.

The backend reuses PostgreSQL, user/org authentication, operator RBAC, and
`EmailService` with Resend. Notifications contain the report summary, reporter
email, report ID, a preview of up to 1,200 characters of the submitted description,
and a link to the authenticated ops report. Both HTML and plain text include the
preview; long descriptions show a shortened-preview notice. HTML escapes all
submitted content. Optional diagnostics and internal notes stay in ops, and
email previews follow mailbox retention rather than diagnostic expiry.
[Resend supports idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys),
so retry attempts use a stable key. No new email vendor or public unauthenticated
submission service is needed. Users unable to sign in use the existing support
mailbox; incoming mailbox messages are not automatically imported into ops.

## Data and API

Migration `032_support_reports.sql` adds reports and triage events. Submission
requires an authenticated organization and is independent of LLM quota. Database
locks enforce ten new reports per principal per hour across replicas, and a
client submission UUID deduplicates retries. The server validates field limits
and persists only allowlisted diagnostic fields.

- `POST /v1/support/reports`: create or recover a submission receipt.
- `GET /v1/operator/support/reports?status=open&offset=0`: 50-item pages.
- `GET /v1/operator/support/reports/:id`: description, unexpired diagnostics, history.
- `PATCH /v1/operator/support/reports/:id`: status, assignee, internal note, optimistic concurrency revision.
- `POST /v1/operator/support/reports/:id/retry-notification`: retry failed/mocked team email.

Operator endpoints require support, billing, or super-admin access. Triage writes
the event and operator audit record in the same transaction. Statuses are open,
in progress, and resolved; moving a resolved report back reopens it. Operators
can assign a report to themselves or unassign it. API assignments must reference
an active operator with support access. Internal notes do not send customer email.

The API process runs inbox maintenance every 30 seconds. PostgreSQL leases with
`SKIP LOCKED` coordinate notification workers. Reports remain saved if email fails.
Delivery retries with backoff up to eight attempts; the inbox displays pending,
sent, failed, or mocked status. “Sent” means accepted by Resend, not delivered to
the recipient; delivery webhooks are not implemented. A crash may replay email
after the provider's idempotency window, so absolute exactly-once delivery is not
claimed. Diagnostic reads hide expired metadata immediately; maintenance clears
the stored metadata. Database backups follow existing backup retention.

## Rollout

1. **Terminal — backend deployment:** deploy the API with migration 032. Railway’s
   existing pre-deploy command applies migrations. For local existing Docker
   databases, apply migration 032 before restarting the API:

   ```sh
   docker compose exec -T postgres psql -U coop -d coopai < migrations/032_support_reports.sql
   ```
2. **Railway Variables — API service:** reuse the configured `RESEND_API_KEY` and
   `EMAIL_FROM`. Confirm `COOP_EMAIL_MOCK=false` for real delivery. The Resend key
   comes from the Resend dashboard; the From domain must be verified there. Optional:
   add `COOP_SUPPORT_NOTIFICATION_EMAIL` if the destination differs from
   `support@coop-ai.dev`. The ops link uses the existing `COOP_OPS_PORTAL_URL`.
3. **Browser — ops deployment:** deploy `ops/` using `docs/deploy-ops-portal.md`.
   Sign in as a support-capable operator and open `/support`.
4. **Extension UI — VS Code:** reload the built development extension, sign in,
   open **CoopAI: Report an Issue**, and submit a sample with diagnostics off.
   The receipt must correspond to a report in ops. Repeat with diagnostics on,
   assign the report, add a note, resolve it, then reopen it.
5. **Browser — website deployment:** publish `website/` through its existing
   deployment. Check `/docs/reporting-bugs`, Help navigation, and docs search.
   Keep the guide's availability notice aligned with the actual extension
   distribution. The 0.1.13 development build is packaged locally; Marketplace
   publication is a separate release action.

For local backend configuration, add the optional destination to the gitignored
root `.env.backend`; `.env.backend.example` documents the variable only. Do not
create a second Resend key just for support.

## Validation scope

Targeted tests cover submission validation, authentication, role restrictions,
retry receipts, rate-limit responses, input bounds, and notification failure handling.
Database integration tests cover migration, deduplication, quota, triage conflict,
audit/history, notification claiming, and expiration when a test database is supplied.
Extension, backend, website, and ops builds are required before release. Live Extension Host submission and production ops triage were also verified
for this release. Mailbox arrival requires the recipient to check the inbox.

Validation on 2026-10-08: **Automated Pass + live Extension Host Pass**.
Root lint, the complete `test:ci` suite, support PostgreSQL integration tests,
backend/ops/website builds, and VSIX packaging passed. The new support UI was
verified in the signed-in Extension Development Host through both the command
palette and Settings entry points.

Production verification:

- API deployment `be1d4233-90d4-4669-b3b4-e737a34de501` applied migration 032;
  restart deployment `0c597b51-92a6-4636-b1a0-e6f996675ede` succeeded and
  picked up `COOP_BUILD_SHA=support-0300d67496ef`.
  This identifies the source snapshot digest, not a Git commit.
- Website deployment `dpl_5XmTyoLAhfXtqfXQof8UDt83qTkg` is live at
  `https://coop-ai.dev/docs/reporting-bugs`; Help navigation and docs search passed.
- Ops deployment `dpl_2zN64Cja1SHZVsZYgfG7JaiTP69a` is live at
  `https://ops.coop-ai.dev/support`.
- Report `ae8f8090-79e8-43e8-bb7d-287bd1192392` was submitted from VS Code
  with diagnostics off. Its matching receipt, absence of diagnostics,
  assignment, note, resolution, reopen, and persistence after reload passed.
- Report `169e6708-f32b-4ba6-ba8a-8fd0b54a3196` was submitted with diagnostics
  on. Ops showed exactly the four preview values and a seven-day expiry.
  Both verification reports are resolved.
- Both emails to `support@coop-ai.dev` reached `sent` after one attempt.
  Resend accepted the sends. The existing send-only key rejects delivery-state
  reads (`restricted_api_key`), so actual mailbox arrival is not claimed.
- The development VSIX is `/Users/jonraney/Coop-AI/coop-ai.vsix` (0.1.13).
  This task has not published a Marketplace release.

The final source snapshot was assembled from tracked repository files plus the
support feature's new files, excluding local env files, credentials, and build
caches. Existing 0.1.13 version/build changes were preserved. Source digest for
the API/ops candidate: `0300d67496ef8097978aef04b9d0b6e178cb462cb690577b3b1e97d525330b16`.

## Email content preview — 2026-10-08

The recipient confirmed the original link-only email arrived. At their request,
notifications now include the summary, reporter email, report ID, and up to
1,200 Unicode characters of submitted details. Short reports appear in full;
long reports include a notice and retain the full description in ops. The support
footer identifies the message as an ops notification.

Support tests cover the worker forwarding saved content, HTML escaping, line
breaks, Unicode truncation, plain-text parity, private/localhost URLs as inert
report text, safe generated links, and mock logs excluding report content.
PostgreSQL integration tests verify the claim returns the saved fields. Support
tests, billing email regressions, lint, and backend build passed.

A fresh report was submitted from VS Code:
`367e4fd6-eebe-450d-ade8-8d6d29c40446`, titled
“Email content preview — test for Jon,” with reproduction steps and
expected/actual results. This report remains open for recipient confirmation.

Notification for that report was accepted by Resend on the first attempt and
ops shows `sent`. The final email-preview deployment is
`96913209-585c-4be4-8f15-d853faf205ad`; the health probe reports
`email-48168d`. Runtime/test source digest:
`48168d433b595c93573dbec9e4b468c349fd1a742021a989b24e8b8f3fc5722c`.
The recipient's view of this new preview email remains their confirmation step.

## Confirmation and guide screenshot — 2026-10-09

Jon confirmed the reporting function works as intended. The supplied VS Code
screenshot was added immediately below the availability notice in the guide.
Website deployment `dpl_DbmKzoKwsTtBaSA1GRgucgbrtH7X` is live; the image loads
at `/screenshots/docs/extension-report-issue.png` and its placement was visually
verified on the published page.

The support source changes are isolated from the unrelated development-branch
history when shipping to main. The existing main extension release version is
preserved; the already verified 0.1.13 development VSIX remains a separate
build, as stated in the guide.
