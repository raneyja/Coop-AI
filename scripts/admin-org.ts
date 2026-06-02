#!/usr/bin/env node
/**
 * Operator CLI for org provisioning.
 * Usage:
 *   npx ts-node scripts/admin-org.ts create-org "Acme Corp" pro
 *   npx ts-node scripts/admin-org.ts set-plan <orgId> pro
 *   npx ts-node scripts/admin-org.ts create-api-key <orgId> "primary"
 */

import { getDbPool, closeDbPool } from "../src/server/db";
import { OrgStore, type OrgPlan } from "../src/server/orgStore";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const pool = await getDbPool();
  if (!pool) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const store = new OrgStore(pool, encryptionKey);

  try {
    switch (command) {
      case "create-org": {
        const [name, plan = "free"] = args;
        if (!name) {
          throw new Error("usage: create-org <name> [free|pro|enterprise]");
        }
        const org = await store.createOrganization(name, plan as OrgPlan);
        console.log(JSON.stringify(org, null, 2));
        break;
      }
      case "set-plan": {
        const [orgId, plan] = args;
        if (!orgId || !plan) {
          throw new Error("usage: set-plan <orgId> <free|pro|enterprise>");
        }
        const org = await store.setOrganizationPlan(orgId, plan as OrgPlan);
        console.log(JSON.stringify(org, null, 2));
        break;
      }
      case "create-api-key": {
        const [orgId, label = "default"] = args;
        if (!orgId) {
          throw new Error("usage: create-api-key <orgId> [label]");
        }
        const { record, rawKey } = await store.createApiKey(orgId, label);
        console.log(JSON.stringify({ ...record, rawKey }, null, 2));
        console.error("\nSave rawKey now — it cannot be retrieved later.");
        break;
      }
      default:
        console.error("Commands: create-org, set-plan, create-api-key");
        process.exit(1);
    }
  } finally {
    await closeDbPool();
  }
}

void main();
