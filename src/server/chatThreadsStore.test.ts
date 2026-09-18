import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  ChatThreadsStore,
  buildThreadListWhere,
  decodeThreadCursor,
  encodeThreadCursor
} from "./chatThreadsStore";

void (async () => {
  const orgId = "org-1";
  const personalScope = { userId: "user-1", principal: "user:user-1" };
  const base = {
    orgId,
    limit: 20,
    memberScope: personalScope
  };

  const personalFilters = buildThreadListWhere(base);
  assert.match(personalFilters.clauses.join(" "), /user_id = \$2 OR principal = \$3/);
  assert.deepEqual(personalFilters.params, [orgId, "user-1", "user:user-1"]);

  const ownSearch = buildThreadListWhere({
    ...base,
    query: "auth",
    repoOwner: "acme",
    repoName: "api",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-06-01T00:00:00.000Z")
  });
  assert.ok(ownSearch.clauses.some((clause) => clause.includes("user_id") && clause.includes("principal")));
  assert.equal(ownSearch.params[0], orgId);
  assert.equal(ownSearch.params[1], "user-1");
  assert.equal(ownSearch.params[2], "user:user-1");
  assert.match(ownSearch.clauses.join(" "), /title ILIKE/);

  const foreignUserId = buildThreadListWhere({
    ...base,
    userId: "user-2"
  });
  assert.ok(foreignUserId.clauses.some((clause) => clause.includes("user_id") && clause.includes("principal")));
  assert.ok(foreignUserId.clauses.includes("user_id = $4"));
  assert.deepEqual(foreignUserId.params, [orgId, "user-1", "user:user-1", "user-2"]);

  const apiKeyScope = buildThreadListWhere({
    orgId,
    limit: 20,
    memberScope: { principal: "apikey:key-1" }
  });
  assert.match(apiKeyScope.clauses.join(" "), /principal = \$2/);
  assert.deepEqual(apiKeyScope.params, [orgId, "apikey:key-1"]);
  assert.equal(
    apiKeyScope.clauses.some((clause) => clause === "org_id = $1"),
    true
  );

  const cursorAt = new Date("2026-06-15T12:00:00.000Z");
  const cursorId = "thread-abc";
  const encoded = encodeThreadCursor(cursorAt, cursorId);
  const decoded = decodeThreadCursor(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.id, cursorId);
  assert.equal(decoded?.updatedAt.toISOString(), cursorAt.toISOString());
  assert.equal(decodeThreadCursor("not-a-cursor"), undefined);

  const dummyPool = {
    query: async () => {
      throw new Error("listThreads must not query without memberScope");
    }
  } as unknown as Pool;
  const store = new ChatThreadsStore(dummyPool);
  const unscoped = await store.listThreads({ orgId, limit: 20 });
  assert.deepEqual(unscoped.threads, []);
  assert.equal(unscoped.nextCursor, undefined);

  console.log("chatThreadsStore.test.ts: ok");
})();
