import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const runner = path.resolve('scripts/dogfood-release.mjs');
test('release gate rejects skipped checks, stale builds, duplicate rows and unsupported pass claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-dogfood-gate-'));
  const file = path.join(dir, 'run.json');
  const run = cmd => spawnSync(process.execPath, [runner, cmd, file], { encoding: 'utf8' });
  try {
    assert.equal(run('init').status, 0);
    assert.notEqual(run('init').status, 0, 'must not overwrite existing evidence');
    assert.equal(run('check').status, 1, 'unexecuted suite cannot pass');
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    const evidence = path.join(dir, 'synthetic-evidence.txt');
    fs.writeFileSync(evidence, 'Synthetic checker fixture only. Not a live application pass.\n');
    for (const k of Object.keys(ledger.metadata)) ledger.metadata[k] = 'synthetic-checker-fixture';
    for (const k of ['dirtyDiffHash', 'extensionHash', 'webviewHash', 'vsixHash']) ledger.metadata[k] = 'a'.repeat(64);
    ledger.metadata.candidateHead = 'a'.repeat(40);
    ledger.metadata.fixtureEvidence = evidence;
    for (const gate of ledger.automated) Object.assign(gate, { status: 'PASS', evidence });
    for (const row of ledger.results) {
      row.status = 'PASS';
      row.attempts = [{ status: 'PASS', timestamp: '2026-10-03', candidateExtensionHash: ledger.metadata.extensionHash, candidateWebviewHash: ledger.metadata.webviewHash, candidateVsixHash: ledger.metadata.vsixHash, backendDeployment: ledger.metadata.backendDeployment, accountTierOrg: 'sandbox', repoRef: 'fixture@sha', actualAction: 'synthetic checker test', actualResult: 'synthetic checker test only', evidence, criteriaReview: 'ALL_MET', reviewer: 'checker unit test', threadId: 'thread', turnId: 'turn', runId: 'run', timingKind: 'answer', firstMeaningfulAnswer: 'synthetic answer', firstAnswerMs: 100, durationMs: 200 }];
    }
    const save = () => fs.writeFileSync(file, JSON.stringify(ledger));
    save(); assert.equal(run('check').status, 0);
    const attempt = ledger.results[0].attempts[0];
    for (const [field, invalid] of [['actualAction', ''], ['turnId', ''], ['runId', ''], ['candidateWebviewHash', 'b'.repeat(64)], ['candidateVsixHash', 'b'.repeat(64)], ['firstAnswerMs', null], ['firstMeaningfulAnswer', ''], ['timingKind', 'spinner']]) {
      const original = attempt[field];
      attempt[field] = invalid;
      save(); assert.equal(run('check').status, 1, field);
      attempt[field] = original;
    }
    fs.writeFileSync(evidence, '');
    save(); assert.equal(run('check').status, 1, 'empty evidence cannot pass');
    fs.writeFileSync(evidence, 'Synthetic checker evidence only.');
    ledger.results[0].attempts.unshift({ status: 'FAIL', actualResult: 'retained earlier failure' });
    save(); assert.equal(run('check').status, 0, 'retest preserves failed attempt');
    attempt.evidence = path.join(dir, 'missing.txt');
    save(); assert.equal(run('check').status, 1, 'a label is not captured evidence');
    attempt.evidence = evidence;
    ledger.metadata.backendDeployment = 'UNVERIFIED: production';
    save(); assert.equal(run('check').status, 1, 'unknown deployment cannot certify readiness');
    ledger.metadata.backendDeployment = 'synthetic-checker-fixture';
    attempt.candidateExtensionHash = 'stale';
    save(); assert.equal(run('check').status, 1);
    attempt.candidateExtensionHash = ledger.metadata.extensionHash;
    ledger.results.push(ledger.results[0]);
    save(); assert.equal(run('check').status, 1);
    ledger.results.pop();
    attempt.criteriaReview = 'LOOKED_FINE';
    save(); assert.equal(run('check').status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
