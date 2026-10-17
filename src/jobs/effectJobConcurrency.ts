import { JobType, type Job } from './types';

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only an exact, submitted single-repository index footprint may overlap.
 * Organization serialization also excludes aliases in physical shard names.
 * Legacy/unknown footprints and the other effect types remain global. */
export function indexJobOrganization(job: Job): string | undefined {
  const org = job.params.orgId, repo = job.params.repoId;
  const scopes = job.graphGenerations;
  if (job.type !== JobType.INDEX_REPOSITORY || typeof org !== 'string' || !ORGANIZATION_ID.test(org)
    || typeof repo !== 'string' || !repo.trim() || !scopes || scopes.length !== 1) return undefined;
  const scope = scopes[0];
  if (!scope || typeof scope !== 'object' || Object.keys(scope).sort().join(',') !== 'generation,orgId,repoId' || scope.orgId !== org || scope.repoId !== repo
    || typeof scope.generation !== 'string' || !/^(0|[1-9][0-9]*)$/.test(scope.generation)) return undefined;
  return org.toLowerCase();
}

export function effectJobsConflict(candidate: Job, running: Job): boolean {
  const left = indexJobOrganization(candidate), right = indexJobOrganization(running);
  return !left || !right || left === right;
}

// Atomic SQL counterpart of the above policy. Exact JSON equality rejects
// malformed/legacy arrays, additional scopes/keys and non-string generations.
// These aliases are fixed by claimNext, never supplied by a request.
function indexScopeSql(alias: 'jobs' | 'blocked'): string {
  return `(${alias}.type = '${JobType.INDEX_REPOSITORY}'
    AND jsonb_typeof(${alias}.params->'orgId') = 'string'
    AND ${alias}.params->>'orgId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND jsonb_typeof(${alias}.params->'repoId') = 'string' AND length(btrim(${alias}.params->>'repoId')) > 0
    AND ${alias}.graph_generations->0->>'generation' ~ '^(0|[1-9][0-9]*)$'
    AND ${alias}.graph_generations = jsonb_build_array(jsonb_build_object(
      'orgId', ${alias}.params->>'orgId', 'repoId', ${alias}.params->>'repoId',
      'generation', ${alias}.graph_generations->0->>'generation')))`;
}

export const DISJOINT_INDEX_ORGANIZATIONS_SQL = `COALESCE((${indexScopeSql('jobs')} AND ${indexScopeSql('blocked')}
  AND lower(jobs.params->>'orgId') <> lower(blocked.params->>'orgId')), FALSE)`;
