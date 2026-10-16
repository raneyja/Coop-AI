/** Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/publicSessionProfile.test.ts */
import assert from "node:assert/strict";
import { publicSessionProfile } from "./publicSessionProfile";

assert.deepEqual(
  publicSessionProfile({
    orgId: "o1",
    orgName: "Acme",
    plan: "pro",
    email: "founder@example.test",
    accessToken: "must-not-return",
    refreshToken: "must-not-return",
    internalAuthState: { secret: "must-not-return" }
  }),
  { orgId: "o1", orgName: "Acme", plan: "pro", email: "founder@example.test" }
);

console.log("publicSessionProfile.test.ts: ok");
