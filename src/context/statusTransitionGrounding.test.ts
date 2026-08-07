import assert from "node:assert/strict";
import {
  buildStatusTransitionSynthesisUserPrompt,
  enrichStatusTransitionResponse,
  extractStatusTransitionEvidence,
  formatStatusTransitionEvidenceBlock,
  isStatusTransitionAsk,
  parseAskedStatusTransition,
  shapedEvidenceClaimsInFileCompletedWrite,
  shapedEvidenceMentionsWritePath,
  statusTransitionGatherQuery
} from "./statusTransitionGrounding";

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

/** Minimal fixture mirroring documenso complete-document-with-token.ts shape. */
const COMPLETE_DOCUMENT_WITH_SEAL = `
import { DocumentStatus, SigningStatus } from '@prisma/client';
import { jobs } from '../../jobs/client';

export const completeDocumentWithToken = async ({ token, id }) => {
  const envelope = await prisma.envelope.findFirstOrThrow({ where: { id } });

  if (envelope.status !== DocumentStatus.PENDING) {
    throw new Error(\`Document \${envelope.id} must be pending\`);
  }

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw new Error(\`Recipient \${recipient.id} has already signed\`);
  }

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    throw new Error('Recipient has already rejected the document');
  }

  await prisma.recipient.update({
    where: { id: recipient.id },
    data: {
      signingStatus: SigningStatus.SIGNED,
      signedAt: new Date(),
    },
  });

  const pendingRecipients = await prisma.recipient.findMany({
    where: {
      envelopeId: envelope.id,
      signingStatus: { not: SigningStatus.SIGNED },
    },
  });

  if (pendingRecipients.length > 0) {
    await jobs.triggerJob({
      name: 'send.document.pending.email',
      payload: { envelopeId: envelope.id },
    });
  }

  const haveAllRecipientsSigned = await prisma.envelope.findFirst({
    where: {
      id: envelope.id,
      recipients: {
        every: {
          OR: [{ signingStatus: SigningStatus.SIGNED }, { role: 'CC' }],
        },
      },
    },
  });

  if (haveAllRecipientsSigned) {
    await jobs.triggerJob({
      name: 'internal.seal-document',
      payload: {
        documentId: legacyDocumentId,
      },
    });
  }
};
`.trim();

const THROWS_ONLY_FIXTURE = `
import { DocumentStatus, SigningStatus } from '@prisma/client';

export async function completeDocumentWithToken() {
  if (envelope.status !== DocumentStatus.PENDING) {
    throw new Error('Document must be pending');
  }
  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw new Error('Recipient has already signed');
  }
  if (!isRecipientsTurn) {
    throw new Error('Recipient attempted to complete before it was their turn');
  }
  // No job trigger and no DocumentStatus.COMPLETED write in this file.
}
`.trim();

const SEAL_HANDLER_WITH_COMPLETED = `
import { DocumentStatus } from '@prisma/client';

export async function run() {
  const finalEnvelopeStatus = DocumentStatus.COMPLETED;
  await prisma.envelope.update({
    where: { id: envelope.id },
    data: {
      status: finalEnvelopeStatus,
    },
  });
}
`.trim();

test("isStatusTransitionAsk detects stuck PENDING / where status moves", () => {
  assert.equal(
    isStatusTransitionAsk(
      "customers stuck PENDING — where does status move to COMPLETED?"
    ),
    true
  );
  assert.equal(
    isStatusTransitionAsk("where does DocumentStatus move from PENDING to COMPLETED"),
    true
  );
  assert.equal(isStatusTransitionAsk("explain this function briefly"), false);
  assert.equal(isStatusTransitionAsk("hi"), false);
});

test("A9 incident ask is not stolen by status-transition via 'still open'", () => {
  const ask =
    "Last week’s webhook delivery failures — what Jira tickets and Slack threads are related, which code paths handle retries/monitoring, and what’s still open?";
  assert.equal(isStatusTransitionAsk(ask), false);
});

test("incident + clear PENDING→COMPLETED still counts as status-transition", () => {
  assert.equal(
    isStatusTransitionAsk(
      "incident: documents stuck PENDING — where does status move to COMPLETED?"
    ),
    true
  );
});

test("parseAskedStatusTransition reads PENDING→COMPLETED", () => {
  const parsed = parseAskedStatusTransition(
    "stuck PENDING / where status moves to COMPLETED"
  );
  assert.equal(parsed.fromStatus, "PENDING");
  assert.equal(parsed.toStatus, "COMPLETED");
});

