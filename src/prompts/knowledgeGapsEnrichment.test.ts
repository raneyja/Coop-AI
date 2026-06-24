import assert from "node:assert/strict";
import {
  buildConfluencePagesReviewedBlock,
  buildNotionPagesReviewedBlock,
  buildScanGapSubsection,
  enrichKnowledgeGapsResponse,
  extractConfluencePagesFromBundle,
  extractJobScanGapsFromBundle,
  extractNotionPagesFromBundle
} from "./knowledgeGapsEnrichment";

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

const SAMPLE_PAGES = [
  {
    title: "ADR: Webview vs native sidebar (COOP-55)",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/1"
  },
  {
    title: "Enterprise deployment — VPC and BYOK",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/2"
  },
  {
    title: "Integrations — Slack, Jira, Confluence",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/3"
  },
  {
    title: "Developer onboarding — VS Code extension",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/4"
  },
  {
    title: "ADR: Backend service extraction (COOP-101)",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/5"
  },
  {
    title: "Coop AI — Architecture Overview",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/6"
  },
  {
    title: "Coop AI Demo Home",
    htmlUrl: "https://example.atlassian.net/wiki/spaces/COOP/pages/7"
  }
];

const SAMPLE_LLM_OUTPUT = `**Summary**

The audit of src/server/githubAppApi.ts reveals no structured documentation gaps, but there are several areas with open questions regarding documentation coverage, ownership, and operational clarity.

**Documentation gaps**

**Documentation Coverage**

Open question: Is there comprehensive documentation for the GitHubAppService, GitHubAppConfig, and GitHubOAuthService types?
What to check: Review githubAppService.ts and the Confluence page titled "Coop AI — Architecture Overview".

**Ownership**

Open question: Who is responsible for maintaining src/server/githubAppApi.ts?
What to check: Verify the repository's contribution history for recent commits to this file to identify active maintainers.

**Operational Unknowns**

Open question: What specific functionalities does the githubAppApi.ts file provide within the application?
What to check: Investigate the file for implemented functions and their roles, and correlate them with usage patterns in the codebase.

**Confluence Pages Reviewed**

- ADR: Webview vs native sidebar (COOP-55)
- Enterprise deployment — VPC and BYOK
- Integrations — Slack, Jira, Confluence
- Developer onboarding — VS Code extension
- ADR: Backend service extraction (COOP-101)
- Coop AI — Architecture Overview
- Coop AI Demo Home
These pages may contain relevant information that could address the open questions or clarify the documentation needs for src/server/githubAppApi.ts.

**Recommended next steps**

Verify the configuration documentation for the GitHub App and OAuth integrations.
Consult the "Coop AI — Architecture Overview" page for error handling standards.`;

test("buildConfluencePagesReviewedBlock links titles when htmlUrl is present", () => {
  const block = buildConfluencePagesReviewedBlock(
    [{ title: "GitHub App API — server routes", htmlUrl: "https://example/wiki/99" }],
    "src/server/githubAppApi.ts"
  );
  assert.ok(block.includes("[GitHub App API — server routes](https://example/wiki/99)"));
  assert.ok(block.includes("src/server/githubAppApi.ts"));
});

test("enrichKnowledgeGapsResponse moves Confluence pages to top of Documentation gaps", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  const docGapsIdx = enriched.indexOf("**Documentation gaps**");
  const confluenceIdx = enriched.indexOf("**Confluence pages reviewed**");
  assert.ok(docGapsIdx >= 0);
  assert.ok(confluenceIdx > docGapsIdx);
  assert.equal(enriched.includes("**Documentation Coverage**"), false);
  assert.equal(enriched.includes("Is there comprehensive documentation"), false);
  for (const page of SAMPLE_PAGES) {
    assert.ok(enriched.includes(`[${page.title}](${page.htmlUrl})`));
  }
});

test("enrichKnowledgeGapsResponse strips invented Ownership and Integration sections", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.equal(enriched.includes("**Ownership & maintenance**"), false);
  assert.equal(enriched.includes("**Integration & operations**"), false);
  assert.equal(enriched.includes("**Operational Unknowns**"), false);
  assert.equal(enriched.includes("**Ownership**"), false);
});

test("enrichKnowledgeGapsResponse linkifies file paths and Confluence title mentions", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(enriched.includes("`src/server/githubAppApi.ts`"));
  assert.ok(enriched.includes("[Coop AI — Architecture Overview](https://example.atlassian.net/wiki/spaces/COOP/pages/6)"));
  assert.ok(enriched.includes("**Confluence pages reviewed**"));
});

test("buildConfluencePagesReviewedBlock uses keyword heuristics for runbook pages", () => {
  const block = buildConfluencePagesReviewedBlock(
    [{ title: "On-call runbook — API incidents", htmlUrl: "https://example/wiki/runbook" }],
    "src/server/api.ts"
  );
  assert.ok(block.includes("Operational runbook or on-call reference"));
  assert.ok(!block.includes("COOP-55"));
});

