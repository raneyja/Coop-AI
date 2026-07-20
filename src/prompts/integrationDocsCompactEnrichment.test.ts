import assert from "node:assert/strict";
import {
  buildCompactRelatedDocumentationBlock,
  enrichCompactIntegrationDocs,
  stripEmptyOutOfScopeSection,
  topRelevantPages
} from "./integrationDocsCompactEnrichment";

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

const pages = [
  { title: "Coop AI Demo Home", htmlUrl: "https://notion/1" },
  { title: "GitHub App API — server routes", htmlUrl: "https://confluence/2", excerpt: "githubAppApi.ts routes" },
  { title: "Architecture overview", htmlUrl: "https://notion/3" }
];

test("topRelevantPages ranks file-specific docs first", () => {
  const ranked = topRelevantPages(pages, "src/server/githubAppApi.ts", 2);
  assert.equal(ranked[0]?.title, "GitHub App API — server routes");
});

test("buildCompactRelatedDocumentationBlock caps at three titles", () => {
  const block = buildCompactRelatedDocumentationBlock({
    confluencePages: pages.slice(1, 2),
    notionPages: pages.slice(0, 1).concat(pages.slice(2)),
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(block?.includes("**Related documentation**"));
  assert.ok(block?.includes("GitHub App API"));
});

test("stripEmptyOutOfScopeSection removes placeholder-only sections", () => {
  const input = [
    "**How the open file fits**",
    "Role: API surface.",
    "",
    "**Out-of-scope @ attachments**",
    "No out-of-scope attachments were identified.",
    "",
    "**Sources**",
    "- item"
  ].join("\n");
  const result = stripEmptyOutOfScopeSection(input);
  assert.ok(!result.includes("Out-of-scope @ attachments"));
});

test("enrichCompactIntegrationDocs injects related docs after active file section", () => {
  const input = [
    "**Architecture**",
    "Overview.",
    "",
    "**How the open file fits**",
    "Routes GitHub App callbacks.",
    "",
    "**Key subsystems**",
    "Auth."
  ].join("\n");
  const enriched = enrichCompactIntegrationDocs(
    input,
    {
      notionPages: pages,
      activeFile: "src/server/githubAppApi.ts"
    },
    { mode: "understand-repo" }
  );
  assert.ok(enriched.includes("**Related documentation**"));
  assert.ok(enriched.indexOf("**Related documentation**") > enriched.indexOf("**How the open file fits**"));
});

test("enrichCompactIntegrationDocs collapses verbose Understand Repo Architecture doc lists", () => {
  const longList = Array.from({ length: 6 }, (_, index) => `- Page ${index + 1}`).join("\n");
  const input = [
    "**Architecture**",
    "VS Code extension + API.",
    "",
    "**Notion pages reviewed**",
    longList,
    "",
    "**Key subsystems**",
    "Auth."
  ].join("\n");
  const enriched = enrichCompactIntegrationDocs(
    input,
    {
      notionPages: pages,
      activeFile: "src/server/githubAppApi.ts"
    },
    { mode: "understand-repo" }
  );
  assert.ok(!enriched.includes("**Notion pages reviewed**"));
  assert.ok(enriched.includes("**Related documentation**"));
  assert.ok(enriched.split("\n").filter((line) => line.startsWith("- Page")).length === 0);
});

test("enrichCompactIntegrationDocs collapses verbose Blast Radius doc lists", () => {
  const longList = Array.from({ length: 8 }, (_, index) => `- Page ${index + 1}`).join("\n");
  const input = [
    "**APIs & integrations**",
    "",
    "**Notion pages reviewed**",
    longList,
    "",
    "**Operational risk**",
    "Medium."
  ].join("\n");
  const enriched = enrichCompactIntegrationDocs(
    input,
    {
      notionPages: pages,
      confluencePages: [{ title: "Integrations ADR", htmlUrl: "https://c/1" }],
      activeFile: "src/server/githubAppApi.ts"
    },
    { mode: "blast-radius" }
  );
  assert.ok(!enriched.includes("**Notion pages reviewed**"));
  assert.ok(enriched.includes("**Related documentation**"));
  assert.ok(enriched.split("\n").filter((line) => line.startsWith("- Page")).length <= 3);
});

console.log(`\nintegrationDocsCompactEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
