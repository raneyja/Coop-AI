import { readFileSync } from 'node:fs';

// Compare exported Extension Host diagnostic JSONL without source bodies or credentials.
export function summarizeTrace(text) {
  const runs = [];
  const active = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error(`Invalid JSON at line ${index + 1}`); }
    const key = event.runId ?? event.turnId;
    if (!key || !event.stage) continue;
    if (event.stage === 'target' || !active.has(key)) {
      const run = { runId: key, repoId: event.repoId, branch: event.resolvedBranch ?? event.selectedBranch, bundleId: event.bundleId, stages: [] };
      runs.push(run);
      active.set(key, run);
    }
    const run = active.get(key);
    run.stages.push({ stage: event.stage, query: event.query, path: event.path, tool: event.tool, accepted: event.acceptedByReadGate, criteria: event.criteria, paths: event.paths ?? event.hits?.map(hit => hit.path), status: event.status ?? event.outcome, elapsedMs: event.elapsedMs });
    if (event.stage === 'outcome') run.outcome = event;
    if (event.stage === 'answer-start') run.answerStartMs = event.elapsedMs;
  }
  return runs;
}

export function firstDivergence(left, right) {
  if (left.repoId !== right.repoId || left.branch !== right.branch) return { stage: 'target', reason: 'Repository or branch differs' };
  const normalize = ({ elapsedMs, ...stage }) => stage;
  for (let index = 0; index < Math.max(left.stages.length, right.stages.length); index++) {
    const a = left.stages[index], b = right.stages[index];
    if (JSON.stringify(a && normalize(a)) !== JSON.stringify(b && normalize(b))) return { index, left: a, right: b };
  }
  return null;
}

if (process.argv[1]?.endsWith('repository-hunt-trace.mjs')) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Usage: node scripts/repository-hunt-trace.mjs cold.jsonl [warm.jsonl]');
  const traces = files.map(file => summarizeTrace(readFileSync(file, 'utf8')));
  console.log(JSON.stringify({ files, runs: traces, firstDivergence: traces.length > 1 && traces[0].length && traces[1].length ? firstDivergence(traces[0].at(-1), traces[1].at(-1)) : undefined }, null, 2));
}