test("enrichKnowledgeGapsResponse numbers recommended next steps", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(enriched.includes("1. Verify the configuration documentation"));
  assert.ok(enriched.includes("2. Consult the [Coop AI — Architecture Overview]"));
});

test("enrichKnowledgeGapsResponse rebuilds fastify.js scenario with Notion pages and scan gaps", () => {
  const notionPages = [
    { title: "ADR: Webview vs native sidebar (COOP-55)", url: "https://notion.so/1" },
    { title: "Coop AI Demo", url: "https://notion.so/2" },
    { title: "ADR: Backend service extraction (COOP-101)", url: "https://notion.so/3" },
    { title: "Coop AI — Architecture Overview", url: "https://notion.so/4" },
    { title: "GitHub App API — server routes", url: "https://notion.so/5" },
    { title: "Coop AI — Architecture & integration notes", url: "https://notion.so/6" }
  ].map((page) => ({ title: page.title, htmlUrl: page.url }));

  const jobScanGaps = [
    { type: "missing_docs", message: "No Confluence pages matched repo scope", file: "fastify.js" },
    { type: "missing_docs", message: "No Google Docs matched repo scope", file: "fastify.js" }
  ];

  const llmOutput = `**Summary**

No documentation resources were found for fastify.js.

**Documentation gaps**

**Ownership & maintenance**

**Who maintains fastify.js**

- **Open question:** Who owns this file?
- **What to check:** CODEOWNERS and commit history.

**Integration & operations**

**Third-party plugins**

- **Open question:** What plugins are configured?
- **What to check:** package.json and plugin registration.

**Recommended next steps**

1. Add documentation for fastify.js.`;

  const enriched = enrichKnowledgeGapsResponse(llmOutput, {
    notionPages,
    jobScanGaps,
    activeFile: "fastify.js"
  });

  assert.ok(enriched.includes("**Notion pages reviewed**"));
  for (const page of notionPages) {
    assert.ok(enriched.includes(`[${page.title}](${page.htmlUrl})`));
  }
  assert.ok(enriched.includes("No Confluence pages matched repo scope"));
  assert.ok(enriched.includes("No Google Docs matched repo scope"));
  assert.equal(enriched.includes("**Ownership & maintenance**"), false);
  assert.equal(enriched.includes("**Integration & operations**"), false);
  assert.equal(enriched.includes("Third-party plugins"), false);
  assert.ok(enriched.includes("`fastify.js`"));
});

test("buildScanGapSubsection uses scan message for What to check", () => {
  const block = buildScanGapSubsection(
    { type: "missing_docs", message: "No Confluence pages matched repo scope", file: "fastify.js" },
    "fastify.js"
  );
  assert.ok(block.includes("No Confluence pages matched repo scope"));
  assert.ok(block.includes("**Open question:**"));
});

test("extractNotionPagesFromBundle and extractJobScanGapsFromBundle read bundle entries", () => {
  const notion = extractNotionPagesFromBundle([
    {
      type: "chat_context",
      data: {
        notionSearch: {
          pages: [{ id: "n1", title: "Coop AI Demo", updated: "2026-01-01", url: "https://notion.so/demo" }]
        }
      }
    }
  ]);
  assert.deepEqual(notion, [{ title: "Coop AI Demo", htmlUrl: "https://notion.so/demo" }]);

  const gaps = extractJobScanGapsFromBundle([
    {
      type: "chat_context",
      data: {
        jobScan: {
          gaps: [{ type: "missing_docs", message: "No Google Docs matched repo scope", file: "fastify.js" }]
        }
      }
    }
  ]);
  assert.deepEqual(gaps, [
    { type: "missing_docs", message: "No Google Docs matched repo scope", file: "fastify.js" }
  ]);
});

test("buildNotionPagesReviewedBlock links titles when htmlUrl is present", () => {
  const block = buildNotionPagesReviewedBlock(
    [{ title: "Coop AI Demo", htmlUrl: "https://notion.so/demo" }],
    "fastify.js"
  );
  assert.ok(block.includes("[Coop AI Demo](https://notion.so/demo)"));
});

test("extractConfluencePagesFromBundle reads pages and urls from context bundle", () => {
  const pages = extractConfluencePagesFromBundle([
    {
      type: "chat_context",
      data: {
        confluenceSearch: {
          pages: [
            {
              id: "1",
              title: "Coop AI Demo Home",
              updated: "2026-01-01",
              excerpt: "Demo hub page.",
              htmlUrl: "https://example/wiki/demo"
            }
          ]
        }
      }
    }
  ]);
  assert.deepEqual(pages, [
    {
      title: "Coop AI Demo Home",
      excerpt: "Demo hub page.",
      htmlUrl: "https://example/wiki/demo"
    }
  ]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
