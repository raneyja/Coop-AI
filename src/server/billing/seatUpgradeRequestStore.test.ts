import assert from "node:assert/strict";
import { test } from "node:test";
import { SeatUpgradeRequestStore } from "./seatUpgradeRequestStore";

test("listForOrg returns every status, newest first", async () => {
  const queries: string[] = [];
  const store = new SeatUpgradeRequestStore({
    query: async (sql: string) => {
      queries.push(sql);
      return {
        rows: [
          {
            id: "newer",
            org_id: "org-1",
            user_id: "u2",
            from_tier: "pro_plus",
            to_tier: "max",
            status: "denied",
            created_at: "2026-09-09T12:00:00.000Z",
            resolved_at: "2026-09-09T13:00:00.000Z",
            resolved_by: "admin-1"
          },
          {
            id: "older",
            org_id: "org-1",
            user_id: "u1",
            from_tier: "pro",
            to_tier: "pro_plus",
            status: "pending",
            created_at: "2026-09-08T12:00:00.000Z"
          }
        ]
      };
    }
  } as never);

  const rows = await store.listForOrg("org-1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.status, "denied");
  assert.equal(rows[0]?.resolvedBy, "admin-1");
  assert.equal(rows[1]?.status, "pending");
  assert.match(queries[0] ?? "", /ORDER BY created_at DESC/i);
});
