import assert from "node:assert/strict";
import {
  loadUserPinnedPromptIds,
  loadUserPrompts,
  promptLibraryPinnedStorageKey,
  promptLibraryStorageKey,
  saveUserPinnedPromptIds,
  saveUserPrompt,
  SIGNED_OUT_PROMPT_LIBRARY_ERROR,
  writeUserPrompts
} from "./userPromptLibrary";

class MemoryMemento {
  public constructor(private readonly data: Record<string, unknown> = {}) {}

  public get<T>(key: string, defaultValue?: T): T {
    if (Object.prototype.hasOwnProperty.call(this.data, key)) {
      return this.data[key] as T;
    }
    return defaultValue as T;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key];
      return;
    }
    this.data[key] = value;
  }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main(): Promise<void> {
await test("storage keys isolate accounts", () => {
  assert.equal(
    promptLibraryStorageKey("jon@coop-ai.dev"),
    "coopAI.promptLibrary.v1.jon@coop-ai.dev"
  );
  assert.notEqual(
    promptLibraryStorageKey("jon@coop-ai.dev"),
    promptLibraryStorageKey("jraney2008@gmail.com")
  );
  assert.equal(promptLibraryStorageKey(""), undefined);
  assert.equal(promptLibraryPinnedStorageKey(""), undefined);
});

await test("prompts saved by one user are invisible to another", async () => {
  const store = new MemoryMemento();
  await saveUserPrompt(store, "alice@coop-ai.dev", {
    id: "prompt-1",
    title: "Java customer SQL",
    template: "On-call: where is customer SQL built?"
  });
  const alice = await loadUserPrompts(store, "alice@coop-ai.dev");
  const bob = await loadUserPrompts(store, "bob@doxel.ai");
  const signedOut = await loadUserPrompts(store, "");
  assert.equal(alice.length, 1);
  assert.equal(alice[0]?.title, "Java customer SQL");
  assert.deepEqual(bob, []);
  assert.deepEqual(signedOut, []);
});

await test("pins do not leak across accounts", async () => {
  const store = new MemoryMemento();
  await saveUserPinnedPromptIds(store, "alice@coop-ai.dev", ["prompt-1"]);
  assert.deepEqual(await loadUserPinnedPromptIds(store, "alice@coop-ai.dev"), ["prompt-1"]);
  assert.deepEqual(await loadUserPinnedPromptIds(store, "bob@doxel.ai"), []);
  assert.deepEqual(await loadUserPinnedPromptIds(store, ""), []);
});

await test("signed-out save is refused", async () => {
  const store = new MemoryMemento();
  await assert.rejects(
    () =>
      writeUserPrompts(store, "", [{ id: "prompt-1", title: "Leak", template: "secret" }]),
    (err: unknown) => err instanceof Error && err.message === SIGNED_OUT_PROMPT_LIBRARY_ERROR
  );
  assert.deepEqual(await loadUserPrompts(store, "alice@coop-ai.dev"), []);
});

console.log(`\nuserPromptLibrary: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
}

void main();
