#!/usr/bin/env node
/**
 * Operator CLI for org provisioning.
 * Usage:
 *   npx ts-node scripts/admin-org.ts create-org "Acme Corp" enterprise
 *   npx ts-node scripts/admin-org.ts set-plan <orgId> enterprise
 *   npx ts-node scripts/admin-org.ts create-api-key <orgId> "primary"
 *   npx ts-node scripts/admin-org.ts configure-sso <orgId> okta <idpEntityId> <idpSsoUrl> <certPath>
 *   npx ts-node scripts/admin-org.ts create-user <orgId> admin@acme.com owner
 *   npx ts-node scripts/admin-org.ts set-user-role <userId> admin
 */

import { readFileSync } from "node:fs";
import { getDbPool, closeDbPool } from "../src/server/db";
import { OrgStore, type OrgPlan } from "../src/server/orgStore";
import { SsoConfigStore, type SsoProvider } from "../src/server/sso/ssoConfigStore";
import { UserStore, type UserRole } from "../src/server/users/userStore";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const pool = await getDbPool();
  if (!pool) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const store = new OrgStore(pool, encryptionKey);
  const ssoConfigStore = new SsoConfigStore(pool);
  const userStore = new UserStore(pool);

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
      case "configure-sso": {
        const [orgId, provider, idpEntityId, idpSsoUrl, certPath] = args;
        if (!orgId || !provider || !idpEntityId || !idpSsoUrl || !certPath) {
          throw new Error(
            "usage: configure-sso <orgId> <okta|azuread|saml> <idpEntityId> <idpSsoUrl> <certPath>"
          );
        }
        const idpX509Cert = readFileSync(certPath, "utf8").trim();
        const saved = await ssoConfigStore.upsertConfig(orgId, {
          provider: provider as SsoProvider,
          idpEntityId,
          idpSsoUrl,
          idpX509Cert,
          enabled: true
        });
        console.log(JSON.stringify(saved, null, 2));
        break;
      }
      case "create-user": {
        const [orgId, email, role = "member"] = args;
        if (!orgId || !email) {
          throw new Error("usage: create-user <orgId> <email> [owner|admin|member]");
        }
        const user = await userStore.createUser(orgId, email, role as UserRole);
        console.log(JSON.stringify(user, null, 2));
        break;
      }
      case "set-user-role": {
        const [userId, role] = args;
        if (!userId || !role) {
          throw new Error("usage: set-user-role <userId> <owner|admin|member>");
        }
        const user = await userStore.setUserRole(userId, role as UserRole);
        console.log(JSON.stringify(user, null, 2));
        break;
      }
      default:
        console.error(
          "Commands: create-org, set-plan, create-api-key, configure-sso, create-user, set-user-role"
        );
        process.exit(1);
    }
  } finally {
    await closeDbPool();
  }
}

void main();
