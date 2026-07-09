import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { resetMockConfiguration, setMockConfiguration } from "./test/vscodeMockSetup";
import {
  AUTOCOMPLETE_INDEX_DISCOVERY_SHOWN_KEY,
  AUTOCOMPLETE_USER_DISABLED_KEY,
  findActiveRepoBecameHealthy,
  hasAutocompleteDiscoveryBeenShown,
  isAutocompleteGloballyEnabled,
  isAutocompleteUserDisabled,
  isRepoIndexHealthy,
  markAutocompleteDiscoveryShown,
  markAutocompleteUserDisabled,
  readAutocompleteSettings,
  resolveAutocompleteActiveRepoId,
  resolveEffectiveUseGraphContext,
  shouldAutoEnableAutocompleteOnIndexReady,
  shouldOfferAutocompleteDiscovery
} from "./autocompleteConfig";
import { createMockExtensionContext } from "./test/vscodeMockSetup";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    resetMockConfiguration();
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    resetMockConfiguration();
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("readAutocompleteSettings returns package defaults when unset", () => {
  const settings = readAutocompleteSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.trigger, "auto");
  assert.equal(settings.model, "chat");
  assert.equal(settings.requestTimeoutMs, 1500);
  assert.equal(settings.useFim, true);
  assert.equal(settings.useGraphContext, false);
});

test("readAutocompleteSettings reads coopAI.autocomplete overrides", () => {
  setMockConfiguration("coopAI.autocomplete", "enabled", true);
  setMockConfiguration("coopAI.autocomplete", "model", "gpt35");
  setMockConfiguration("coopAI.autocomplete", "customModel", "gpt-4o");
  setMockConfiguration("coopAI.autocomplete", "useGraphContext", true);
  setMockConfiguration("coopAI.autocomplete", "requestTimeoutMs", 800);

  const settings = readAutocompleteSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.model, "gpt35");
  assert.equal(settings.customModel, "gpt-4o");
  assert.equal(settings.useGraphContext, true);
  assert.equal(settings.requestTimeoutMs, 800);
});

test("isAutocompleteGloballyEnabled reflects enabled flag", () => {
  assert.equal(isAutocompleteGloballyEnabled(), false);
  setMockConfiguration("coopAI.autocomplete", "enabled", true);
  assert.equal(isAutocompleteGloballyEnabled(), true);
});

test("isRepoIndexHealthy requires ready status with zoekt or scip", () => {
  assert.equal(
    isRepoIndexHealthy({
      enabled: true,
      status: "ready",
      zoektAvailable: true,
      scipAvailable: false
    }),
    true
  );
  assert.equal(
    isRepoIndexHealthy({
      enabled: true,
      status: "indexing",
      zoektAvailable: true,
      scipAvailable: false
    }),
    false
  );
});

test("resolveEffectiveUseGraphContext auto-enables when index is healthy", () => {
  assert.equal(
    resolveEffectiveUseGraphContext(
      { useGraphContext: false },
      { enabled: true, status: "ready", zoektAvailable: true, scipAvailable: false }
    ),
    true
  );
  assert.equal(
    resolveEffectiveUseGraphContext(
      { useGraphContext: true },
      { enabled: false, status: "idle", zoektAvailable: false, scipAvailable: false }
    ),
    true
  );
  assert.equal(
    resolveEffectiveUseGraphContext(
      { useGraphContext: false },
      { enabled: true, status: "idle", zoektAvailable: false, scipAvailable: false }
    ),
    false
  );
});

test("resolveAutocompleteActiveRepoId uses coopAI default owner and repo", () => {
  setMockConfiguration("coopAI", "defaultOwner", "acme");
  setMockConfiguration("coopAI", "defaultRepo", "widgets");
  assert.equal(resolveAutocompleteActiveRepoId(), "github:acme/widgets");
});

test("findActiveRepoBecameHealthy matches active repo transition to ready", () => {
  const previous = new Map<string, string>([["github:acme/widgets", "indexing"]]);
  const statuses = [
    {
      repoId: "github:acme/widgets",
      enabled: true,
      status: "ready" as const,
      zoektAvailable: true,
      scipAvailable: false
    },
    {
      repoId: "github:other/app",
      enabled: true,
      status: "ready" as const,
      zoektAvailable: true,
      scipAvailable: false
    }
  ];
  const match = findActiveRepoBecameHealthy(statuses, previous, "github:acme/widgets");
  assert.equal(match?.repoId, "github:acme/widgets");
  assert.equal(findActiveRepoBecameHealthy(statuses, previous, "github:missing/repo"), undefined);
});

test("isAutocompleteUserDisabled and discovery shown persist in globalState", () => {
  const context = createMockExtensionContext();
  assert.equal(isAutocompleteUserDisabled(context), false);
  assert.equal(hasAutocompleteDiscoveryBeenShown(context), false);
  void markAutocompleteUserDisabled(context, true);
  void markAutocompleteDiscoveryShown(context);
  assert.equal(isAutocompleteUserDisabled(context), true);
  assert.equal(hasAutocompleteDiscoveryBeenShown(context), true);
  assert.equal(context.globalState.get(AUTOCOMPLETE_USER_DISABLED_KEY), true);
  assert.equal(context.globalState.get(AUTOCOMPLETE_INDEX_DISCOVERY_SHOWN_KEY), true);
});

void (async () => {
  await asyncTest("shouldAutoEnableAutocompleteOnIndexReady respects userDisabled and shown flags", async () => {
    const context = createMockExtensionContext();
    assert.equal(shouldAutoEnableAutocompleteOnIndexReady(context), true);

    await markAutocompleteUserDisabled(context, true);
    assert.equal(shouldAutoEnableAutocompleteOnIndexReady(context), false);

    resetMockConfiguration();
    await markAutocompleteDiscoveryShown(context);
    assert.equal(shouldAutoEnableAutocompleteOnIndexReady(context), false);
  });

  await asyncTest("shouldOfferAutocompleteDiscovery respects enabled, userDisabled, and shown flags", async () => {
    const context = createMockExtensionContext();
    assert.equal(shouldOfferAutocompleteDiscovery({ enabled: false }, context), true);

    setMockConfiguration("coopAI.autocomplete", "enabled", true);
    assert.equal(shouldOfferAutocompleteDiscovery(readAutocompleteSettings(), context), false);

    resetMockConfiguration();
    await markAutocompleteUserDisabled(context, true);
    assert.equal(shouldOfferAutocompleteDiscovery({ enabled: false }, context), false);

    resetMockConfiguration();
    await markAutocompleteDiscoveryShown(context);
    assert.equal(shouldOfferAutocompleteDiscovery({ enabled: false }, context), false);
  });

  console.log(`\nautocompleteConfig: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
