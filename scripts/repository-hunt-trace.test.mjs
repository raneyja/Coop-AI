import assert from 'node:assert/strict';
import { summarizeTrace, firstDivergence } from './repository-hunt-trace.mjs';
const events = [
  { runId: 'run-one', threadId: 'one', stage: 'target', repoId: 'gitlab:org/repo', resolvedBranch: 'preview', bundleId: 'bundle' },
  { runId: 'run-one', threadId: 'one', stage: 'index-search', query: 'validate_parent', hits: [{path: 'server/task.py'}], elapsedMs: 20 },
  { runId: 'run-one', threadId: 'one', stage: 'candidate', status: 'ruled-out' },
  { runId: 'run-one', threadId: 'one', stage: 'outcome', hasAnswer: true }
];
const encode = values => values.map(value => JSON.stringify(value)).join('\n');
const left = summarizeTrace(encode(events))[0];
const warm = summarizeTrace(encode(events.map(e => ({...e, elapsedMs: 1}))))[0];
assert.equal(firstDivergence(left, warm), null, 'Timing changes alone must not masquerade as retrieval divergence');
const changed = structuredClone(warm); changed.stages[1].paths = ['client/task.ts'];
assert.equal(firstDivergence(left, changed).index, 1);
assert.equal(firstDivergence(left, {...warm, branch:'main'}).stage, 'target');
assert.equal(summarizeTrace(encode([...events, ...events])).length, 2, "Repeated turns in one thread remain separate runs");
const timed = summarizeTrace(encode([...events, { runId: 'run-one', turnId: 'turn-one', threadId: 'one', stage: 'answer-start', elapsedMs: 12_345 }]));
assert.equal(timed.length, 1, 'Chat first-answer timing must join the correlated retrieval run');
assert.equal(timed[0].answerStartMs, 12_345);
const interleaved = summarizeTrace(encode([
  ...events,
  {runId:'run-two', threadId:'one', stage:'target'},
  {runId:'run-one', threadId:'one', stage:'answer-start', elapsedMs:100},
  {threadId:'one', stage:'answer-start', elapsedMs:999}
]));
assert.equal(interleaved[0].answerStartMs, 100, 'late events stay with their originating run');
assert.equal(interleaved[1].answerStartMs, undefined, 'unscoped events cannot certify the latest thread run');
assert.throws(() => summarizeTrace('{broken'), /line 1/);
console.log('repository-hunt trace comparison passed');
