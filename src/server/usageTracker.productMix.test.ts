import assert from "node:assert/strict";
import { productMixFromEventTypes } from "./usageTracker";

void (() => {
  const mix = productMixFromEventTypes([
    { eventType: "chat.message", count: 5 },
    { eventType: "chat.completion", count: 2 },
    { eventType: "completion.suggested", count: 8 },
    { eventType: "completion.accepted", count: 4 },
    { eventType: "lightning.search", count: 3 },
    { eventType: "quick_action.explain", count: 1 },
    { eventType: "quick_action.blast_radius", count: 2 },
    { eventType: "other.thing", count: 9 }
  ]);

  assert.deepEqual(mix, {
    chat: 7,
    completions: 12,
    lightning: 3,
    quickActions: 3
  });

  assert.deepEqual(productMixFromEventTypes([]), {
    chat: 0,
    completions: 0,
    lightning: 0,
    quickActions: 0
  });

  console.log("usageTracker.productMix.test.ts: ok");
})();
