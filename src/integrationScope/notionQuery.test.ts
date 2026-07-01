import test from "node:test";
import assert from "node:assert/strict";
import {
  filterNotionPagesByScope,
  isNotionScopeBlocked,
  notionScopeBlockMessage
} from "./notionQuery";
import type { ResolvedIntegrationScope } from "./types";

test("isNotionScopeBlocked is false when scope is not enforced", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "notion",
    enforced: false,
    allowed: true,
    scopeStatus: "none"
  };
  assert.equal(isNotionScopeBlocked(scope), false);
});

test("isNotionScopeBlocked is true when enforced and not allowed", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "notion",
    enforced: true,
    allowed: false,
    scopeStatus: "blocked",
    reason: "Notion not connected"
  };
  assert.equal(isNotionScopeBlocked(scope), true);
});

test("notionScopeBlockMessage prefers scope reason", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "notion",
    enforced: true,
    allowed: false,
    scopeStatus: "blocked",
    reason: "Custom block reason"
  };
  assert.equal(notionScopeBlockMessage(scope), "Custom block reason");
});

test("filterNotionPagesByScope keeps pages in allowlist or with allowed parent", () => {
  const pages = [
    { id: "page-1", parentId: "db-1" },
    { id: "page-2", parentId: "db-2" },
    { id: "db-1" }
  ];
  const filtered = filterNotionPagesByScope(pages, new Set(["db-1"]));
  assert.deepEqual(
    filtered.map((page) => page.id),
    ["page-1", "db-1"]
  );
});
