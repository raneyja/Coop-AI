import pg from "pg";
import { loadServerConfig } from "../src/server/serverConfig";
import { loadBillingConfig } from "../src/server/billing/billingConfig";
import { StripeService } from "../src/server/billing/stripeService";
import { reconcileBilling } from "../src/server/billing/billingRecovery";
import { OrgStore } from "../src/server/orgStore";
import { UserStore } from "../src/server/users/userStore";
import { AuthIdentityStore } from "../src/server/auth/authIdentityStore";
import { AuthTokenStore } from "../src/server/auth/authTokenStore";
import { EmailService } from "../src/server/email/emailService";
import databasePoolOptions from "../src/server/databasePoolOptions.cjs";

export async function main() {
  if (process.argv[2] !== "--apply") throw new Error("Use --apply with reviewed operator configuration");
  if (!process.env.DATABASE_URL) throw new Error("Database configuration is required");
  // Shared TLS owner validates the DSN without retaining credential-bearing
  // parser errors, loads reviewed CA configuration, and removes SSL overrides.
  const options = databasePoolOptions(process.env.DATABASE_URL);
  const target = new URL(String(options.connectionString));
  if (!["postgres:","postgresql:"].includes(target.protocol) || !target.hostname || !target.username || target.pathname.length<2 || target.search || target.hash) {
    throw new Error("Recovery requires an explicit PostgreSQL target without URL overrides");
  }
  const expectedDatabase = process.argv[3],expectedUser = process.argv[4];
  if (!expectedDatabase || !expectedUser) throw new Error("Provide expected database and user after --apply");
  const serverConfig = loadServerConfig(),billingConfig = loadBillingConfig();
  if (!serverConfig.credentialsEncryptionKey || !billingConfig.stripeSecretKey || !billingConfig.resendApiKey || billingConfig.emailMock) {
    throw new Error("Recovery requires database, encryption and real provider configuration");
  }
  const pool = new pg.Pool(options);
  try {
    const actual = (await pool.query("SELECT current_database() AS db,current_user AS actor")).rows[0];
    if (actual.db!==expectedDatabase || actual.actor!==expectedUser) throw new Error("Effective recovery database target differs from reviewed target");
    const deps = { pool,serverConfig,orgStore: new OrgStore(pool,serverConfig.credentialsEncryptionKey),userStore: new UserStore(pool),
      authIdentityStore: new AuthIdentityStore(pool),authTokenStore: new AuthTokenStore(pool),emailService: new EmailService(billingConfig) };
    const result = await reconcileBilling(deps,new StripeService(billingConfig));
    console.log(JSON.stringify(result));
    if (result.failed || result.legacyUnresolved || result.email.failed || result.email.uncertain) process.exitCode = 2;
  } finally { await pool.end(); }
}

if (require.main === module) {
  void main().catch(() => { console.error("Billing recovery failed; inspect aggregate recovery state without printing credentials or message payloads"); process.exitCode = 1; });
}
