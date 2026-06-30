import assert from "node:assert/strict";
import { buildThreadListWhere, decodeThreadCursor, encodeThreadCursor } from "./chatThreadsStore";

void (async () => {
  const orgId = "org-1";
  const base = {
    orgId,
    limit: 20
  };

  const adminFilters = buildThreadListWhere({
    ...base,
    query: "auth",
    repoOwner: "acme",
    repoName: "api",
    userId: "user-2",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-06-01T00:00:00.000Z")
  });
  assert.equal(adminFilters.clauses.length, 7);
  assert.deepEqual(adminFilters.params.slice(0, 4), [
    orgId,
    "user-2",
    "acme",
    "api"
  ]);
  assert.match(adminFilters.clauses.join(" "), /title ILIKE/);

  const memberFilters = buildThreadListWhere({
    ...base,
    memberScope: { userId: "user-1", principal: "user:user-1" }
  });
  assert.match(memberFilters.clauses.join(" "), /user_id = \$2 OR principal = \$3/);
  assert.deepEqual(memberFilters.params, [orgId, "user-1", "user:user-1"]);

  const cursorAt = new Date("2026-06-15T12:00:00.000Z");
  const cursorId = "thread-abc";
  const encoded = encodeThreadCursor(cursorAt, cursorId);
  const decoded = decodeThreadCursor(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.id, cursorId);
  assert.equal(decoded?.updatedAt.toISOString(), cursorAt.toISOString());
  assert.equal(decodeThreadCursor("not-a-cursor"), undefined);

  console.log("chatThreadsStore.test.ts: ok");
})();
