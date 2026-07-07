#!/usr/bin/env node
/**
 * Operator CLI for org provisioning.
 * Usage:
 *   npx ts-node scripts/admin-org.ts create-org "Acme Corp" enterprise
 *   npx ts-node scripts/admin-org.ts set-plan <orgId> enterprise
 *   npx ts-node scripts/admin-org.ts upgrade-user-by-email <email> [seats]
 *   npx ts-node scripts/admin-org.ts list-orgs
 *   npx ts-node scripts/admin-org.ts create-api-key <orgId> "primary"
 *   npx ts-node scripts/admin-org.ts configure-sso <orgId> okta <idpEntityId> <idpSsoUrl> <certPath>
 *   npx ts-node scripts/admin-org.ts create-user <orgId> admin@acme.com owner
 *   npx ts-node scripts/admin-org.ts set-user-role <userId> admin
 *   npx ts-node scripts/admin-org.ts seed-repo-access-demo
 *   npx ts-node scripts/admin-org.ts seed-pro-onboarding
 *   npx ts-node scripts/admin-org.ts seed-pro-onboarding
 *   npx ts-node scripts/admin-org.ts reindex-estate <orgId> [--include-in-flight]
 */

import { readFileSync } from "node:fs";
import { getDbPool, closeDbPool } from "../src/server/db";
import { OrgStore, type OrgPlan } from "../src/server/orgStore";
import { SsoConfigStore, type SsoProvider } from "../src/server/sso/ssoConfigStore";
import { UserStore, type UserRole } from "../src/server/users/userStore";
import { AuthIdentityStore } from "../src/server/auth/authIdentityStore";
import { hashPassword } from "../src/server/auth/passwordCrypto";
import { UserRepoGrantStore } from "../src/server/userRepoGrantStore";
import { loadJobQueueConfig } from "../src/config/jobQueueConfig";
import { JobQueue } from "../src/jobs/jobQueue";
import { syncOrgCatalog } from "../src/server/catalogSyncService";
import type { OrgRepoAccessMode } from "../src/server/repoAccessTypes";

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
      case "upgrade-user-by-email": {
        const [email, seatsArg = "5"] = args;
        if (!email) {
          throw new Error("usage: upgrade-user-by-email <email> [seats]");
        }
        const seats = Math.max(1, Number(seatsArg) || 5);
        const user = await userStore.findActiveUserByEmail(email);
        if (!user) {
          throw new Error(`No active user found for ${email}`);
        }
        const org = await store.getOrganization(user.orgId);
        if (!org) {
          throw new Error(`Organization not found for user ${user.id}`);
        }
        const upgraded = await store.setOrganizationPlan(org.id, "pro");
        await store.updateOrganizationBilling(org.id, {
          billingEmail: email.trim().toLowerCase(),
          seatCount: seats,
          billingStatus: "active"
        });
        console.log(
          JSON.stringify(
            {
              userId: user.id,
              email: user.email,
              orgId: org.id,
              orgName: org.name,
              previousPlan: org.plan,
              plan: upgraded?.plan ?? "pro",
              seatCount: seats,
              billingStatus: "active"
            },
            null,
            2
          )
        );
        break;
      }
      case "list-orgs": {
        const result = await pool.query(
          `SELECT o.id, o.name, o.plan, o.created_at,
                  COUNT(k.id)::int AS api_key_count
           FROM organizations o
           LEFT JOIN api_keys k ON k.org_id = o.id
           GROUP BY o.id, o.name, o.plan, o.created_at
           ORDER BY o.created_at DESC`
        );
        console.log(JSON.stringify(result.rows, null, 2));
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
          throw new Error("usage: create-user <orgId> <email> [admin|member]");
        }
        const user = await userStore.createUser(orgId, email, role as UserRole);
        console.log(JSON.stringify(user, null, 2));
        break;
      }
      case "set-user-role": {
        const [userId, role] = args;
        if (!userId || !role) {
          throw new Error("usage: set-user-role <userId> <admin|member>");
        }
        const user = await userStore.setUserRole(userId, role as UserRole);
        console.log(JSON.stringify(user, null, 2));
        break;
      }
      case "seed-repo-access-demo": {
        const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPassword12!";
        const orgName = "Repo Access Demo";
        const adminEmail = "repo-access-admin@demo.local";
        const devEmail = "repo-access-dev@demo.local";

        await pool.query(`DELETE FROM organizations WHERE name = $1`, [orgName]);

        const org = await store.createOrganization(orgName, "pro");
        await store.updateRepoAccessMode(org.id, "all_indexed");

        const authIdentityStore = new AuthIdentityStore(pool);
        const admin = await userStore.createUser(org.id, adminEmail, "admin");
        await authIdentityStore.createPasswordIdentity(admin.id, hashPassword(demoPassword));
        const dev = await userStore.createUser(org.id, devEmail, "member");
        await authIdentityStore.createPasswordIdentity(dev.id, hashPassword(demoPassword));

        const catalogRepos = [
          "github:acme/api",
          "github:acme/web",
          "github:acme/mobile",
          "github:raneyja/personal-a",
          "github:raneyja/personal-b"
        ];
        const indexedRepos = ["github:acme/api", "github:acme/web", "github:acme/mobile"];

        for (const repoId of catalogRepos) {
          await store.upsertOrgRepo(org.id, repoId, {
            lightningEnabled: false,
            indexStatus: "idle"
          });
        }
        for (const repoId of indexedRepos) {
          await store.upsertOrgRepo(org.id, repoId, {
            lightningEnabled: true,
            indexStatus: "ready",
            lastIndexedAt: new Date()
          });
        }

        const grantStore = new UserRepoGrantStore(pool);
        await grantStore.setUserRepoGrants(org.id, dev.id, [
          "github:acme/api",
          "github:acme/web"
        ]);

        console.log(
          JSON.stringify(
            {
              orgId: org.id,
              orgName: org.name,
              plan: org.plan,
              repoAccessMode: "all_indexed",
              admin: { id: admin.id, email: adminEmail, password: demoPassword },
              developer: { id: dev.id, email: devEmail, password: demoPassword },
              catalogRepos,
              indexedRepos,
              developerGrantsWhenPerUser: ["github:acme/api", "github:acme/web"],
              adminPortalUrl: "http://localhost:3001/login",
              apiBase: "http://localhost:8787"
            },
            null,
            2
          )
        );
        break;
      }
      case "seed-pro-onboarding": {
        const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPassword12!";
        const orgName = "Pro Onboarding Test";
        const adminEmail = "pro-onboarding@demo.local";

        await pool.query(`DELETE FROM organizations WHERE name IN ($1, $2)`, [
          "Repo Access Demo",
          orgName
        ]);

        const org = await store.createOrganization(orgName, "pro");
        await store.updateRepoAccessMode(org.id, "all_indexed");

        const authIdentityStore = new AuthIdentityStore(pool);
        const admin = await userStore.createUser(org.id, adminEmail, "admin");
        await authIdentityStore.createPasswordIdentity(admin.id, hashPassword(demoPassword));

        console.log(
          JSON.stringify(
            {
              orgId: org.id,
              orgName: org.name,
              plan: org.plan,
              repoAccessMode: "all_indexed",
              onboardingCompleted: false,
              indexedRepos: [],
              admin: { id: admin.id, email: adminEmail, password: demoPassword },
              adminPortalUrl: "http://localhost:3001/login",
              apiBase: "http://localhost:8787",
              note: "Fresh Pro org — no repos, no integrations. Sign in and run setup wizard from scratch."
            },
            null,
            2
          )
        );
        break;
      }
      case "seed-governance-demo": {
        const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPassword12!";
        const authIdentityStore = new AuthIdentityStore(pool);
        const demoOrgNames = ["Demo Free", "Demo Pro", "Demo Enterprise"];
        await pool.query(`DELETE FROM organizations WHERE name = ANY($1::text[])`, [demoOrgNames]);

        async function seedOrg(options: {
          name: string;
          plan: OrgPlan;
          seats?: number;
          users: Array<{ email: string; role: UserRole }>;
        }) {
          const org = await store.createOrganization(options.name, options.plan);
          await store.updateRepoAccessMode(org.id, "all_indexed");
          if (options.plan === "pro" || options.plan === "enterprise") {
            await store.updateOrganizationBilling(org.id, {
              billingEmail: options.users[0]?.email.trim().toLowerCase(),
              seatCount: options.seats ?? 5,
              billingStatus: "active"
            });
          }
          const accounts: Array<{ email: string; role: UserRole; userId: string }> = [];
          for (const entry of options.users) {
            const user = await userStore.createUser(org.id, entry.email, entry.role);
            await authIdentityStore.createPasswordIdentity(user.id, hashPassword(demoPassword));
            accounts.push({ email: entry.email, role: entry.role, userId: user.id });
          }
          return { orgId: org.id, orgName: org.name, plan: org.plan, accounts };
        }

        const free = await seedOrg({
          name: "Demo Free",
          plan: "free",
          users: [{ email: "free-admin@demo.local", role: "admin" }]
        });
        const pro = await seedOrg({
          name: "Demo Pro",
          plan: "pro",
          seats: 5,
          users: [
            { email: "pro-admin@demo.local", role: "admin" },
            { email: "pro-member@demo.local", role: "member" }
          ]
        });
        const enterprise = await seedOrg({
          name: "Demo Enterprise",
          plan: "enterprise",
          seats: 25,
          users: [{ email: "enterprise-admin@demo.local", role: "admin" }]
        });

        console.log(
          JSON.stringify(
            {
              password: demoPassword,
              adminPortalUrl: "http://localhost:3001/login",
              extensionApiBase: "http://localhost:8787",
              orgs: { free, pro, enterprise },
              testingNotes: [
                "Pro admin: pro-admin@demo.local — Connect + Manage access in admin portal",
                "Pro member: pro-member@demo.local — read-only Tools in extension; no Connect buttons",
                "Free has no scope gate; Pro/Enterprise require Manage access before chat uses Slack/Jira/etc."
              ]
            },
            null,
            2
          )
        );
        break;
      }
      case "set-repo-access-mode": {
        const [orgId, mode] = args;
        if (!orgId || !mode) {
          throw new Error("usage: set-repo-access-mode <orgId> <all_indexed|per_user>");
        }
        if (mode !== "all_indexed" && mode !== "per_user") {
          throw new Error("mode must be all_indexed or per_user");
        }
        const org = await store.updateRepoAccessMode(orgId, mode as OrgRepoAccessMode);
        console.log(JSON.stringify(org, null, 2));
        break;
      }
      case "reindex-estate": {
        const [orgId, ...flags] = args;
        if (!orgId) {
          throw new Error("usage: reindex-estate <orgId> [--include-in-flight]");
        }
        const includeInFlight = flags.includes("--include-in-flight");
        const repos = await store.listOrgRepos(orgId);
        const repoIds = repos
          .filter((repo) => repo.lightningEnabled)
          .filter((repo) => {
            if (includeInFlight) {
              return true;
            }
            const status = repo.indexStatus ?? "idle";
            return status !== "indexing" && status !== "queued" && status !== "cloning";
          })
          .map((repo) => repo.repoId);
        const jobQueue = new JobQueue(loadJobQueueConfig());
        const result = await syncOrgCatalog(orgId, repoIds, {
          orgStore: store,
          jobQueue,
          force: true
        });
        console.log(
          JSON.stringify(
            {
              orgId,
              includeInFlight,
              ...result
            },
            null,
            2
          )
        );
        break;
      }
      default:
        console.error(
          "Commands: create-org, set-plan, upgrade-user-by-email, list-orgs, create-api-key, configure-sso, create-user, set-user-role, seed-repo-access-demo, seed-pro-onboarding, seed-governance-demo, set-repo-access-mode, reindex-estate"
        );
        process.exit(1);
    }
  } finally {
    await closeDbPool();
  }
}

void main();
