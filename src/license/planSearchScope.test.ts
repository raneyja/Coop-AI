import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canUseCollections,
  clampSearchScopeModeForPlan,
  isFreePlan,
  resolveSearchScopeForPlan
} from "./planSearchScope";

test("planSearchScope: free blocks collections", () => {
  assert.equal(canUseCollections("free"), false);
  assert.equal(clampSearchScopeModeForPlan("collection", "free"), "indexed");
  assert.equal(isFreePlan("free"), true);
});

test("planSearchScope: pro allows collections", () => {
  assert.deepEqual(
    resolveSearchScopeForPlan({
      plan: "pro",
      searchScopeMode: "collection",
      searchCollectionId: "abc"
    }),
    { mode: "collection", collectionId: "abc" }
  );
});
