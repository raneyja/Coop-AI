import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const root='scripts/fixtures/compatibility-0.1.13';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.sourceCommit,'13240bb0caf8e93cac7ca6241cf2832125fdcffc');
assert.equal(manifest.release,'0.1.13');
assert.equal(createRequire(import.meta.url)('axios/package.json').version,manifest.axios.version);
for(const file of manifest.files) {
  assert.match(file.path,/^src\/[\w/.-]+\.ts$/);
  assert(!file.path.includes('..'));
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex'),file.sha256,file.path);
}
await build({entryPoints:{
  'prior-client':path.join(root,'src/api/CoopBackendClient.ts'),
  'prior-api':path.join(root,'src/server/integrationApi.ts'),
  'current-client':'src/api/CoopBackendClient.ts',
  backend:'src/server/integrationApi.publication.fixture.ts'
},bundle:true,platform:'node',format:'cjs',sourcemap:true,
external:['axios','vscode','pg','web-tree-sitter','tree-sitter-wasms','@sentry/node','node-cron'],
outdir:'dist/tests/compatibility',outExtension:{'.js':'.cjs'}});
