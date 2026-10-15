import {databaseSuite} from './enterprise-database-suites.mjs';
import {runOwnedDatabaseSuite} from './run-publication-regression.mjs';
// Publication retains its separate required fixture lane; no alias here.
if (process.argv.length !== 4 || process.argv[2] !== '--suite') throw new Error('Select one declared database suite; no target or command arguments');
databaseSuite(process.argv[3]);
await runOwnedDatabaseSuite(process.argv[3]);
