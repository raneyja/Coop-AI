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
 *   npx ts-node scripts/admin-org.ts seed-enterprise-sso-demo
 *   npx ts-node scripts/admin-org.ts seed-analytics-demo
 *   npx ts-node scripts/admin-org.ts reindex-estate <orgId> [--include-in-flight]
 */

import { readFileSync } from "node:fs";
import { getDbPool, closeDbPool } from "../src/server/db";
import { OrgStore, type OrgPlan } from "../src/server/orgStore";
import { SsoConfigStore, type SsoProvider } from "../src/server/sso/ssoConfigStore";
import { AuthPolicyStore } from "../src/server/sso/authPolicyStore";
import { UserStore, type UserRole } from "../src/server/users/userStore";
import { AuthIdentityStore } from "../src/server/auth/authIdentityStore";
import { hashPassword } from "../src/server/auth/passwordCrypto";
import { UserRepoGrantStore } from "../src/server/userRepoGrantStore";
import { loadJobQueueConfig } from "../src/config/jobQueueConfig";
import { JobQueue } from "../src/jobs/jobQueue";
import { syncOrgCatalog } from "../src/server/catalogSyncService";
import type { OrgRepoAccessMode } from "../src/server/repoAccessTypes";
import { principalForUser } from "../src/server/audit/auditLogger";

