import assert from "node:assert/strict";
import {
  clearOnboardingBannerDismiss,
  isOnboardingBannerDismissedTemporarily,
  isOnboardingBannerPermanentlyDismissed,
  recordOnboardingBannerDismiss
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

function installMemoryStorage(): void {
  memory.clear();
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
}

installMemoryStorage();

test("first two dismisses hide temporarily and are not permanent", () => {
  clearOnboardingBannerDismiss();
  const first = recordOnboardingBannerDismiss();
  assert.equal(first.permanent, false);
  assert.equal(first.count, 1);
  assert.equal(isOnboardingBannerDismissedTemporarily(), true);
  assert.equal(isOnboardingBannerPermanentlyDismissed(), false);

  // Simulate expiry so a second dismiss can be recorded in tests.
  memory.delete("coop.adminOnboarding.dismissedUntil");
  const second = recordOnboardingBannerDismiss();
  assert.equal(second.permanent, false);
  assert.equal(second.count, 2);
  assert.equal(isOnboardingBannerPermanentlyDismissed(), false);
});

test("third dismiss marks permanent", () => {
  clearOnboardingBannerDismiss();
  recordOnboardingBannerDismiss();
  memory.delete("coop.adminOnboarding.dismissedUntil");
  recordOnboardingBannerDismiss();
  memory.delete("coop.adminOnboarding.dismissedUntil");
  const third = recordOnboardingBannerDismiss();
  assert.equal(third.permanent, true);
  assert.equal(third.count, 3);
  assert.equal(isOnboardingBannerPermanentlyDismissed(), true);
  assert.equal(isOnboardingBannerDismissedTemporarily(), false);
});

console.log(`\nonboardingDismiss: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
