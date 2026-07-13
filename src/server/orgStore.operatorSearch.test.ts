import { buildOperatorOrgSearchClause } from "./orgStore";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const built = buildOperatorOrgSearchClause("acme", 1);

assert(built.clause.includes("o.id::text ="), "search must cast UUID id to text for equality");
assert(built.clause.includes("o.id::text ILIKE"), "search must cast UUID id to text for ILIKE");
assert(!/\bo\.id\s*=/.test(built.clause), "must not compare UUID id to text without cast");
assert(!/\bo\.id\s+ILIKE/.test(built.clause), "must not ILIKE UUID id without cast");
assert(built.params.length === 3, "expected fuzzy, exact, and prefix params");
assert(built.params[0] === "%acme%", "fuzzy param should wrap search");
assert(built.params[1] === "acme", "exact param should be raw search");
assert(built.params[2] === "acme%", "prefix param should be search%");
assert(built.nextIdx === 4, "next index should advance past three params");

console.log("orgStore.operatorSearch.test.ts: ok");
