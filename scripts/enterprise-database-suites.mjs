// Fixed test-only commands. Callers may select a name, never a URL or command.
const ts = file => ['--require', './scripts/vscode-test-stub.cjs', '--import', './node_modules/tsx/dist/loader.mjs', '--test', file];
export const DATABASE_SUITES = Object.freeze({
  'schema-rollout': {setup:false,preparation:[['scripts/build-compatibility-fixtures.mjs']],commands:[ts('scripts/schema-deployment-compatibility.integration.test.ts')]},
  compatibility: {setup:true,preparation:[['scripts/build-compatibility-fixtures.mjs']],commands:[ts('scripts/client-api-compatibility.integration.test.ts')]},
  auth: {setup: false, commands: [ts('src/server/auth/authRateLimit.integration.test.ts')]},
  tls: {setup: false, tls: true, commands: [ts('scripts/database-tls.integration.test.ts')]},
  'publication-extra': {setup: true,
    preparation: [['--input-type=module','--eval',"import {build} from 'esbuild'; await build({entryPoints:['src/server/integrationApi.publication.fixture.ts'],bundle:true,platform:'node',format:'cjs',sourcemap:true,external:['@sentry/node','node-cron'],outfile:'dist/tests/publication-main.cjs'});" ]],
    commands: [['--require','./scripts/vscode-test-stub.cjs','--import','./node_modules/tsx/dist/loader.mjs','src/server/integrationApi.publication.extra.test.ts']]},
  migrations: {setup: false, commands: [['--test', 'scripts/run-migrations.integration.test.mjs']]},
  assembly: {setup: false, commands: [ts('scripts/enterprise-assembly-controls.integration.test.ts')]},
  jobs: {setup: true, commands: [['--require','./scripts/vscode-test-stub.cjs','--test','dist/tests/jobLeases.integration.test.cjs']]},
  graph: {setup: true,
    // Match the production worker's bundle boundary for the ESM-only SCIP schema.
    // Compile both the test and its real process-kill child from current source.
    preparation: [['--input-type=module', '--eval', "import {build} from 'esbuild'; await build({entryPoints:['src/cache/graphPublication.integration.test.ts','src/cache/graphPublicationKill.fixture.ts'],bundle:true,platform:'node',format:'cjs',external:['pg','web-tree-sitter','tree-sitter-wasms','@sentry/node'],outdir:'dist/tests',outExtension:{'.js':'.cjs'}});" ]],
    commands: [['--require','./scripts/vscode-test-stub.cjs','--test','dist/tests/graphPublication.integration.test.cjs']]},
  'graph-lock': {setup: true, commands: [ts('src/jobs/jobEffectAdmission.lockWait.integration.test.ts')]},
  saml: {setup: true, commands: [ts('src/server/sso/samlReplay.integration.test.ts')]},
  billing: {setup: true, commands: [ts('src/server/billing/billingRecovery.integration.test.ts')]},
  'integration-store': {setup: false, commands: [ts('src/server/integrationConnectionStore.lifecycle.test.ts')]},
  threads: {setup: false, commands: [ts('src/server/chatThreadsStore.integration.test.ts')]},
  readiness: {setup: true,
    // Job runtime imports the same ESM-only SCIP schema as graph execution.
    preparation: [['--input-type=module', '--eval', "import {build} from 'esbuild'; await build({entryPoints:['src/server/operators/readiness.integration.test.ts'],bundle:true,platform:'node',format:'cjs',external:['pg','web-tree-sitter','tree-sitter-wasms','@sentry/node'],outfile:'dist/tests/readiness.integration.test.cjs'});" ]],
    commands: [['--require','./scripts/vscode-test-stub.cjs','--test','dist/tests/readiness.integration.test.cjs']]},
  support: {setup: false, commands: [ts('src/server/support/support.integration.test.ts')]}
});
export function databaseSuite(name) {
  if (!Object.hasOwn(DATABASE_SUITES, name)) throw new Error('Unknown required database suite');
  return DATABASE_SUITES[name];
}
