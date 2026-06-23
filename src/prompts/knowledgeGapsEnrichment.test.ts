import assert from "node:assert/strict";
import {
  buildConfluencePagesReviewedBlock,
  enrichKnowledgeGapsResponse,
  extractConfluencePagesFromBundle
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
  assert.ok(
    confluenceIdx < enriched.indexOf("- **Open question:** Is there comprehensive documentation")
  );
  for (const page of SAMPLE_PAGES) {
    assert.ok(enriched.includes(`[${page.title}](${page.htmlUrl})`));
  }
});

test("enrichKnowledgeGapsResponse promotes Ownership and Operational Unknowns to main sections", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(enriched.includes("**Ownership & maintenance**"));
  assert.ok(enriched.includes("**Integration & operations**"));
  assert.equal(enriched.includes("**Operational Unknowns**"), false);
});

test("enrichKnowledgeGapsResponse linkifies file paths and Confluence title mentions", () => {
  const enriched = enrichKnowledgeGapsResponse(SAMPLE_LLM_OUTPUT, {
    confluencePages: SAMPLE_PAGES,
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(enriched.includes("`src/server/githubAppApi.ts`"));
  assert.ok(enriched.includes("`githubAppService.ts`"));
  assert.ok(enriched.includes("[Coop AI — Architecture Overview](https://example.atlassian.net/wiki/spaces/COOP/pages/6)"));
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
