import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyOrgAdminsOfSeatUpgradeRequest } from "./notifySeatUpgradeRequest";
import type { UserRecord } from "../users/userStore";

function user(partial: Partial<UserRecord> & Pick<UserRecord, "id" | "email" | "role">): UserRecord {
  return {
    orgId: "org-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...partial
  };
}

test("emails every active admin and owner, skips members and deactivated", async () => {
  const sent: string[] = [];
  const result = await notifyOrgAdminsOfSeatUpgradeRequest({
    users: [
      user({ id: "a1", email: "owner@acme.com", role: "owner" }),
      user({ id: "a2", email: "admin@acme.com", role: "admin" }),
      user({ id: "m1", email: "member@acme.com", role: "member" }),
      user({
        id: "a3",
        email: "gone@acme.com",
        role: "admin",
        deactivatedAt: new Date("2026-02-01T00:00:00.000Z")
      }),
      user({ id: "a4", email: "  ", role: "admin" })
    ],
    send: async (params) => {
      sent.push(params.to);
    },
    orgName: "Acme",
    memberEmail: "member@acme.com",
    fromTier: "pro",
    toTier: "pro_plus",
    reviewUrl: "https://admin.coop-ai.dev/requests"
  });
  assert.deepEqual(sent.sort(), ["admin@acme.com", "owner@acme.com"]);
  assert.equal(result.adminCount, 2);
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.mocked, false);
});

test("one failed send does not block the rest", async () => {
  const sent: string[] = [];
  const result = await notifyOrgAdminsOfSeatUpgradeRequest({
    users: [
      user({ id: "a1", email: "bad@acme.com", role: "admin" }),
      user({ id: "a2", email: "ok@acme.com", role: "admin" })
    ],
    send: async (params) => {
      if (params.to.startsWith("bad")) {
        throw new Error("Resend failed");
      }
      sent.push(params.to);
    },
    orgName: "Acme",
    memberEmail: "member@acme.com",
    fromTier: "pro",
    toTier: "max",
    reviewUrl: "https://admin.coop-ai.dev/requests"
  });
  assert.deepEqual(sent, ["ok@acme.com"]);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.adminCount, 2);
});

test("mocked send is reported so callers can log it", async () => {
  const result = await notifyOrgAdminsOfSeatUpgradeRequest({
    users: [user({ id: "a1", email: "admin@acme.com", role: "admin" })],
    send: async () => ({ mocked: true }),
    orgName: "Acme",
    memberEmail: "member@acme.com",
    fromTier: "pro",
    toTier: "pro_plus",
    reviewUrl: "https://admin.coop-ai.dev/requests"
  });
  assert.equal(result.mocked, true);
  assert.equal(result.sent, 1);
});
