import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {admitDisposableDatabaseTarget} from './disposable-database-target.mjs';
import {databaseSuite} from './enterprise-database-suites.mjs';

// Inspected immutable Linux/amd64 PG16.15 + pgvector fixture for local and CI use.
export const PUBLICATION_IMAGE = 'sha256:a97d77306ff47cc1d8add4d000cec2207da2e110746318df3137ce53c337ca30';
export const PUBLICATION_IMAGE_REF = 'pgvector/pgvector@'+PUBLICATION_IMAGE;
// The inspected OCI manifest binds this config digest. Classic Docker reports
// the config ID; the containerd store reports the manifest ID for this artifact.
export const PUBLICATION_IMAGE_CONFIG = 'sha256:f1447071e6c8449dcf4056aa0994c81d3566ce5ee232de36b04dc25696a116dd';
export const PUBLICATION_IMAGE_IDS = Object.freeze([PUBLICATION_IMAGE,PUBLICATION_IMAGE_CONFIG]);
export const PUBLICATION_LABEL = 'eh13-publication';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Reject ambient targets before Docker inspection or any database constructor. */
export function rejectPublicationTargetOverrides(env = process.env) {
  if (['DATABASE_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']
    .some(name => env[name] !== undefined)) throw new Error('Publication tests do not accept ambient database or Docker target overrides');
}

function validateOwnedPublicationIdentity(value,fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== fields || !UUID.test(value.runId) ||
      value.name !== 'coop-eh13-publication-'+value.runId || !/^[0-9a-f]{64}$/.test(value.id) ||
      !Number.isSafeInteger(value.createdAfter) || value.createdAfter>Date.now() || Date.now()-value.createdAfter>15*60*1000) {
    throw new Error('Invalid new owned publication fixture descriptor');
  }
}

export function validatePublicationDescriptor(value, expectedSuite = 'publication') {
  if (expectedSuite !== 'publication') databaseSuite(expectedSuite);
  const fields = expectedSuite === 'publication' ? 'createdAfter,id,name,port,runId' : 'createdAfter,id,name,port,runId,suite';
  validateOwnedPublicationIdentity(value, fields);
  if (expectedSuite !== 'publication' && value.suite !== expectedSuite) throw new Error('Foreign database suite descriptor');
  if(!/^\d{4,5}$/.test(value.port)||Number(value.port)<1024||Number(value.port)>65535)throw new Error('Invalid new owned publication fixture descriptor');
  // The URL is constructed here; no caller or environment supplied URL is admitted.
  return admitDisposableDatabaseTarget(`postgresql://eh02:eh02-disposable-only@127.0.0.1:${value.port}/eh02_disposable`,
    {port:value.port,database:'eh02_disposable',user:'eh02'});
}

function validateImmutablePublicationContainer(actual,identity) {
  const labels=actual?.Config?.Labels, bindings=actual?.HostConfig?.PortBindings;
  const pgEnv=actual?.Config?.Env ?? [];
  if (actual?.Id!==identity.id || actual.Name!=='/'+identity.name || !PUBLICATION_IMAGE_IDS.includes(actual.Image) || actual.Config.Image!==PUBLICATION_IMAGE_REF ||
      labels?.['coop.enterprise.disposable']!==PUBLICATION_LABEL ||
      labels?.['coop.enterprise.suite']!==identity.suite || labels?.['coop.enterprise.run']!==identity.runId ||
      !Number.isFinite(Date.parse(actual.Created)) || Date.parse(actual.Created)<identity.createdAfter ||
      JSON.stringify(bindings)!==JSON.stringify({'5432/tcp':[{HostIp:'127.0.0.1',HostPort:''}]}) ||
      JSON.stringify(actual.HostConfig.Tmpfs)!==JSON.stringify({'/var/lib/postgresql/data':'rw'}) ||
      !Array.isArray(actual.Mounts) || actual.Mounts.length || actual.HostConfig.Privileged ||
      JSON.stringify(actual.Config.Cmd)!==JSON.stringify(['postgres']) ||
      JSON.stringify(actual.Config.Entrypoint)!==JSON.stringify(['docker-entrypoint.sh']) ||
      !['POSTGRES_DB=eh02_disposable','POSTGRES_USER=eh02','POSTGRES_PASSWORD=eh02-disposable-only','PGDATA=/var/lib/postgresql/data'].every(v=>pgEnv.filter(e=>e.split('=')[0]===v.split('=')[0]).join()===v)) {
    throw new Error('Docker publication fixture identity or isolation does not match');
  }
}

export function validatePublicationContainer(actual,descriptor,expectedSuite = 'publication') {
  const database=validatePublicationDescriptor(descriptor, expectedSuite);
  validateImmutablePublicationContainer(actual,descriptor);
  if(actual.State?.Running!==true || JSON.stringify(actual.NetworkSettings?.Ports)!==JSON.stringify({'5432/tcp':[{HostIp:'127.0.0.1',HostPort:descriptor.port}]})) {
    throw new Error('Docker publication fixture identity or isolation does not match');
  }
  return database;
}

/** Removal only, no URL returned or client admitted. Live ports disappear on stop. */
export function validatePublicationCleanupContainer(actual,identity,expectedSuite = 'publication') {
  if (expectedSuite !== 'publication') databaseSuite(expectedSuite);
  validateOwnedPublicationIdentity(identity, expectedSuite === 'publication' ? 'createdAfter,id,name,runId' : 'createdAfter,id,name,runId,suite');
  if (expectedSuite !== 'publication' && identity.suite !== expectedSuite) throw new Error('Foreign database suite cleanup');
  validateImmutablePublicationContainer(actual,identity);
}

export function inspectLocalPublicationContainer(id) {
  const context=JSON.parse(execFileSync('docker',['context','inspect','--format','{{json .Endpoints.docker}}'],{encoding:'utf8',timeout:5000}));
  if (!/^unix:\/\/\//.test(context.Host) || !context.Host.endsWith('.sock') || context.SkipTLSVerify) {
    throw new Error('Publication fixture requires a local Docker Unix socket');
  }
  const rows=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8',timeout:5000}));
  if (!Array.isArray(rows) || rows.length!==1) throw new Error('Publication fixture is not a single Docker container');
  return rows[0];
}

/** Tests independently inspect real Docker; recorded JSON alone is never authority. */
export function publicationDatabaseFromEnvironment(env = process.env, expectedSuite = 'publication') {
  rejectPublicationTargetOverrides(env);
  const file=env.EH13_PUBLICATION_FIXTURE_FILE;
  if (!file || fs.statSync(file).size>4096) throw new Error('Use the owned publication test runner');
  const descriptor=JSON.parse(fs.readFileSync(file,'utf8'));
  validatePublicationDescriptor(descriptor, expectedSuite); // before a Docker call, and before clients
  return validatePublicationContainer(inspectLocalPublicationContainer(descriptor.id),descriptor, expectedSuite);
}
