import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { IntegrationResultCollapsible } from "./components/IntegrationResultCard";
import {
  extractConnectionBriefs,
  findSingleCollapsibleElement,
  resolveConnectionBrief
} from "./evidenceConnectionBriefs";

function collapsible(
  props: React.ComponentProps<typeof IntegrationResultCollapsible>
): React.ReactElement {
  return React.createElement(IntegrationResultCollapsible, props, props.children);
}

test("extractConnectionBriefs finds nested collapsible sections", () => {
  const children = collapsible({
    title: "Architecture pages (9)",
    sourceLabel: "[Sources: Confluence architecture]",
    sectionDomId: "artifact--confluence",
    open: false,
    onToggle: () => undefined,
    children: React.createElement("p", null, "Body")
  });

  const briefs = extractConnectionBriefs(children);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0]?.title, "Architecture pages (9)");
  assert.equal(briefs[0]?.sourceLabel, "[Sources: Confluence architecture]");
});

test("resolveConnectionBrief prefers explicit briefSummary", () => {
  const children = collapsible({
    title: "Other",
    open: false,
    onToggle: () => undefined,
    children: React.createElement("p", null, "Body")
  });

  const brief = resolveConnectionBrief({ title: "Anchor files (3)" }, children);
  assert.equal(brief?.title, "Anchor files (3)");
});

test("findSingleCollapsibleElement returns lone section", () => {
  const single = collapsible({
    title: "Epics (0)",
    open: false,
    onToggle: () => undefined,
    children: React.createElement("p", null, "Empty")
  });

  assert.ok(findSingleCollapsibleElement(single));
  assert.equal(
    findSingleCollapsibleElement(
      React.createElement(React.Fragment, null, single, React.createElement("p", null, "extra"))
    ),
    null
  );
});
