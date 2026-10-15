import assert from "node:assert/strict";
import { createServer } from "node:http";
import pg from "pg";
import { loadBillingConfig } from "./billingConfig";
import { StripeService } from "./stripeService";
import { EmailService } from "../email/emailService";
import { OrgStore } from "../orgStore";
import { UserStore } from "../users/userStore";
import { AuthTokenStore } from "../auth/authTokenStore";
import { AuthIdentityStore } from "../auth/authIdentityStore";
import { handleBillingApiRequest, type BillingApiDeps } from "./billingApi";

export const fixtureSecret = "whsec_eh09_disposable_fixture";
export function ownedDatabase() {
  const {publicationDatabaseFromEnvironment} = require('../../../scripts/publication-test-fixture.mjs');
  return publicationDatabaseFromEnvironment(process.env, 'billing');
}
export function routeFixtureProviders(base: string) {
  const destination = new URL(base); assert.equal(destination.hostname,"127.0.0.1");
  const original = globalThis.fetch;
  globalThis.fetch = async (input,init) => {
    const source = new URL(input instanceof Request ? input.url : String(input));
    if (["api.stripe.com","api.resend.com"].includes(source.hostname)) {
      return original(`${base}${source.pathname}${source.search}`,init);
    }
    if (source.hostname !== "127.0.0.1") throw new Error("Remote vendor access prohibited in billing fixture");
    return original(input,init);
  };
  return () => { globalThis.fetch = original; };
}
export function billingDeps(pool: pg.Pool): BillingApiDeps {
  const config = loadBillingConfig({ STRIPE_SECRET_KEY: "sk_fixture_not_live",STRIPE_WEBHOOK_SECRET: fixtureSecret,
    RESEND_API_KEY: "re_fixture_not_live",STRIPE_PRICE_ID_PRO: "price_pro",COOP_EMAIL_MOCK: "false",COOP_PUBLIC_BASE_URL: "https://api.coop-ai.dev" });
  return { pool,orgStore: new OrgStore(pool),userStore: new UserStore(pool),authTokenStore: new AuthTokenStore(pool),
    authIdentityStore: new AuthIdentityStore(pool),emailService: new EmailService(config),stripeService: new StripeService(config),
    serverConfig: { nodeEnv: "test",jobsWorkersEnabled: false,devMode: false,requireApiAuth: true,credentialsEncryptionKey: "eh09-disposable-encryption-only" } };
}
export async function billingServer(deps: BillingApiDeps) {
  const server = createServer(async (request,response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks),url = new URL(request.url!,"http://127.0.0.1");
    try {
      const handled = await handleBillingApiRequest({ method: request.method!,pathname: url.pathname,query: url.searchParams,
        headers: { "stripe-signature": String(request.headers["stripe-signature"] ?? ""),authorization: String(request.headers.authorization ?? "") },
        body: rawBody.length ? JSON.parse(rawBody.toString()) : {},rawBody },response,deps);
      if (!handled) { response.writeHead(404);response.end(); }
    } catch { response.writeHead(500);response.end(JSON.stringify({ error: "fixture_boundary_failed" })); }
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

// A real disposable worker process is killed at each actual persistence boundary.
if (process.argv[2] === "--crash-worker") {
  void (async () => {
    const stage = process.argv[3],pool = new pg.Pool({ connectionString: ownedDatabase() });
    routeFixtureProviders(process.env.EH09_FIXTURE_VENDOR_BASE!);
    const stop = async () => { process.stdout.write("REACHED\n");await new Promise<void>(() => {}); };
    const crashPool = new Proxy(pool,{ get(target,key) {
      if (key === "connect") return async () => {
        if (stage === "claimed") await stop();
        const client = await target.connect();
        return new Proxy(client,{ get(connection,property) {
          if (property === "query") return async (...args: unknown[]) => {
            const sql = String(args[0]);
            if (stage === "before-complete" && sql.includes("UPDATE stripe_webhook_events SET status='completed'")) await stop();
            const result = await Reflect.apply(connection.query,connection,args);
            if ((stage === "effect" && sql.includes("INSERT INTO users")) || (stage === "committed" && sql === "COMMIT") || (stage === "mail-admitted" && sql.includes("EXTRACT(EPOCH FROM") && (args[1] as unknown[])?.[0] === `billing/checkout/${process.env.EH09_CRASH_CHECKOUT_ID}`)) await stop();
            return result;
          };
          const value = Reflect.get(connection,property);return typeof value === "function" ? value.bind(connection) : value;
        } });
      };
      const value = Reflect.get(target,key);return typeof value === "function" ? value.bind(target) : value;
    } });
    const server = await billingServer(billingDeps(crashPool));process.stdout.write(`READY ${server.base}\n`);
  })().catch(() => { process.stderr.write("crash fixture failed\n");process.exitCode = 1; });
}