test("fixture with seal-document job → shaped output names that write path", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "customers stuck PENDING — where does status move to COMPLETED?"
  });

  assert.ok(
    evidence.jobTriggers.some((j) => j.name === "internal.seal-document"),
    `jobs=${JSON.stringify(evidence.jobTriggers)}`
  );
  assert.ok(
    evidence.writePaths.some(
      (w) => w.jobName === "internal.seal-document" && w.advancesAskedToStatus
    ),
    `writes=${JSON.stringify(evidence.writePaths)}`
  );

  const shaped = formatStatusTransitionEvidenceBlock(evidence);
  assert.ok(
    shapedEvidenceMentionsWritePath(shaped, "internal.seal-document"),
    "shaped evidence must name internal.seal-document"
  );
  assert.match(shaped, /Next-status WRITE path/i);
  assert.match(shaped, /DocumentStatus/);
  assert.match(shaped, /SigningStatus/);
  assert.match(shaped, /Hard errors that abort THIS completion attempt/i);
  assert.match(shaped, /still legitimately PENDING|Waiting:/i);

  const prompt = buildStatusTransitionSynthesisUserPrompt({
    ask: "customers stuck PENDING — where does status move to COMPLETED?",
    evidence
  });
  assert.ok(shapedEvidenceMentionsWritePath(prompt, "internal.seal-document"));
  assert.match(prompt, /Status-transition answer contract/i);
});

test("fixture with only throws → must not claim COMPLETED was written in-file", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: THROWS_ONLY_FIXTURE,
    ask: "stuck PENDING where status moves to COMPLETED"
  });

  assert.equal(evidence.jobTriggers.length, 0);
  assert.ok(evidence.hardAborts.length >= 2);
  assert.equal(
    evidence.writePaths.filter((w) => w.advancesAskedToStatus).length,
    0
  );

  const shaped = formatStatusTransitionEvidenceBlock(evidence);
  assert.equal(shapedEvidenceMentionsWritePath(shaped, "internal.seal-document"), false);
  assert.equal(shapedEvidenceClaimsInFileCompletedWrite(shaped), false);
  assert.match(shaped, /No status write or job trigger|No in-file write of COMPLETED/i);
  assert.ok(
    evidence.gaps.some((g) => /COMPLETED/i.test(g) && /not found|do not claim/i.test(g)),
    `gaps=${JSON.stringify(evidence.gaps)}`
  );
});

test("separates hard aborts from waiting-on-next-signer paths", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "PENDING → COMPLETED"
  });
  assert.ok(evidence.hardAborts.some((h) => /already SIGNED|must be PENDING/i.test(h.summary)));
  assert.ok(evidence.waitingPaths.some((h) => /PENDING|unsigned|Waiting/i.test(h.summary)));
});

test("clarifies recipient SigningStatus vs envelope DocumentStatus", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "PENDING to COMPLETED"
  });
  const roles = new Set(evidence.statusTypes.map((t) => t.role));
  assert.ok(roles.has("envelope"));
  assert.ok(roles.has("recipient"));

  const shaped = formatStatusTransitionEvidenceBlock(evidence);
  assert.match(shaped, /Status type distinction/i);
  assert.match(shaped, /recipient SIGNED as envelope COMPLETED/i);
});

test("statusTransitionGatherQuery prefers seal-document job name", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "PENDING → COMPLETED"
  });
  const query = statusTransitionGatherQuery(evidence);
  assert.ok(query);
  assert.match(query!, /internal\.seal-document|seal-document/);
});

test("followed seal handler can add direct COMPLETED write without inventing it in open file", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "PENDING → COMPLETED",
    followedFiles: [
      {
        path: "packages/lib/jobs/definitions/internal/seal-document.handler.ts",
        content: SEAL_HANDLER_WITH_COMPLETED
      }
    ]
  });
  assert.ok(
    evidence.writePaths.some(
      (w) => w.kind === "direct-write" && /COMPLETED/i.test(w.value)
    )
  );
  const shaped = formatStatusTransitionEvidenceBlock(evidence);
  assert.ok(shapedEvidenceMentionsWritePath(shaped, "internal.seal-document"));
});

test("enrichStatusTransitionResponse injects seal job and enum distinction", () => {
  const evidence = extractStatusTransitionEvidence({
    filePath: "packages/lib/server-only/document/complete-document-with-token.ts",
    fileContent: COMPLETE_DOCUMENT_WITH_SEAL,
    ask: "Customers report documents stuck in PENDING — where does status move to COMPLETED?"
  });
  const throwsOnly =
    "**Answer**\nDocuments stay PENDING when fields are missing or auth fails. See the throw gates above.";
  const enriched = enrichStatusTransitionResponse(throwsOnly, evidence);
  assert.ok(enriched.includes("internal.seal-document"));
  assert.ok(enriched.includes("SigningStatus"));
  assert.ok(enriched.includes("DocumentStatus"));
});

console.log(`\nstatusTransitionGrounding: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
