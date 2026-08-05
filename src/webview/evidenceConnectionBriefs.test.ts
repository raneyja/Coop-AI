import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { IntegrationResultCollapsible } from "./components/IntegrationResultCard";
import {
  extractConnectionBriefs,
  extractSourceInventoryBriefs,
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

test("extractSourceInventoryBriefs keeps branded and cited sources only", () => {
  const children = React.createElement(
    React.Fragment,
    null,
    collapsible({
      title: "Recent decision commit",
      provider: "github",
      destination: "3241693",
      subtitle: "chore: removed the deleted states",
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "Body")
    }),
    collapsible({
      title: "Originally introduced",
      provider: "github",
      destination: "26ec1e8",
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "Body")
    }),
    collapsible({
      title: "PR #8457",
      provider: "github",
      destination: "PR #8457",
      sourceLabel: "[Sources: PR #8457]",
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "Body")
    }),
    collapsible({
      title: "Code under investigation",
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "snippet")
    }),
    collapsible({
      title: "Alternatives considered (2)",
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "alts")
    })
  );

  const inventory = extractSourceInventoryBriefs(children);
  assert.equal(inventory.length, 3);
  assert.deepEqual(
    inventory.map((item) => item.destination ?? item.title),
    ["3241693", "26ec1e8", "PR #8457"]
  );
});

test("extractSourceInventoryBriefs excludes empty stubs marked inventory=false", () => {
  const children = React.createElement(
    React.Fragment,
    null,
    collapsible({
      title: "Presence",
      sourceLabel: "[Sources: Slack presence]",
      inventory: false,
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "unmapped")
    }),
    collapsible({
      title: "Discussions (0)",
      sourceLabel: "[Sources: Slack discussions]",
      inventory: false,
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "error")
    }),
    collapsible({
      title: "Discussions (3)",
      sourceLabel: "[Sources: Slack discussions]",
      inventory: true,
      open: false,
      onToggle: () => undefined,
      children: React.createElement("p", null, "msgs")
    })
  );

  const inventory = extractSourceInventoryBriefs(children);
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0]?.title, "Discussions (3)");
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
