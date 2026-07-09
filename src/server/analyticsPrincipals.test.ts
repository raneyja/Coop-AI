import assert from "node:assert/strict";
import { buildPrincipalResolver, countDistinctResolvedPrincipals, mergePrincipalCounts } from "./analyticsPrincipals";

const members = [{ id: "u1", email: "alex@acme.com" }];

void (async () => {
  const merged = mergePrincipalCounts(
    [
      { principal: "user:u1", count: 10 },
      { principal: "u1", count: 5 },
      { principal: "alex@acme.com", count: 2 }
    ],
    members
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.count, 17);
  assert.equal(merged[0]?.email, "alex@acme.com");

  const distinct = countDistinctResolvedPrincipals(["user:u1", "u1", "apikey:k1", "apikey:k1"], members);
  assert.equal(distinct, 2);

  const resolver = buildPrincipalResolver(members);
  assert.equal(resolver.resolve("user:u1").label, "alex@acme.com");
  assert.equal(resolver.resolve("apikey:abcd").kind, "apikey");

  console.log("analyticsPrincipals.test.ts: ok");
})();
