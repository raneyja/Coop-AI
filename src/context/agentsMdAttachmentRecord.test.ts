import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTACHED_AGENTS_MD_BY_ACCOUNT_KEY,
  LEGACY_ATTACHED_AGENTS_MD_PATH_KEY,
  normalizeAgentsMdAccountKey,
  readAttachedAgentsMdPath,
  writeAttachedAgentsMdPath,
  type AgentsMdAttachmentStateStore
} from "./agentsMdAttachmentRecord";

function memoryStore(initial: Record<string, unknown> = {}): AgentsMdAttachmentStateStore {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: <T>(key: string) => data[key] as T | undefined,
    update: (key: string, value: unknown) => {
      if (value === undefined) {
        delete data[key];
      } else {
        data[key] = value;
      }
    }
  };
}

test("normalizeAgentsMdAccountKey requires a signed-in email", () => {
  assert.equal(normalizeAgentsMdAccountKey("a@x.com", true), "a@x.com");
  assert.equal(normalizeAgentsMdAccountKey("  B@X.com ", true), "b@x.com");
  assert.equal(normalizeAgentsMdAccountKey("a@x.com", false), undefined);
  assert.equal(normalizeAgentsMdAccountKey(undefined, true), undefined);
  assert.equal(normalizeAgentsMdAccountKey("  ", true), undefined);
});

test("readAttachedAgentsMdPath is per-account and empty when signed out", async () => {
  const store = memoryStore();
  await writeAttachedAgentsMdPath(store, "a@x.com", "/tmp/a.md");
  await writeAttachedAgentsMdPath(store, "b@x.com", "/tmp/b.md");
  assert.equal(readAttachedAgentsMdPath(store, "a@x.com"), "/tmp/a.md");
  assert.equal(readAttachedAgentsMdPath(store, "b@x.com"), "/tmp/b.md");
  assert.equal(readAttachedAgentsMdPath(store, undefined), undefined);
  assert.equal(readAttachedAgentsMdPath(store, "c@x.com"), undefined);
});

test("writeAttachedAgentsMdPath removes only that account", async () => {
  const store = memoryStore();
  await writeAttachedAgentsMdPath(store, "a@x.com", "/tmp/a.md");
  await writeAttachedAgentsMdPath(store, "b@x.com", "/tmp/b.md");
  await writeAttachedAgentsMdPath(store, "a@x.com", undefined);
  assert.equal(readAttachedAgentsMdPath(store, "a@x.com"), undefined);
  assert.equal(readAttachedAgentsMdPath(store, "b@x.com"), "/tmp/b.md");
});

test("legacy workspace pointer is discarded and never returned", () => {
  const store = memoryStore({
    [LEGACY_ATTACHED_AGENTS_MD_PATH_KEY]: "/tmp/coop-ai-agents.md"
  });
  assert.equal(readAttachedAgentsMdPath(store, "free@x.com"), undefined);
  assert.equal(store.get(LEGACY_ATTACHED_AGENTS_MD_PATH_KEY), undefined);
  assert.equal(store.get(ATTACHED_AGENTS_MD_BY_ACCOUNT_KEY), undefined);
});
