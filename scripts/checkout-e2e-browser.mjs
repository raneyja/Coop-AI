#!/usr/bin/env node
/**
 * Full browser checkout E2E — signup form → Stripe test card → welcome page → API verify.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const env = parseEnv(readFileSync(resolve(ROOT, ".env.backend"), "utf8"));

const WEBSITE = "http://localhost:3001";
const API = "http://localhost:8787";
const TEST_EMAIL = `e2e+${Date.now()}@coop-ai.dev`;
const TEST_ORG = `Live Test ${new Date().toLocaleTimeString("en-US", { hour12: false })}`;

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

async function step(label, fn) {
  process.stdout.write(`  ${label}… `);
  try {
    const result = await fn();
    console.log("OK");
    return result;
  } catch (error) {
    console.log("FAIL");
    throw error;
  }
}

async function main() {
  console.log("\nCoop AI — browser checkout E2E\n");
  console.log(`  Org:   ${TEST_ORG}`);
  console.log(`  Email: ${TEST_EMAIL}\n`);

  await step("API health", async () => {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(String(res.status));
  });

  let sessionId = "";
  let welcomeUrl = "";

  await step("Stripe Checkout (test card 4242…)", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`${WEBSITE}/signup`, { waitUntil: "networkidle" });
    await page.fill("#orgName", TEST_ORG);
    await page.fill("#email", TEST_EMAIL);
    await page.fill("#seats", "2");
    await page.click('button[type="submit"]');

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

    const stripeFrame = page.frameLocator('iframe[name*="__privateStripeFrame"]').first();
    const cardInput = page.locator('input[name="cardNumber"], input[placeholder*="1234"]').first();
    if (await cardInput.count()) {
      await cardInput.fill("4242424242424242");
      await page.locator('input[name="cardExpiry"], input[placeholder*="MM"]').first().fill("1234");
      await page.locator('input[name="cardCvc"], input[placeholder*="CVC"]').first().fill("123");
      await page.locator('input[name="billingName"], input[placeholder*="Name"]').first().fill("Test Admin");
    } else {
      await page.getByLabel(/card number/i).fill("4242424244244242");
      await page.getByLabel(/expiration/i).fill("12 / 34");
      await page.getByLabel(/cvc|security code/i).fill("123");
      await page.getByLabel(/name on card|cardholder/i).fill("Test Admin");
    }

    await page.getByRole("button", { name: /pay|subscribe|start trial/i }).click();

    await page.waitForURL(/\/welcome\?session_id=/, { timeout: 90000 });
    welcomeUrl = page.url();
    sessionId = new URL(welcomeUrl).searchParams.get("session_id") ?? "";
    if (!sessionId.startsWith("cs_")) throw new Error(`no session_id in ${welcomeUrl}`);

    await page.waitForSelector("text=Next steps", { timeout: 15000 });
    const body = await page.textContent("body");
    if (body?.includes("couldn't verify")) {
      throw new Error("welcome page showed invalid checkout");
    }

    await browser.close();
  });

  await step("Wait for provisioning (checkout-status → ready)", async () => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const res = await fetch(
        `${WEBSITE}/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`
      );
      const data = await res.json();
      if (data.status === "ready" && data.orgName === TEST_ORG) return data;
      if (data.status === "invalid") {
        throw new Error(`checkout-status invalid: ${JSON.stringify(data)}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("timed out waiting for org provisioning");
  });

  const orgId = await step("Org in Postgres", async () => {
    const sql = `SELECT id, name, plan FROM organizations WHERE name = '${TEST_ORG.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1;`;
    const out = execSync(
      `docker exec coopai-postgres-1 psql -U coop -d coopai -t -A -F'|' -c "${sql}"`,
      { encoding: "utf8" }
    ).trim();
    if (!out) throw new Error("org not found");
    const [id, name, plan] = out.split("|");
    if (name !== TEST_ORG) throw new Error(`name mismatch: ${name}`);
    if (plan !== "pro") throw new Error(`plan mismatch: ${plan}`);
    return id;
  });

  const adminKey = await step("Admin API key + /v1/me", async () => {
    const out = execSync(
      `docker exec -e DATABASE_URL=postgres://coop:coop@postgres:5432/coopai coopai-api-1 node -e "
        const { Pool } = require('pg');
        const crypto = require('crypto');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        (async () => {
          const raw = 'coop_' + crypto.randomBytes(24).toString('hex');
          const hash = crypto.createHash('sha256').update(raw).digest('hex');
          await pool.query(
            'INSERT INTO api_keys (org_id, label, key_hash) VALUES ($1, $2, $3)',
            ['${orgId}', 'e2e-test', hash]
          );
          console.log(raw);
          await pool.end();
        })();
      "`,
      { encoding: "utf8" }
    ).trim();

    const res = await fetch(`${API}/v1/me`, {
      headers: { Authorization: `Bearer ${out}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`/v1/me ${res.status}: ${JSON.stringify(data)}`);
    if (data.orgName !== TEST_ORG) throw new Error(`orgName: ${data.orgName}`);
    if (data.plan !== "pro") throw new Error(`plan: ${data.plan}`);
    return out;
  });

  console.log("\nAll steps passed.\n");
  console.log("  Welcome URL:", welcomeUrl);
  console.log("  Session:    ", sessionId);
  console.log("  Org ID:     ", orgId);
  console.log("  Test key:   ", adminKey, "(created for verification; welcome email sent separately)");
  console.log("  Admin login:", `${env.COOP_ADMIN_PORTAL_URL}/login`);
  console.log("");
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
