import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNarrativeTimeline,
  narrativeIconForLabel,
  shouldUseNarrativeTimeline,
  splitNarrativeLabelParts,
  visibleNarrativeSteps
} from "./agentNarrative";

test("buildNarrativeTimeline marks progressive done/active/pending", () => {
  const steps = buildNarrativeTimeline(["A", "B", "C"], 1);
  assert.deepEqual(
    steps.map((step) => step.status),
    ["done", "active", "pending"]
  );
  assert.equal(steps[1]?.label, "B");
});

test("visibleNarrativeSteps hides pending todos (Copilot-style)", () => {
  const steps = visibleNarrativeSteps(buildNarrativeTimeline(["A", "B", "C"], 1));
  assert.deepEqual(
    steps.map((step) => step.status),
    ["done", "active"]
  );
});

test("buildNarrativeTimeline clamps active index to last step", () => {
  const steps = buildNarrativeTimeline(["A", "B"], 99);
  assert.deepEqual(
    steps.map((step) => step.status),
    ["done", "active"]
  );
});

test("shouldUseNarrativeTimeline is true when steps exist", () => {
  assert.equal(shouldUseNarrativeTimeline([]), false);
  assert.equal(shouldUseNarrativeTimeline(buildNarrativeTimeline(["A"], 0)), true);
});

test("narrativeIconForLabel picks search/read/loading", () => {
  assert.equal(narrativeIconForLabel("Searching GitHub estate index…"), "search");
  assert.equal(narrativeIconForLabel("Reading repository file metadata…"), "read");
  assert.equal(narrativeIconForLabel("Processing context…", true), "loading");
});

test("splitNarrativeLabelParts extracts code chips", () => {
  assert.deepEqual(splitNarrativeLabelParts("Searched for `**/CODEOWNERS`, no matches"), [
    { type: "text", value: "Searched for " },
    { type: "code", value: "**/CODEOWNERS" },
    { type: "text", value: ", no matches" }
  ]);
});
