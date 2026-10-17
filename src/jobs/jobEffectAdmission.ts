import type { Pool, PoolClient } from 'pg';
import { EFFECT_JOB_TYPES, type Job, type JobGraphGeneration } from './types';
import { JobCancelledError } from './errorHandling';

/** Claims, quarantine and purge take exclusive access; owned effects retain
 * shared access through their SQL/physical callback. Always lock global -> job
 * -> sorted heads. External writes still require uncertain-outcome quarantine. */
export const JOB_EFFECT_ADMISSION_LOCK = 731804;

/** Hold the durable attempt row through the actual write transaction. Reclaim,
 * cancel and completion cannot authorize a successor while these effects commit. */
export async function withJobOwnedEffect<T>(pool: Pool, job: Job, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!job.ownerId || !job.attemptId) throw new JobCancelledError('Index effect has no admitted attempt');
  const generations = job.graphGenerations?.map(item => Object.freeze({...item}));
  if (!generations?.length) throw new JobCancelledError('Effect job has no submitted generation');
  const ownership = [job.id,job.ownerId,job.attemptId,job.type,JSON.stringify(job.params),job.userId ?? null,EFFECT_JOB_TYPES,JSON.stringify(generations)];
  const admission = `SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 AND attempt_id=$3 AND status='running'
         AND type=$4 AND params=$5::jsonb AND user_id IS NOT DISTINCT FROM $6::varchar
         AND type=ANY($7::text[]) AND graph_generations=$8::jsonb AND NOT effect_quarantined AND lease_expires_at > clock_timestamp()`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [JOB_EFFECT_ADMISSION_LOCK]);
    // A predicate on SELECT FOR UPDATE can be evaluated before its row-lock wait.
    // Re-admit in a new statement after holding the row, using the database clock.
    await client.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE', [ownership[0]]);
    const owned = await client.query(admission, ownership);
    if (!owned.rows.length) throw new JobCancelledError('Index effect attempt lost ownership');
    const quarantined = await client.query('SELECT id FROM jobs WHERE effect_quarantined LIMIT 1');
    if (quarantined.rows.length) throw new JobCancelledError('Index effects require worker termination and reconciliation');
    await assertJobGraphGenerations(client, generations);
    // Head locks may wait too. Re-read the database clock AFTER every lock
    // before any SQL or nontransactional physical callback is allowed to enter.
    const afterHeads = await client.query(admission, ownership);
    if (!afterHeads.rows.length) throw new JobCancelledError('Index effect attempt lost ownership');
    signal?.throwIfAborted();
    const result = await operation(client);
    signal?.throwIfAborted();
    // SQL effects remain rollbackable if their lease or exact identity changed.
    await assertJobGraphGenerations(client, generations);
    const current = await client.query(admission, ownership);
    if (!current.rows.length) throw new JobCancelledError('Index effect attempt lost ownership');
    signal?.throwIfAborted();
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function withJobEffectExclusion<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [JOB_EFFECT_ADMISSION_LOCK]);
    const active = await client.query(
      `SELECT id FROM jobs WHERE effect_quarantined OR (status = 'running' AND type = ANY($1::text[])) LIMIT 1`, [EFFECT_JOB_TYPES]);
    if (active.rows.length) throw new Error('Index effects require worker termination and reconciliation before purge');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Same client as the locked attempt. Sorted head locks are retained through
 * precommit; a later logical submission cannot change this effect's generation. */
async function assertJobGraphGenerations(client: PoolClient, generations: JobGraphGeneration[]): Promise<void> {
  for (const item of [...generations].sort((a,b) => a.orgId.localeCompare(b.orgId) || a.repoId.localeCompare(b.repoId))) {
    if (!item.orgId || !item.repoId || !/^(0|[1-9][0-9]*)$/.test(item.generation)) throw new JobCancelledError('Invalid submitted graph scope');
    const head = await client.query('SELECT requested_generation FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE', [item.orgId,item.repoId]);
    if (head.rows.length !== 1 || String(head.rows[0].requested_generation) !== item.generation) throw new JobCancelledError('Effect generation superseded');
  }
}
