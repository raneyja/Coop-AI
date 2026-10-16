import { publicationDatabaseFromEnvironment } from './publication-test-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { PostgresQueueBackend } from '../src/jobs/backends/postgresBackend';
import { getDbPool, closeDbPool } from '../src/server/db';
import { runMigrations } from './run-migrations.mjs';

// Actual suite-bound Docker identity is admitted before constructing any client.
const target=publicationDatabaseFromEnvironment(process.env,'tls');
const tlsDirectory=path.join(path.dirname(process.env.EH13_PUBLICATION_FIXTURE_FILE!), 'tls');
const ca=path.join(tlsDirectory,'ca.crt');
function tlsUrl(host:string,trust:boolean) {
  const url=new URL(target!);url.hostname=host;
  url.searchParams.set('sslmode','verify-full');
  if(trust)url.searchParams.set('sslrootcert',ca!);
  return url.toString();
}

test('actual backend Pool trusts configured CA and rejects untrusted CA and bad hostname',async()=>{
  try {
    const pool=await getDbPool(tlsUrl('localhost',true));
    assert.equal((await pool!.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl,true);
    await closeDbPool();
    const untrusted=await getDbPool(tlsUrl('localhost',false));
    await assert.rejects(untrusted!.query('SELECT 1'),/certificate|issuer|self.signed/i);
    await closeDbPool();
    const wrongHost=await getDbPool(tlsUrl('127.0.0.1',true));
    await assert.rejects(wrongHost!.query('SELECT 1'),/altname|hostname|certificate/i);
  } finally {await closeDbPool();}
});

test('actual migration runner rejects bad certificates before ledger creation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-tls-migration-'));
  fs.writeFileSync(path.join(dir,'001_noop.sql'),'SELECT 1;');
  try {
    await assert.rejects(runMigrations({databaseUrl:tlsUrl('localhost',false),migrationsDir:dir,log:()=>{}}),/certificate|issuer|self.signed/i);
    await assert.rejects(runMigrations({databaseUrl:tlsUrl('127.0.0.1',true),migrationsDir:dir,log:()=>{}}),/altname|hostname|certificate/i);
    // The dedicated empty admin DB is test-owned; the successful no-op migration
    // leaves a ledger only inside this container, never any pre-existing database.
    await runMigrations({databaseUrl:tlsUrl('localhost',true),migrationsDir:dir,log:()=>{}});
  } finally {fs.rmSync(dir,{recursive:true});}
});

test('actual jobs backend follows verified TLS without changing queue behavior',async()=>{
  const admin=await getDbPool(target);
  const name=`eh10_tls_jobs_${process.pid}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-jobs-tls-'));
  await admin!.query(`CREATE DATABASE ${name}`);await closeDbPool();
  const url=new URL(tlsUrl('localhost',true));url.pathname='/'+name;
  const bad=new URL(tlsUrl('127.0.0.1',true));bad.pathname='/'+name;
  const untrusted=new URL(tlsUrl('localhost',false));untrusted.pathname='/'+name;
  let backend:PostgresQueueBackend|undefined;
  try {
    fs.copyFileSync('migrations/001_jobs.sql',path.join(dir,'001_jobs.sql'));
    await runMigrations({databaseUrl:url.toString(),migrationsDir:dir,log:()=>{}});
    backend=new PostgresQueueBackend(url.toString());
    assert.equal(await backend.get('00000000-0000-0000-0000-000000000000'),undefined);
    await backend.close();
    backend=new PostgresQueueBackend(bad.toString());
    await assert.rejects(backend.get('00000000-0000-0000-0000-000000000000'),/altname|hostname|certificate/i);
    await backend.close();
    backend=new PostgresQueueBackend(untrusted.toString());
    await assert.rejects(backend.get('00000000-0000-0000-0000-000000000000'),/certificate|issuer|self.signed/i);
  } finally {
    await backend?.close();await closeDbPool();
    const cleanup=await getDbPool(target);await cleanup!.query(`DROP DATABASE ${name} WITH (FORCE)`);await closeDbPool();
    fs.rmSync(dir,{recursive:true});
  }
});

test('actual backend and runner reject a trusted certificate with the wrong DNS name',async()=>{
  const cert=path.join(tlsDirectory,'wrong.crt');
  const key=path.join(tlsDirectory,'server.key');
  const context=tls.createSecureContext({cert:fs.readFileSync(cert),key:fs.readFileSync(key)});
  const connections=new Set<net.Socket>();
  const server=net.createServer(socket=>{
    connections.add(socket);socket.on('close',()=>connections.delete(socket));socket.on('error',()=>{});
    socket.once('data',request=>{
      assert.equal(request.readInt32BE(4),80877103,'Postgres SSL negotiation request');
      socket.write('S');
      const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:context});
      secure.on('error',()=>secure.destroy());
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as net.AddressInfo;
  const url=new URL(tlsUrl('localhost',true));url.port=String(address.port);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-dns-tls-'));fs.writeFileSync(path.join(dir,'001_noop.sql'),'SELECT 1;');
  try {
    const pool=await getDbPool(url.toString());
    await assert.rejects(pool!.query('SELECT 1'),/altname|hostname|certificate/i);
    await closeDbPool();
    await assert.rejects(runMigrations({databaseUrl:url.toString(),migrationsDir:dir,log:()=>{}}),/altname|hostname|certificate/i);
  } finally {
    await closeDbPool();connections.forEach(socket=>socket.destroy());
    await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true});
  }
});
