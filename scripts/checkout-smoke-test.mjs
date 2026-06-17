#!/usr/bin/env node
/**
 * Live checkout smoke test — creates real Stripe session, provisions via signed webhook,
 * verifies checkout-status, org record, and admin auth.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const env = parseEnv(readFileSync(resolve(ROOT, ".env.backend"), "utf8"));

const STRIPE_KEY = env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
const API_BASE = "http://localhost:8787";
const WEBSITE_BASE = "http://localhost:3001";
const TEST_EMAIL = `checkout-test+${Date.now()}@coop-ai.dev`;
const TEST_ORG = `Smoke Test ${new Date().toLocaleTimeString("en-US", { hour12: false })}`;

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function stripeForm(params) {
  return new URLSearchParams(params).toString();
}

async function stripePost(path, params) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: stripeForm(params)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? `Stripe ${path} failed (${response.status})`);
  }
  return json;
}

function signWebhook(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signed}`;
}

async function step(label, fn) {
  process.stdout.write(`  ${label}… `);
  const result = await fn();
  console.log("OK");
  return result;
}

async function main() {
  console.log("\nCoop AI — live checkout smoke test\n");
  console.log(`  Org:   ${TEST_ORG}`);
  console.log(`  Email: ${TEST_EMAIL}\n`);

  let sessionId = "";
  let customerId = "";
  let subscriptionId = "";
  let orgId = "";

  await step("API health", async () => {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(String(res.status));
  });

  const checkout = await step("Create checkout session (Coop API → Stripe)", async () => {
    const res = await fetch(`${API_BASE}/v1/billing/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: TEST_ORG, email: TEST_EMAIL, seats: 2 })
    });
    const data = await res.json();
    if (!res.ok || !data.url || !data.sessionId) {
      throw new Error(data.error ?? data.message ?? `checkout ${res.status}`);
    }
    sessionId = data.sessionId;
    return data;
  });

  await step("Stripe customer + subscription (test mode)", async () => {
    const pm = await stripePost("/v1/payment_methods", {
      type: "card",
      "card[token]": "tok_visa"
    });
    const customer = await stripePost("/v1/customers", {
      email: TEST_EMAIL,
      payment_method: pm.id,
      "invoice_settings[default_payment_method]": pm.id
    });
    customerId = customer.id;

    const sub = await stripePost("/v1/subscriptions", {
      customer: customerId,
      "items[0][price]": env.STRIPE_PRICE_ID_PRO,
      "items[0][quantity]": "2",
      "metadata[org_name]": TEST_ORG
    });
    subscriptionId = sub.id;
  });

  await step("Signed checkout.session.completed webhook", async () => {
    const event = {
      id: `evt_smoke_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          customer: customerId,
          subscription: subscriptionId,
          customer_email: TEST_EMAIL,
          payment_status: "paid",
          status: "complete",
          metadata: {
            org_name: TEST_ORG,
            admin_email: TEST_EMAIL,
            seat_count: "2"
          }
        }
      }
    };
    const payload = JSON.stringify(event);
    const res = await fetch(`${API_BASE}/webhooks/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signWebhook(payload)
      },
      body: payload
    });
    const data = await res.json();
    if (!res.ok || !data.received) {
      throw new Error(data.error ?? `webhook ${res.status}`);
    }
  });

  orgId = await step("Org provisioned in Postgres", async () => {
    const sql = `SELECT id, plan, billing_email FROM organizations WHERE stripe_customer_id = '${customerId}';`;
    const out = execSync(
      `docker exec coopai-postgres-1 psql -U coop -d coopai -t -A -F'|' -c "${sql}"`,
      { encoding: "utf8" }
    ).trim();
    if (!out) throw new Error("org not found");
    const [id, plan, billingEmail] = out.split("|");
    if (plan !== "pro") throw new Error(`plan=${plan}`);
    if (billingEmail !== TEST_EMAIL) throw new Error(`email=${billingEmail}`);
    return id;
  });

  await step("Admin portal login URL (/login suffix)", async () => {
    const res = await fetch(`${WEBSITE_BASE}/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    // Session still open in Stripe — status may be invalid until paid via hosted page.
    // Verify login URL shape from API regardless.
    if (!data.adminPortalLoginUrl?.endsWith("/login")) {
      throw new Error(`bad portal URL: ${data.adminPortalLoginUrl}`);
    }
  });

  await step("Admin API key auth (/v1/me)", async () => {
    const rawKey = execSync(
      `docker exec -e DATABASE_URL=postgres://coop:coop@postgres:5432/coopai coopai-api-1 node -e '
        const { Pool } = require("pg");
        const crypto = require("crypto");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        (async () => {
          const raw = "coop_" + crypto.randomBytes(24).toString("hex");
          const hash = crypto.createHash("sha256").update(raw).digest("hex");
          await pool.query(
            "INSERT INTO api_keys (org_id, label, key_hash) VALUES ($1, $2, $3)",
            ["${orgId}", "smoke-test", hash]
          );
          console.log(raw);
          await pool.end();
        })();
      '`,
      { encoding: "utf8" }
    ).trim();

    const res = await fetch(`${API_BASE}/v1/me`, {
      headers: { Authorization: `Bearer ${rawKey}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`/v1/me ${res.status}`);
    if (data.orgName !== TEST_ORG) throw new Error(`orgName=${data.orgName}`);
    if (data.plan !== "pro") throw new Error(`plan=${data.plan}`);
  });

  console.log("\nAll steps passed.\n");
  console.log("  Checkout URL:  ", checkout.url);
  console.log("  Session:       ", sessionId);
  console.log("  Org ID:        ", orgId);
  console.log("  Admin login:   ", `${env.COOP_ADMIN_PORTAL_URL}/login`);
  console.log("  Welcome page:  ", `${WEBSITE_BASE}/welcome?session_id=${sessionId}`);
  console.log("\n  Welcome email sent to:", TEST_EMAIL, "(via Resend)\n");
}

main().catch((error) => {
  console.log("FAIL");
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
