import assert from "node:assert/strict";
import {
  buildEmailTemplateSynthesisUserPrompt,
  extractEmailTemplateRefsFromSource,
  extractHandlerFollowCandidates,
  extractTriggeredJobNames,
  handlerPathsForTriggeredJob,
  isEmailTemplateTicketAsk,
  matchEmailTemplatesInTree,
  resolveEmailTemplateCandidates
} from "./emailTemplateGrounding";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

/** Mirrors documenso send-signing-reminders-sweep.ts */
const SWEEP_JOB_DEF = `
import { z } from 'zod';
import type { JobDefinition } from '../../client/_internal/job';

const SEND_SIGNING_REMINDERS_SWEEP_JOB_DEFINITION_ID = 'internal.send-signing-reminders-sweep';

export const SEND_SIGNING_REMINDERS_SWEEP_JOB_DEFINITION = {
  id: SEND_SIGNING_REMINDERS_SWEEP_JOB_DEFINITION_ID,
  name: 'Send Signing Reminders Sweep',
  version: '1.0.0',
  trigger: {
    name: SEND_SIGNING_REMINDERS_SWEEP_JOB_DEFINITION_ID,
    schema: z.object({}),
    cron: '*/15 * * * *',
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./send-signing-reminders-sweep.handler');
    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition;
`.trim();

/** Mirrors documenso send-signing-reminders-sweep.handler.ts (triggers process job). */
const SWEEP_HANDLER = `
import { jobs } from '../../client';
import type { JobRunIO } from '../../client/_internal/job';

export const run = async ({ io }: { payload: unknown; io: JobRunIO }) => {
  await jobs.triggerJob({
    name: 'internal.process-signing-reminder',
    payload: { recipientId: 'r1' },
  });
};
`.trim();

/** Mirrors process-signing-reminder.handler.ts email import. */
const PROCESS_HANDLER = `
import DocumentReminderEmailTemplate from '@documenso/email/templates/document-reminder';
import { createElement } from 'react';

export const run = async () => {
  const element = createElement(DocumentReminderEmailTemplate, {});
  return element;
};
`.trim();

const DOCUMENSO_TREE = [
  "packages/email/templates/document-reminder.tsx",
  "packages/email/templates/document-invite.tsx",
  "packages/email/templates/recipient-expired.tsx",
  "packages/email/template-components/template-document-reminder.tsx",
  "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts",
  "apps/remix/app/routes/_index.tsx"
];

test("isEmailTemplateTicketAsk detects jobs + email templates", () => {
  assert.equal(
    isEmailTemplateTicketAsk(
      "Where do scheduled jobs and email templates live, and how should this hook into the existing reminder sweep?"
    ),
    true
  );
  assert.equal(
    isEmailTemplateTicketAsk("Add a 24h expiry reminder email using the signing reminder sweep"),
    true
  );
});

test("isEmailTemplateTicketAsk does not steal A10 existing-capability tickets", () => {
  assert.equal(
    isEmailTemplateTicketAsk(
      "We're adding a blocked_by link type — where should validation live and which existing types should we mirror?"
    ),
    false
  );
  assert.equal(isEmailTemplateTicketAsk("Who owns this file?"), false);
});

test("extractHandlerFollowCandidates resolves dynamic handler import", () => {
  const paths = extractHandlerFollowCandidates(
    "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts",
    SWEEP_JOB_DEF
  );
  assert.ok(
    paths.some((p) => p.endsWith("send-signing-reminders-sweep.handler.ts")),
    `expected handler path, got ${paths.join(", ")}`
  );
});

test("extractTriggeredJobNames + handlerPathsForTriggeredJob", () => {
  const jobs = extractTriggeredJobNames(SWEEP_HANDLER);
  assert.deepEqual(jobs, ["internal.process-signing-reminder"]);
  const paths = handlerPathsForTriggeredJob(
    "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.handler.ts",
    "internal.process-signing-reminder"
  );
  assert.ok(paths.some((p) => p.endsWith("process-signing-reminder.handler.ts")));
});