/** Public signing cert from https://mocksaml.com/api/saml/metadata (BoxyHQ MockSAML). */
const MOCKSAML_IDP_CERT = `-----BEGIN CERTIFICATE-----
MIIC4jCCAcoCCQC33wnybT5QZDANBgkqhkiG9w0BAQsFADAyMQswCQYDVQQGEwJV
SzEPMA0GA1UECgwGQm94eUhRMRIwEAYDVQQDDAlNb2NrIFNBTUwwIBcNMjIwMjI4
MjE0NjM4WhgPMzAyMTA3MDEyMTQ2MzhaMDIxCzAJBgNVBAYTAlVLMQ8wDQYDVQQK
DAZCb3h5SFExEjAQBgNVBAMMCU1vY2sgU0FNTDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALGfYettMsct1T6tVUwTudNJH5Pnb9GGnkXi9Zw/e6x45DD0
RuRONbFlJ2T4RjAE/uG+AjXxXQ8o2SZfb9+GgmCHuTJFNgHoZ1nFVXCmb/Hg8Hpd
4vOAGXndixaReOiq3EH5XvpMjMkJ3+8+9VYMzMZOjkgQtAqO36eAFFfNKX7dTj3V
pwLkvz6/KFCq8OAwY+AUi4eZm5J57D31GzjHwfjH9WTeX0MyndmnNB1qV75qQR3b
2/W5sGHRv+9AarggJkF+ptUkXoLtVA51wcfYm6hILptpde5FQC8RWY1YrswBWAEZ
NfyrR4JeSweElNHg4NVOs4TwGjOPwWGqzTfgTlECAwEAATANBgkqhkiG9w0BAQsF
AAOCAQEAAYRlYflSXAWoZpFfwNiCQVE5d9zZ0DPzNdWhAybXcTyMf0z5mDf6FWBW
5Gyoi9u3EMEDnzLcJNkwJAAc39Apa4I2/tml+Jy29dk8bTyX6m93ngmCgdLh5Za4
khuU3AM3L63g7VexCuO7kwkjh/+LqdcIXsVGO6XDfu2QOs1Xpe9zIzLpwm/RNYeX
UjbSj5ce/jekpAw7qyVVL4xOyh8AtUW1ek3wIw1MJvEgEPt0d16oshWJpoS1OT8L
r/22SvYEo3EmSGdTVGgk3x3s+A0qWAqTcyjr7Q4s/GKYRFfomGwz0TZ4Iw1ZN99M
m0eo2USlSRTVl7QHRTuiuSThHpLKQQ==
-----END CERTIFICATE-----`;

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
  const authPolicyStore = new AuthPolicyStore(pool);
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
      case "seed-enterprise-sso-demo": {
        const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPassword12!";
        const orgName = "SSO Smoke Demo";
        const adminEmail = "sso-smoke-admin@demo.local";
        const memberEmail = "sso-smoke-member@demo.local";
        const apiBase = (process.env.COOP_PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, "");
        const adminPortal = (process.env.COOP_ADMIN_PORTAL_URL ?? "http://localhost:3001").replace(
          /\/+$/,
          ""
        );
        const mockIdpEntityId = "https://saml.example.com/entityid";
        const mockIdpSsoUrl = "https://mocksaml.com/api/saml/sso";
        const mockIdpCert = MOCKSAML_IDP_CERT;

        await pool.query(`DELETE FROM organizations WHERE name = $1`, [orgName]);

        const org = await store.createOrganization(orgName, "enterprise");
        await store.updateRepoAccessMode(org.id, "all_indexed");
        await store.updateOrganizationBilling(org.id, {
          billingEmail: adminEmail,
          seatCount: 25,
          billingStatus: "active"
        });

        const authIdentityStore = new AuthIdentityStore(pool);
        const admin = await userStore.createUser(org.id, adminEmail, "admin");
        await authIdentityStore.createPasswordIdentity(admin.id, hashPassword(demoPassword));
        const member = await userStore.createUser(org.id, memberEmail, "member");
        await authIdentityStore.createPasswordIdentity(member.id, hashPassword(demoPassword));

        await ssoConfigStore.upsertConfig(org.id, {
          provider: "saml",
          idpEntityId: mockIdpEntityId,
          idpSsoUrl: mockIdpSsoUrl,
          idpX509Cert: mockIdpCert,
          enabled: true
        });
        await authPolicyStore.upsertPolicy(org.id, {
          requireSso: false,
          allowPassword: true,
          allowGoogle: true
        });

        const redirect = `${adminPortal}/auth/callback`;
        const ssoStartUrl = `${apiBase}/v1/auth/saml/start?org=${encodeURIComponent(orgName)}&redirect=${encodeURIComponent(redirect)}`;

        console.log(
          JSON.stringify(
            {
              orgId: org.id,
              orgName: org.name,
              plan: org.plan,
              accounts: {
                admin: { id: admin.id, email: adminEmail, password: demoPassword },
                member: { id: member.id, email: memberEmail, password: demoPassword }
              },
              sso: {
                provider: "saml",
                idpEntityId: mockIdpEntityId,
                idpSsoUrl: mockIdpSsoUrl,
                enabled: true,
                note: "IdP is mocksaml.com — free test IdP, no account required"
              },
              smokeTest: {
                ssoStartUrl,
                adminPortalLogin: `${adminPortal}/login`,
                apiBase
              }
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
      case "seed-analytics-demo": {
        const databaseUrl = process.env.DATABASE_URL ?? "";
        const host = databaseUrl.toLowerCase();
        if (
          host.includes("railway") ||
          host.includes("rlwy.net") ||
          host.includes("coop-ai.dev") ||
          (host && !host.includes("localhost") && !host.includes("@postgres:"))
        ) {
          throw new Error(
            "seed-analytics-demo is local-only. Refusing to run against a non-local DATABASE_URL."
          );
        }
        const demoPassword = process.env.DEMO_PASSWORD ?? "DemoPassword12!";
        const authIdentityStore = new AuthIdentityStore(pool);
        const demoOrgNames = ["Analytics Demo Co", "Solo Analytics Demo"];
        await pool.query(`DELETE FROM organizations WHERE name = ANY($1::text[])`, [demoOrgNames]);

        type Persona = "power" | "regular" | "light" | "inactive";
        type SeedUser = { email: string; role: UserRole; persona: Persona; displayName: string };

        const FIRST = [
          "alex", "blake", "casey", "dana", "ellis", "finley", "gray", "harper", "indigo", "jordan",
          "kai", "logan", "morgan", "noah", "owen", "parker", "quinn", "riley", "sage", "taylor",
          "uma", "val", "wren", "yael", "zion"
        ];
        const LAST = [
          "chen", "diaz", "evans", "foster", "gupta", "hayes", "ibrahim", "jones", "kim", "lopez",
          "martin", "nguyen", "ortiz", "patel", "quinn", "reed", "singh", "tran", "uddin", "vega",
          "wu", "xu", "young", "zhang", "abbott"
        ];

        function mulberry32(seed: number): () => number {
          return () => {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }

        function weekdayBias(day: Date, rand: () => number): boolean {
          const dow = day.getUTCDay();
          if (dow === 0 || dow === 6) {
            return rand() < 0.18;
          }
          return rand() < 0.92;
        }

        function atHour(day: Date, hour: number, minuteJitter: number): Date {
          const d = new Date(day);
          d.setUTCHours(hour, Math.floor(minuteJitter), Math.floor((minuteJitter % 1) * 60), 0);
          return d;
        }

        type DemoThreadMessage = {
          id: string;
          role: "user" | "assistant";
          content: string;
          sortOrder: number;
          createdAt: Date;
        };

        type DemoThread = {
          id: string;
          title: string;
          repoOwner?: string;
          repoName?: string;
          updatedAt: Date;
          createdAt: Date;
          messages: DemoThreadMessage[];
        };

        function previewFromThreadMessages(messages: DemoThreadMessage[]): string {
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index]!;
            const trimmed = message.content.trim().replace(/\s+/g, " ");
            if (trimmed) {
              return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
            }
          }
          return "";
        }

        async function insertDemoThread(
          thread: DemoThread & {
            orgId: string;
            userId: string;
            principal: string;
          }
        ): Promise<void> {
          await pool.query(
            `INSERT INTO chat_threads (
               id, org_id, user_id, principal, title,
               repo_owner, repo_name, repo_provider,
               message_count, preview_text, created_at, updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'github', $8, $9, $10, $11)`,
            [
              thread.id,
              thread.orgId,
              thread.userId,
              thread.principal,
              thread.title,
              thread.repoOwner ?? null,
              thread.repoName ?? null,
              thread.messages.length,
              previewFromThreadMessages(thread.messages),
              thread.createdAt.toISOString(),
              thread.updatedAt.toISOString()
            ]
          );
          for (const message of thread.messages) {
            await pool.query(
              `INSERT INTO chat_messages (id, thread_id, role, content, metadata, sort_order, created_at)
               VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6)`,
              [
                message.id,
                thread.id,
                message.role,
                message.content,
                message.sortOrder,
                message.createdAt.toISOString()
              ]
            );
          }
        }

        async function insertAuditBatch(
          rows: Array<{
            orgId: string;
            userId: string;
            principal: string;
            action: string;
            metadata: Record<string, unknown>;
            createdAt: Date;
          }>
        ): Promise<void> {
          const chunkSize = 200;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const values: unknown[] = [];
            const placeholders: string[] = [];
            chunk.forEach((row, idx) => {
              const o = idx * 6;
              placeholders.push(
                `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}::jsonb, $${o + 6})`
              );
              values.push(
                row.userId,
                row.orgId,
                row.principal,
                row.action,
                JSON.stringify(row.metadata),
                row.createdAt.toISOString()
              );
            });
            await pool.query(
              `INSERT INTO audit_log (user_id, org_id, principal, action, metadata, created_at)
               VALUES ${placeholders.join(", ")}`,
              values
            );
          }
        }

        function buildDemoThreads(options: {
          prefix: string;
          repos: Array<{ owner: string; name: string }>;
          seed: number;
        }): DemoThread[] {
          const rand = mulberry32(options.seed);
          const now = Date.now();
          const scenarios: Array<{
            title: string;
            repoIndex: number;
            turns: Array<{ user: string; assistant: string }>;
            daysAgo: number;
          }> = [
            {
              title: "Trace auth middleware flow",
              repoIndex: 0,
              daysAgo: 2,
              turns: [
                {
                  user: "Walk me through how a request gets from `webhookServer.ts` to `resolveAuthContext`.",
                  assistant:
                    "Incoming requests hit `handleRequest` in `webhookServer.ts`, which routes to the org API stack. Auth resolves in `resolveAuthContext`: session cookie → `userStore.resolveUserSession`, otherwise org API key → `orgStore.resolveAuth`. Failures return 401 before route handlers run."
                },
                {
                  user: "Where would SSO sessions plug in?",
                  assistant:
                    "After password/Google login or SAML assertion, `userAuthApi` mints a session token stored in `user_sessions`. The same `resolveUserSession` path loads the user — no separate SSO branch in the router."
                }
              ]
            },
            {
              title: "Who owns billing webhook handler?",
              repoIndex: 1,
              daysAgo: 5,
              turns: [
                {
                  user: "Who last changed the Stripe webhook handler and who should review a retry change?",
                  assistant:
                    "**Alex Chen** owns `billingApi.ts` webhook handling (last commit 12 days ago). For retry semantics, loop in **Blake Diaz** — they added idempotency keys in `billing/checkout` last sprint."
                }
              ]
            },
            {
              title: "Blast radius: repo access policy",
              repoIndex: 0,
              daysAgo: 8,
              turns: [
                {
                  user: "If we switch from `all_indexed` to `per_user`, what breaks for members?",
                  assistant:
                    "Members lose implicit access to all org repos. `resolveAccessibleRepos` returns grant-filtered repos only — dashboard repo list, chat repo context, and Lightning search all shrink to assigned repos. Admins need grants in `user_repo_grants` before flip."
                }
              ]
            },
            {
              title: "Add tests for completion router",
              repoIndex: 2,
              daysAgo: 11,
              turns: [
                {
                  user: "Suggest test cases for `completionRouter.ts` when graph cache is cold.",
                  assistant:
                    "Cover: (1) buffer-only fallback when SCIP unavailable, (2) graph slice attached when cache warm, (3) timeout → degrade without throwing, (4) filter rejects low-confidence ghost text. Mirror patterns in `completionRouter.test.ts`."
                },
                {
                  user: "Draft one test skeleton for the timeout case.",
                  assistant:
                    "```ts\nit('degrades to buffer-only when graph query times out', async () => {\n  mockGraphQuery.mockRejectedValue(new TimeoutError());\n  const result = await routeCompletion(ctx);\n  expect(result.source).toBe('buffer');\n});\n```"
                }
              ]
            },
            {
              title: "Understand repo layout",
              repoIndex: 1,
              daysAgo: 14,
              turns: [
                {
                  user: "Give me a 60-second map of the admin portal app router.",
                  assistant:
                    "`admin/src/app/(admin)/` holds authenticated routes: `/` dashboard, `/analytics` org metrics, `/my-usage` personal analytics, `/feed` synced chat threads, `/my-activity` audit log. Shared layout + sidebar live in `(admin)/layout.tsx`."
                }
              ]
            },
            {
              title: "Debug CAR drop last week",
              repoIndex: 0,
              daysAgo: 18,
              turns: [
                {
                  user: "My completion acceptance rate dipped — what should I check first?",
                  assistant:
                    "Compare `completion.suggested` vs `completion.accepted` in My Analytics. If suggested rose but accepted flat, check latency (`completion.performance`) and whether larger suggestions correlate with rejects. Also confirm you didn't change tab-away behavior in the editor."
                }
              ]
            },
            {
              title: "Patch applier edge cases",
              repoIndex: 2,
              daysAgo: 22,
              turns: [
                {
                  user: "What happens if a patch targets a file that changed since the model read it?",
                  assistant:
                    "`patchApplier` re-reads the buffer before apply. Mismatch surfaces as a conflict event — user can retry with fresh context. See `handlePatchComplete` for the user-facing flow."
                }
              ]
            },
            {
              title: "Quick action: knowledge gaps",
              repoIndex: 1,
              daysAgo: 27,
              turns: [
                {
                  user: "Run a knowledge-gaps pass on the integrations module.",
                  assistant:
                    "Gaps found: (1) no doc for OAuth state TTL, (2) Slack thread sync untested when channel archived, (3) Jira webhook signature rotation undocumented. Highest risk: OAuth state — add test in `adminIntegrationsApi.test.ts`."
                }
              ]
            },
            {
              title: "SAML cert rotation checklist",
              repoIndex: 0,
              daysAgo: 35,
              turns: [
                {
                  user: "We're rotating the IdP signing cert — what do I update in Coop?",
                  assistant:
                    "Admin portal → Settings → Single sign-on → paste new **IdP X.509 cert**. Keep old cert until IdP cutover completes. Smoke test with `scripts/smoke-sso.sh` or mocksaml.com before requiring SSO."
                }
              ]
            },
            {
              title: "Mobile repo index stuck",
              repoIndex: 1,
              daysAgo: 42,
              turns: [
                {
                  user: "Why is `analytics-demo/mobile` stuck in indexing?",
                  assistant:
                    "Job queue shows clone succeeded but SCIP index OOM on last attempt. Re-queue from admin Repos or run `reindex-estate` for the org. Until `indexStatus` is `ready`, Lightning search excludes that repo."
                }
              ]
            }
          ];

          return scenarios.map((scenario, index) => {
            const repo = options.repos[scenario.repoIndex % options.repos.length]!;
            const base = new Date(now - scenario.daysAgo * 24 * 60 * 60 * 1000);
            base.setUTCHours(10 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0, 0);
            const messages: DemoThreadMessage[] = [];
            let sortOrder = 0;
            for (const turn of scenario.turns) {
              const userAt = new Date(base.getTime() + sortOrder * 90_000);
              messages.push({
                id: `${options.prefix}-t${index}-m${sortOrder}`,
                role: "user",
                content: turn.user,
                sortOrder,
                createdAt: userAt
              });
              sortOrder += 1;
              const assistantAt = new Date(userAt.getTime() + 4_000 + Math.floor(rand() * 8_000));
              messages.push({
                id: `${options.prefix}-t${index}-m${sortOrder}`,
                role: "assistant",
                content: turn.assistant,
                sortOrder,
                createdAt: assistantAt
              });
              sortOrder += 1;
            }
            const updatedAt = messages[messages.length - 1]?.createdAt ?? base;
            return {
              id: `${options.prefix}-thread-${index}`,
              title: scenario.title,
              repoOwner: repo.owner,
              repoName: repo.name,
              createdAt: messages[0]?.createdAt ?? base,
              updatedAt,
              messages
            };
          });
        }

        function buildDemoAuditLog(options: {
          orgId: string;
          userId: string;
          principal: string;
          repos: Array<{ owner: string; name: string }>;
          seed: number;
          daysBack: number;
        }): Array<{
          orgId: string;
          userId: string;
          principal: string;
          action: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
        }> {
          const rand = mulberry32(options.seed);
          const rows: Array<{
            orgId: string;
            userId: string;
            principal: string;
            action: string;
            metadata: Record<string, unknown>;
            createdAt: Date;
          }> = [];
          const filePaths = [
            "src/server/meAnalyticsApi.ts",
            "src/autocomplete/completionRouter.ts",
            "admin/src/app/(admin)/my-usage/page.tsx",
            "src/chat/CoopChatSession.ts",
            "src/edit/patchApplier.ts"
          ];
          const now = Date.now();
          for (let dayOffset = 0; dayOffset < options.daysBack; dayOffset += 1) {
            if (rand() > 0.82) {
              continue;
            }
            const day = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
            const loginAt = atHour(day, 9, rand() * 20);
            rows.push({
              orgId: options.orgId,
              userId: options.userId,
              principal: options.principal,
              action: "auth.login",
              metadata: { method: "password" },
              createdAt: loginAt
            });

            const eventsPerDay = 1 + Math.floor(rand() * 4);
            for (let i = 0; i < eventsPerDay; i += 1) {
              const repo = options.repos[Math.floor(rand() * options.repos.length)]!;
              const createdAt = atHour(day, 9 + Math.floor(rand() * 9), rand() * 60);
              const roll = rand();
              if (roll < 0.4) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.principal,
                  action: "chat.completion",
                  metadata: {
                    model: rand() < 0.6 ? "gpt-4o" : "claude-sonnet-4",
                    totalTokens: 600 + Math.floor(rand() * 3200)
                  },
                  createdAt
                });
              } else if (roll < 0.65) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.principal,
                  action: "completion.inline",
                  metadata: { latencyMs: 70 + Math.floor(rand() * 380) },
                  createdAt
                });
              } else if (roll < 0.85) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.principal,
                  action: "repo.file.fetch",
                  metadata: {
                    repoId: `github.com/${repo.owner}/${repo.name}`,
                    path: filePaths[Math.floor(rand() * filePaths.length)]
                  },
                  createdAt
                });
              } else {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.principal,
                  action: "repo.search",
                  metadata: {
                    repoId: `github.com/${repo.owner}/${repo.name}`,
                    query: ["AuthContext", "CompletionRouter", "patchApplier", "auditLogger"][
                      Math.floor(rand() * 4)
                    ]
                  },
                  createdAt
                });
              }
            }
          }
          return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }

        async function seedMemberPortalExperience(options: {
          orgId: string;
          userId: string;
          email: string;
          threadPrefix: string;
          repos: Array<{ owner: string; name: string }>;
          seed: number;
          auditDaysBack: number;
        }): Promise<{ threads: number; auditEntries: number }> {
          const principal = principalForUser(options.userId);
          const threads = buildDemoThreads({
            prefix: options.threadPrefix,
            repos: options.repos,
            seed: options.seed
          });
          for (const thread of threads) {
            await insertDemoThread({
              ...thread,
              orgId: options.orgId,
              userId: options.userId,
              principal
            });
          }
          const auditRows = buildDemoAuditLog({
            orgId: options.orgId,
            userId: options.userId,
            principal,
            repos: options.repos,
            seed: options.seed + 91,
            daysBack: options.auditDaysBack
          });
          await insertAuditBatch(auditRows);
          return { threads: threads.length, auditEntries: auditRows.length };
        }

        async function insertUsageBatch(
          rows: Array<{
            orgId: string;
            userId: string;
            principal: string;
            eventType: string;
            metadata: Record<string, unknown>;
            createdAt: Date;
          }>
        ): Promise<void> {
          const chunkSize = 400;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const values: unknown[] = [];
            const placeholders: string[] = [];
            chunk.forEach((row, idx) => {
              const o = idx * 6;
              placeholders.push(
                `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}::jsonb, $${o + 6})`
              );
              values.push(
                row.orgId,
                row.userId,
                row.principal,
                row.eventType,
                JSON.stringify(row.metadata),
                row.createdAt.toISOString()
              );
            });
            await pool.query(
              `INSERT INTO usage_events (org_id, user_id, principal, event_type, metadata, created_at)
               VALUES ${placeholders.join(", ")}`,
              values
            );
          }
        }

        function generateUserEvents(options: {
          orgId: string;
          userId: string;
          email: string;
          persona: Persona;
          daysBack: number;
          growth?: boolean;
          seed: number;
        }): Array<{
          orgId: string;
          userId: string;
          principal: string;
          eventType: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
        }> {
          const rand = mulberry32(options.seed);
          const rows: Array<{
            orgId: string;
            userId: string;
            principal: string;
            eventType: string;
            metadata: Record<string, unknown>;
            createdAt: Date;
          }> = [];
          if (options.persona === "inactive") {
            return rows;
          }

          const intensity =
            options.persona === "power" ? 1 : options.persona === "regular" ? 0.55 : 0.22;
          const car =
            options.persona === "power" ? 0.42 : options.persona === "regular" ? 0.31 : 0.22;
          const quickActions = [
            "quick_action.understand_repo",
            "quick_action.trace_decision",
            "quick_action.find_owner",
            "quick_action.blast_radius",
            "quick_action.knowledge_gaps"
          ] as const;

          const now = Date.now();
          for (let dayOffset = options.daysBack - 1; dayOffset >= 0; dayOffset--) {
            const day = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
            day.setUTCHours(12, 0, 0, 0);
            if (!weekdayBias(day, rand)) {
              continue;
            }
            const progress = 1 - dayOffset / Math.max(options.daysBack, 1);
            const growthMul = options.growth ? 0.35 + progress * 0.9 : 0.75 + progress * 0.35;
            const dayMul = intensity * growthMul;

            const chatN = Math.floor((2 + rand() * 8) * dayMul);
            for (let i = 0; i < chatN; i++) {
              rows.push({
                orgId: options.orgId,
                userId: options.userId,
                principal: options.email,
                eventType: "chat.message",
                metadata: { totalTokens: 800 + Math.floor(rand() * 4200) },
                createdAt: atHour(day, 9 + Math.floor(rand() * 9), rand() * 60)
              });
            }

            const qaN = Math.floor((rand() * 4) * dayMul);
            for (let i = 0; i < qaN; i++) {
              rows.push({
                orgId: options.orgId,
                userId: options.userId,
                principal: options.email,
                eventType: quickActions[Math.floor(rand() * quickActions.length)]!,
                metadata: {},
                createdAt: atHour(day, 10 + Math.floor(rand() * 8), rand() * 60)
              });
            }

            const suggestedN = Math.floor((8 + rand() * 40) * dayMul);
            for (let i = 0; i < suggestedN; i++) {
              const createdAt = atHour(day, 9 + Math.floor(rand() * 10), rand() * 60);
              rows.push({
                orgId: options.orgId,
                userId: options.userId,
                principal: options.email,
                eventType: "completion.suggested",
                metadata: {},
                createdAt
              });
              if (rand() < 0.85) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.email,
                  eventType: "completion.requested",
                  metadata: { latencyMs: 80 + Math.floor(rand() * 420) },
                  createdAt: new Date(createdAt.getTime() - 50 - Math.floor(rand() * 200))
                });
              }
              if (rand() < car) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.email,
                  eventType: "completion.accepted",
                  metadata: {},
                  createdAt: new Date(createdAt.getTime() + 200 + Math.floor(rand() * 2000))
                });
              } else if (rand() < 0.15) {
                rows.push({
                  orgId: options.orgId,
                  userId: options.userId,
                  principal: options.email,
                  eventType: "completion.rejected",
                  metadata: {},
                  createdAt: new Date(createdAt.getTime() + 100 + Math.floor(rand() * 800))
                });
              }
            }

            if (rand() < 0.35 * dayMul) {
              rows.push({
                orgId: options.orgId,
                userId: options.userId,
                principal: options.email,
                eventType: "completion.performance",
                metadata: {
                  p50LatencyMs: 90 + Math.floor(rand() * 80),
                  p95LatencyMs: 180 + Math.floor(rand() * 220),
                  sampleCount: 20 + Math.floor(rand() * 80)
                },
                createdAt: atHour(day, 17, rand() * 40)
              });
            }

            const searchN = Math.floor((rand() * 5) * dayMul);
            for (let i = 0; i < searchN; i++) {
              rows.push({
                orgId: options.orgId,
                userId: options.userId,
                principal: options.email,
                eventType: "lightning.search",
                metadata: { hits: Math.floor(rand() * 12) },
                createdAt: atHour(day, 11 + Math.floor(rand() * 6), rand() * 60)
              });
            }
          }
          return rows;
        }

        // --- Company: 25 users, ~90 days ---
        const companyUsers: SeedUser[] = FIRST.map((first, i) => {
          const email = `${first}.${LAST[i]}@analytics-demo.local`;
          let role: UserRole = "member";
          let persona: Persona = "regular";
          if (i === 0) {
            role = "admin";
            persona = "power";
          } else if (i === 1 || i === 2) {
            role = "admin";
            persona = i === 1 ? "power" : "regular";
          } else if (i <= 6) {
            persona = "power";
          } else if (i <= 16) {
            persona = "regular";
          } else if (i <= 21) {
            persona = "light";
          } else {
            persona = "inactive";
          }
          return {
            email,
            role,
            persona,
            displayName: `${first[0]!.toUpperCase()}${first.slice(1)} ${LAST[i]![0]!.toUpperCase()}${LAST[i]!.slice(1)}`
          };
        });

        const companyOrg = await store.createOrganization("Analytics Demo Co", "pro");
        await store.updateRepoAccessMode(companyOrg.id, "all_indexed");
        await store.updateOrganizationBilling(companyOrg.id, {
          billingEmail: companyUsers[0]!.email,
          seatCount: 30,
          billingStatus: "active"
        });

        const companyAccounts: Array<{
          email: string;
          role: UserRole;
          persona: Persona;
          userId: string;
          password: string;
        }> = [];
        const companyRows: Array<{
          orgId: string;
          userId: string;
          principal: string;
          eventType: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
        }> = [];

        for (let i = 0; i < companyUsers.length; i++) {
          const entry = companyUsers[i]!;
          const user = await userStore.createUser(companyOrg.id, entry.email, entry.role);
          await authIdentityStore.createPasswordIdentity(user.id, hashPassword(demoPassword));
          companyAccounts.push({
            email: entry.email,
            role: entry.role,
            persona: entry.persona,
            userId: user.id,
            password: demoPassword
          });
          companyRows.push(
            ...generateUserEvents({
              orgId: companyOrg.id,
              userId: user.id,
              email: entry.email,
              persona: entry.persona,
              daysBack: 90,
              growth: true,
              seed: 1000 + i * 17
            })
          );
        }
        await insertUsageBatch(companyRows);

        const companyRepos = [
          { owner: "analytics-demo", name: "platform" },
          { owner: "analytics-demo", name: "web" },
          { owner: "analytics-demo", name: "api" }
        ];
        const harperAccount = companyAccounts.find((a) => a.email === "harper.jones@analytics-demo.local");
        const harperPortal = harperAccount
          ? await seedMemberPortalExperience({
              orgId: companyOrg.id,
              userId: harperAccount.userId,
              email: harperAccount.email,
              threadPrefix: "harper",
              repos: companyRepos,
              seed: 7707,
              auditDaysBack: 60
            })
          : { threads: 0, auditEntries: 0 };

        const demoRepos = [
          { repoId: "github.com/analytics-demo/platform", status: "ready" as const },
          { repoId: "github.com/analytics-demo/web", status: "ready" as const },
          { repoId: "github.com/analytics-demo/api", status: "ready" as const },
          { repoId: "github.com/analytics-demo/mobile", status: "indexing" as const },
          { repoId: "github.com/analytics-demo/docs", status: "idle" as const }
        ];
        for (const repo of demoRepos) {
          await store.upsertOrgRepo(companyOrg.id, repo.repoId, {
            lightningEnabled: true,
            indexStatus: repo.status,
            lastIndexedAt: repo.status === "ready" ? new Date() : undefined
          });
        }

        // --- Solo: 1 user, 4 months ---
        const soloEmail = "jordan.lee@solo-demo.local";
        const soloOrg = await store.createOrganization("Solo Analytics Demo", "pro");
        await store.updateRepoAccessMode(soloOrg.id, "all_indexed");
        await store.updateOrganizationBilling(soloOrg.id, {
          billingEmail: soloEmail,
          seatCount: 1,
          billingStatus: "active"
        });
        const soloUser = await userStore.createUser(soloOrg.id, soloEmail, "admin");
        await authIdentityStore.createPasswordIdentity(soloUser.id, hashPassword(demoPassword));
        const soloRows = generateUserEvents({
          orgId: soloOrg.id,
          userId: soloUser.id,
          email: soloEmail,
          persona: "power",
          daysBack: 120,
          growth: true,
          seed: 4242
        });
        await insertUsageBatch(soloRows);
        const soloRepos = [{ owner: "jordanlee", name: "side-project" }];
        const soloPortal = await seedMemberPortalExperience({
          orgId: soloOrg.id,
          userId: soloUser.id,
          email: soloEmail,
          threadPrefix: "jordan",
          repos: soloRepos,
          seed: 5150,
          auditDaysBack: 90
        });
        await store.upsertOrgRepo(soloOrg.id, "github.com/jordanlee/side-project", {
          lightningEnabled: true,
          indexStatus: "ready",
          lastIndexedAt: new Date()
        });

        console.log(
          JSON.stringify(
            {
              password: demoPassword,
              adminPortalUrl: "http://localhost:3001/login",
              apiBase: "http://localhost:8787",
              company: {
                orgId: companyOrg.id,
                orgName: companyOrg.name,
                plan: "pro",
                seats: 30,
                users: 25,
                usageEvents: companyRows.length,
                daysOfHistory: 90,
                adminLogin: {
                  email: companyAccounts[0]!.email,
                  password: demoPassword,
                  note: "Org admin — open /analytics for company-wide charts"
                },
                memberLogin: {
                  email: companyAccounts.find((a) => a.persona === "regular" && a.role === "member")
                    ?.email,
                  password: demoPassword,
                  note: "Member — /my-usage, /feed, /my-activity",
                  chatThreads: harperPortal.threads,
                  auditEntries: harperPortal.auditEntries
                },
                inactiveExample: companyAccounts.find((a) => a.persona === "inactive")?.email,
                personas: {
                  power: companyAccounts.filter((a) => a.persona === "power").length,
                  regular: companyAccounts.filter((a) => a.persona === "regular").length,
                  light: companyAccounts.filter((a) => a.persona === "light").length,
                  inactive: companyAccounts.filter((a) => a.persona === "inactive").length
                }
              },
              solo: {
                orgId: soloOrg.id,
                orgName: soloOrg.name,
                plan: "pro",
                usageEvents: soloRows.length,
                daysOfHistory: 120,
                login: {
                  email: soloEmail,
                  password: demoPassword,
                  note: "Solo user — /analytics, /my-usage, /feed, /my-activity",
                  chatThreads: soloPortal.threads,
                  auditEntries: soloPortal.auditEntries
                }
              }
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
          "Commands: create-org, set-plan, upgrade-user-by-email, list-orgs, create-api-key, configure-sso, create-user, set-user-role, seed-repo-access-demo, seed-pro-onboarding, seed-enterprise-sso-demo, seed-governance-demo, seed-analytics-demo, set-repo-access-mode, reindex-estate"
        );
        process.exit(1);
    }
  } finally {
    await closeDbPool();
  }
}

void main();
