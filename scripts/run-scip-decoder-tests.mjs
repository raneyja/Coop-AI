// Bundle the ESM-only SCIP schema as the worker build does. Keep the generated
// test artifact in a disposable owned directory, with source fixtures in repo.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const owned = mkdtempSync(path.join(tmpdir(), 'coop-scip-decoder-test-'));
try {
  const output = path.join(owned, 'decoder.test.cjs');
  await build({ entryPoints: ['src/jobs/scipIndexDecoder.test.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs' });
  const result = spawnSync(process.execPath, ['--test', output], { stdio: 'inherit', timeout: 30000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(owned, { recursive: true, force: true });
}
