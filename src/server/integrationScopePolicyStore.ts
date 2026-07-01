import type { Pool } from "pg";
import type { IntegrationProvider } from "./integrationConnectionStore";
import type { IntegrationScopePolicy } from "../integrationScope/types";

export type IntegrationScopePolicyRecord = {
  provider: IntegrationProvider;
  policy: IntegrationScopePolicy | Record<string, unknown>;
  updatedAt: Date;
};

export class IntegrationScopePolicyStore {
  public constructor(private readonly pool: Pool) {}

  public async get(
    orgId: string,
    provider: IntegrationProvider
  ): Promise<IntegrationScopePolicyRecord | undefined> {
    const result = await this.pool.query(
      `SELECT provider, policy, updated_at
       FROM org_integration_policies
       WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      provider,
      policy: parsePolicy(row.policy),
      updatedAt: new Date(row.updated_at)
    };
  }

  public async upsert(
    orgId: string,
    provider: IntegrationProvider,
    policy: IntegrationScopePolicy
  ): Promise<IntegrationScopePolicyRecord> {
    const result = await this.pool.query(
      `INSERT INTO org_integration_policies (org_id, provider, policy, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (org_id, provider) DO UPDATE SET
         policy = EXCLUDED.policy,
         updated_at = NOW()
       RETURNING provider, policy, updated_at`,
      [orgId, provider, JSON.stringify(policy)]
    );
    const row = result.rows[0];
    return {
      provider,
      policy: parsePolicy(row.policy),
      updatedAt: new Date(row.updated_at)
    };
  }

  public async delete(orgId: string, provider: IntegrationProvider): Promise<void> {
    await this.pool.query(
      `DELETE FROM org_integration_policies WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );
  }
}

function parsePolicy(raw: unknown): IntegrationScopePolicy | Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw as IntegrationScopePolicy;
}