test("extractEmailTemplateRefsFromSource maps package import to packages/email path", () => {
  const refs = extractEmailTemplateRefsFromSource(PROCESS_HANDLER, {
    sourcePath: "packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts"
  });
  assert.ok(
    refs.some((r) => r.path === "packages/email/templates/document-reminder.tsx"),
    `expected document-reminder template, got ${refs.map((r) => r.path).join(", ")}`
  );
});

test("resolveEmailTemplateCandidates returns concrete template from followed handler", () => {
  const resolution = resolveEmailTemplateCandidates({
    openFilePath: "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts",
    openFileContent: SWEEP_JOB_DEF,
    followedFiles: [
      {
        path: "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.handler.ts",
        content: SWEEP_HANDLER,
        reason: "dynamic import from job definition"
      },
      {
        path: "packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts",
        content: PROCESS_HANDLER,
        reason: "triggered job internal.process-signing-reminder"
      }
    ],
    treePaths: DOCUMENSO_TREE,
    ask: "Where do scheduled jobs and email templates live for a 24h expiry reminder?"
  });

  assert.ok(
    resolution.templates.some((t) => t.path === "packages/email/templates/document-reminder.tsx"),
    `expected document-reminder, got ${resolution.templates.map((t) => t.path).join(", ")}`
  );
  assert.equal(resolution.notFoundMessage, undefined);
  assert.ok(resolution.triggeredJobs.includes("internal.process-signing-reminder"));

  const prompt = buildEmailTemplateSynthesisUserPrompt({
    ask: "Where do scheduled jobs and email templates live?",
    resolution
  });
  assert.match(prompt, /packages\/email\/templates\/document-reminder\.tsx/);
  assert.match(
    prompt,
    /email_templates:\n- `packages\/email\/templates\/document-reminder\.tsx`/
  );
  assert.doesNotMatch(prompt, /email_templates:\n- NOT FOUND/i);
});

test("resolveEmailTemplateCandidates with tree-only still names reminder templates", () => {
  const resolution = resolveEmailTemplateCandidates({
    openFilePath: "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts",
    openFileContent: SWEEP_JOB_DEF,
    followedFiles: [],
    treePaths: DOCUMENSO_TREE,
    ask: "24h expiry reminder email templates"
  });
  assert.ok(
    resolution.templates.some((t) => /document-reminder|recipient-expired/i.test(t.path)),
    `expected reminder/expiry templates, got ${resolution.templates.map((t) => t.path).join(", ")}`
  );
  assert.ok(!resolution.templates.some((t) => t.path.includes("document-invite")));
});

test("fixture with no templates → explicit not-found, not go-search", () => {
  const resolution = resolveEmailTemplateCandidates({
    openFilePath: "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts",
    openFileContent: SWEEP_JOB_DEF,
    followedFiles: [
      {
        path: "packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.handler.ts",
        content: "// no email imports\nexport const run = async () => {};",
        reason: "handler without templates"
      }
    ],
    treePaths: ["packages/lib/jobs/definitions/internal/send-signing-reminders-sweep.ts"],
    ask: "Where do email templates for reminders live?"
  });

  assert.equal(resolution.templates.length, 0);
  assert.ok(resolution.notFoundMessage);
  assert.match(resolution.notFoundMessage!, /not found/i);
  assert.doesNotMatch(
    resolution.notFoundMessage!,
    /\byou should search\b|\bgo search\b|\bplease search\b/i
  );

  const prompt = buildEmailTemplateSynthesisUserPrompt({
    ask: "Where are the email templates?",
    resolution
  });
  assert.match(prompt, /email_templates:\n- NOT FOUND/i);
  assert.match(prompt, /No email template paths found after following/i);
});

test("matchEmailTemplatesInTree ranks reminder over invite for reminder asks", () => {
  const hits = matchEmailTemplatesInTree(DOCUMENSO_TREE, "signing reminder email template");
  assert.ok(hits.some((h) => h.path.includes("document-reminder")));
  assert.ok(!hits.some((h) => h.path.includes("document-invite")));
});

console.log(`\nemailTemplateGrounding: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
