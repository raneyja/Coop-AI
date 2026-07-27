import assert from "node:assert/strict";
import {
  clearSetupDismiss,
  isSetupDismissedToday,
  recordSetupDismiss
} from "./onboardingDismiss";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const memory = new Map<string, string>();

(globalThis as { localStorage?: Storage }).localStorage = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value));
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  }
} as Storage;

test("first two dismisses hide until tomorrow and are not permanent", () => {
  clearSetupDismiss("admin");
  assert.equal(recordSetupDismiss("admin").permanent, false);
  assert.equal(isSetupDismissedToday("admin"), true);

  memory.delete("coop.setupDismiss.admin.until");
  assert.equal(recordSetupDismiss("admin").permanent, false);
  assert.equal(isSetupDismissedToday("admin"), true);
});

test("third dismiss marks permanent", () => {
  clearSetupDismiss("admin");
  assert.equal(recordSetupDismiss("admin").permanent, false);
  memory.delete("coop.setupDismiss.admin.until");
  assert.equal(recordSetupDismiss("admin").permanent, false);
  memory.delete("coop.setupDismiss.admin.until");
  assert.equal(recordSetupDismiss("admin").permanent, true);
  assert.equal(isSetupDismissedToday("admin"), false);
});

test("migrates legacy date list length into count", () => {
  clearSetupDismiss("admin");
  memory.set("coop.setupDismiss.admin.dates", JSON.stringify(["2026-07-01", "2026-07-02"]));
  memory.delete("coop.setupDismiss.admin.count");
  memory.delete("coop.setupDismiss.admin.until");
  assert.equal(recordSetupDismiss("admin").permanent, true);
});

console.log(`\nadmin onboardingDismiss: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
