import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../docs/dogfood/scenarios.json', import.meta.url)), 'utf8'));
const requiredMetadata = ['candidateHead', 'dirtyDiffHash', 'extensionHash', 'webviewHash', 'vsixHash', 'backendDeployment', 'editorVersion', 'platform', 'fixtureEvidence'];
const gates = ['lint', 'test:ci', 'test:agent-ship', 'test:code-citation-locator', 'test:prompt-library', 'test:project-instructions', 'test:chat-response-timing', 'test:request-batcher', 'test:status-transition', 'test:email-template-grounding', 'test:existing-capability', 'test:fim', 'test:repo-grants-ui', 'build:extension-dev', 'surface-builds'];
const expected = manifest.cases.flatMap(c => c.modes.map(mode => ({ id: c.id, mode })));
const [command, path] = process.argv.slice(2);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const evidenceExists = v => {
  if (!nonempty(v)) return false;
  try { const stat = fs.statSync(v); return stat.isFile() && stat.size > 0; }
  catch { return false; }
};
if (!path || !['init', 'check'].includes(command)) {
  console.error('Usage: node scripts/dogfood-release.mjs init|check <ledger.json>');
  process.exit(2);
}
if (command === 'init') {
  const ledger = {
    schemaVersion: 1,
    sourceThread: manifest.sourceThread,
    metadata: Object.fromEntries(requiredMetadata.map(k => [k, ''])),
    automated: gates.map(name => ({ name, status: 'NOT_RUN', evidence: '' })),
    results: expected.map(c => ({ ...c, status: 'NOT_RUN', attempts: [] })),
  };
  fs.writeFileSync(path, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
  console.log(`Created ${expected.length} unscored checks. No live tests executed.`);
} else {
  const ledger = JSON.parse(fs.readFileSync(path, 'utf8'));
  const errors = [];
  if (ledger.schemaVersion !== 1 || ledger.sourceThread !== manifest.sourceThread) errors.push('Ledger schema/source mismatch');
  for (const k of requiredMetadata) if (!nonempty(ledger.metadata?.[k]) || /^(unverified|unknown|unavailable)\b/i.test(ledger.metadata[k])) errors.push(`Missing or unverified metadata: ${k}`);
  if (!/^[a-f0-9]{40}$/i.test(ledger.metadata?.candidateHead ?? '')) errors.push('Invalid candidate HEAD');
  if (!evidenceExists(ledger.metadata?.fixtureEvidence)) errors.push('Fixture evidence file missing or empty');
  for (const k of ['dirtyDiffHash', 'extensionHash', 'webviewHash', 'vsixHash']) {
    if (!/^[a-f0-9]{64}$/i.test(ledger.metadata?.[k] ?? '')) errors.push(`Invalid candidate hash: ${k}`);
  }
  if (/^(unverified|unknown|unavailable)\b/i.test(ledger.metadata?.backendDeployment ?? '')) errors.push('Backend deployment is unverified');
  for (const name of gates) {
    const rows = (ledger.automated ?? []).filter(g => g.name === name);
    if (rows.length !== 1 || rows[0].status !== 'PASS' || !evidenceExists(rows[0].evidence)) errors.push(`Automated gate incomplete: ${name}`);
  }
  const keys = new Set(expected.map(c => `${c.id}/${c.mode}`));
  for (const row of ledger.results ?? []) if (!keys.has(`${row.id}/${row.mode}`)) errors.push(`Unknown result: ${row.id}/${row.mode}`);
  for (const c of expected) {
    const key = `${c.id}/${c.mode}`;
    const rows = (ledger.results ?? []).filter(r => r.id === c.id && r.mode === c.mode);
    if (rows.length !== 1) { errors.push(`Missing or duplicate: ${key}`); continue; }
    const row = rows[0];
    const attempt = row.attempts?.at(-1);
    if (row.status !== 'PASS' || attempt?.status !== 'PASS') { errors.push(`Live check incomplete: ${key} (${row.status})`); continue; }
    for (const field of ['timestamp', 'candidateExtensionHash', 'candidateWebviewHash', 'candidateVsixHash', 'backendDeployment', 'accountTierOrg', 'repoRef', 'actualAction', 'actualResult', 'evidence', 'criteriaReview', 'reviewer', 'threadId', 'turnId', 'runId']) {
      if (!nonempty(attempt[field])) errors.push(`${key}: missing ${field}`);
    }
    if (attempt.candidateExtensionHash !== ledger.metadata.extensionHash || attempt.candidateWebviewHash !== ledger.metadata.webviewHash || attempt.candidateVsixHash !== ledger.metadata.vsixHash || attempt.backendDeployment !== ledger.metadata.backendDeployment) errors.push(`${key}: stale candidate`);
    if (attempt.criteriaReview !== 'ALL_MET') errors.push(`${key}: criteria not confirmed`);
    if (!evidenceExists(attempt.evidence)) errors.push(`${key}: evidence file missing or empty`);
    if (!['answer', 'ui-operation'].includes(attempt.timingKind)) errors.push(`${key}: missing timing kind`);
    if (!Number.isFinite(attempt.durationMs) || attempt.durationMs < 0) errors.push(`${key}: invalid duration`);
    if (attempt.timingKind === 'answer') {
      if (!nonempty(attempt.firstMeaningfulAnswer) || !Number.isFinite(attempt.firstAnswerMs) || attempt.firstAnswerMs < 0 || attempt.durationMs < attempt.firstAnswerMs) errors.push(`${key}: incomplete answer timing`);
      if (attempt.firstAnswerMs > 15000) errors.push(`${key}: answer-start latency exceeded 15 seconds`);
    } else if (attempt.firstAnswerMs != null) errors.push(`${key}: UI-operation cannot substitute answer timing`);
  }
  if (errors.length) {
    console.error(`Release evidence incomplete: ${errors.length} issues\n${errors.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Recorded release criteria complete: ${expected.length} checks. This validates the ledger; inspect linked evidence before declaring live Pass.`);
}
