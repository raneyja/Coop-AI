import assert from "node:assert/strict";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import { extractExistingCapabilityEvidence } from "../context/existingCapabilityGrounding";

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

test("incident reconstruction enriches code-only skim with tickets + gaps", () => {
  const content = `**Answer**
Retry helpers exist in webhook_task.py.

**Symptoms**
- Board sync webhook failures.
`;
  const enriched = enrichChatResponseForAction({
    content,
    contextBundle: [
      {
        data: {
          jiraSearch: { issues: [] },
          slackSearch: { messages: [] },
          localFiles: {
            files: [{ path: "apps/api/plane/bgtasks/webhook_task.py", content: "def retry(): pass" }]
          }
        }
      }
    ],
    incidentReconstruction: {
      jiraConnected: true,
      slackConnected: true,
      codePaths: ["apps/api/plane/bgtasks/webhook_task.py"]
    }
  });
  assert.ok(enriched.includes("**Code paths**"));
  assert.ok(enriched.includes("**Integrations**"));
  assert.ok(enriched.includes("**Gaps**"));
  assert.ok(/No matching Jira/i.test(enriched));
  assert.ok(/No matching Slack/i.test(enriched));
});

test("incident reconstruction with disconnected tools still has gaps", () => {
  const enriched = enrichChatResponseForAction({
    content: "**Answer**\nRetries in code.",
    incidentReconstruction: { jiraConnected: false, slackConnected: false }
  });
  assert.ok(enriched.includes("**Integrations**"));
  assert.ok(enriched.includes("**Gaps**"));
  assert.ok(/not connected/i.test(enriched));
});

test("existing-capability enricher corrects greenfield blocked_by advice", () => {
  const mapper = `
RELATION_TYPE_MAP = {
    "blocking": "blocked_by",
    "blocked_by": "blocking",
}
`.trim();
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: mapper,
    ask: "We're adding a blocked by link type for issues"
  });
  assert.ok(evidence);
  assert.equal(evidence!.verdict, "already-exists");
  const enriched = enrichChatResponseForAction({
    content: "**Answer**\nAdd a new blocked_by link type to the mapper.",
    existingCapability: evidence
  });
  assert.ok(/already exists/i.test(enriched));
  assert.ok(/\bextend\b/i.test(enriched));
});

test("file-assistant leftover Use-repo evidence does not rewrite the open-file answer", () => {
  const answer =
    "This local file raises SetHtmlEvent. Other files were not searched.";
  const leftoverBundle = [
    {
      data: {
        jiraSearch: { issues: [] },
        slackSearch: { messages: [] },
        file: "src/server/authMiddleware.ts",
        directDependents: ["src/chat/CoopChatSession.ts"],
        dependentDetails: [
          { path: "src/chat/CoopChatSession.ts", depth: 1, source: "scip" }
        ],
        graphMeta: { source: "scip", edgeCount: 1 },
        packageStructure: {
          packages: ["apps/web", "apps/api", "packages/ui"],
          workspaceGlobs: ["apps/*", "packages/*"],
          parents: ["apps", "packages"]
        }
      }
    }
  ];
  const wouldInjectCallers = enrichChatResponseForAction({
    content: answer,
    userQuestion: "If I change this file, what else should I check?",
    contextBundle: leftoverBundle
  });
  assert.match(wouldInjectCallers, /src\/chat\/CoopChatSession/);

  const incident = enrichChatResponseForAction({
    content: answer,
    userQuestion:
      "Last week’s webhook delivery failures — what Jira tickets and Slack threads are related?",
    contextBundle: leftoverBundle,
    incidentReconstruction: {
      jiraConnected: true,
      slackConnected: true,
      codePaths: []
    },
    fileAssistant: true
  });
  assert.equal(incident, answer);
  assert.doesNotMatch(incident, /\*\*Code paths\*\*|\*\*Integrations\*\*|\*\*Gaps\*\*/);

  const callers = enrichChatResponseForAction({
    content: answer,
    userQuestion: "If I change this file, what else should I check?",
    contextBundle: leftoverBundle,
    fileAssistant: true
  });
  assert.equal(callers, answer);
  assert.doesNotMatch(callers, /\*\*Callers|\*\*Concrete packages|src\/chat\/CoopChatSession/);

  const structure = enrichChatResponseForAction({
    content: answer,
    userQuestion: "How is this repository structured?",
    contextBundle: leftoverBundle,
    fileAssistant: true
  });
  assert.equal(structure, answer);
  assert.doesNotMatch(structure, /apps\/web|Concrete packages/);

  const intern = enrichChatResponseForAction({
    content: "The index returned no usable matches for `SetHtmlEvent`.",
    fileAssistant: true
  });
  assert.match(intern, /index returned no usable/);
  assert.doesNotMatch(intern, /in this repo/i);

  const overproduced = enrichChatResponseForAction({
    content:
      "This local file raises SetHtmlEvent.\n\n**Quick checklist (what to search & update)**\n- Search the codebase.\n\nIf you want, I can produce a patch.",
    fileAssistant: true
  });
  assert.match(overproduced, /SetHtmlEvent/);
  assert.match(overproduced, /Other files were not read/);
  assert.doesNotMatch(overproduced, /Quick checklist|If you want, I can produce/i);
});

const leftoverCoopPages = [
  {
    title: "ADR: Backend service extraction (COOP-101)",
    excerpt: "github:raneyja/Coop-AI coop-ai-core coop-backend"
  },
  {
    title: "Developer onboarding — VS Code extension",
    excerpt: "VS Code extension onboarding for github:raneyja/Coop-AI"
  },
  {
    title: "ADR: Webview vs native sidebar (COOP-55)",
    excerpt: "gitlab:raneyja/Coop-AI"
  }
];

function blastBundleWithLeftoverDocs(): unknown[] {
  return [
    {
      type: "dependencies",
      data: {
        file: "apps/api/settings.py",
        directDependents: [],
        warnings: ["Impact unverified: no dependents found in index"],
        confluenceSearch: { pages: leftoverCoopPages }
      }
    }
  ];
}

const blastAnswer = [
  "**APIs & integrations**",
  "",
  "**Confluence pages reviewed**",
  "- (attached)",
  "",
  "**Operational risk**",
  "",
  "Low."
].join("\n");

test("Blast on coop-ai/plane drops leftover Coop-AI docs and stays unverified", () => {
  const enriched = enrichChatResponseForAction({
    quickAction: "blast-radius",
    content: blastAnswer,
    contextBundle: blastBundleWithLeftoverDocs(),
    owner: "coop-ai",
    repo: "plane",
    activeFile: "apps/api/settings.py"
  });
  assert.doesNotMatch(enriched, /COOP-101|COOP-55|VS Code extension|Related documentation/i);
  assert.match(enriched, /unverified/i);
  assert.doesNotMatch(enriched, /src\/chat\/CoopChatSession|apps\/api\/plane/);
});

test("Blast on raneyja/Coop-AI keeps the same Coop ADRs", () => {
  const enriched = enrichChatResponseForAction({
    quickAction: "blast-radius",
    content: blastAnswer,
    contextBundle: blastBundleWithLeftoverDocs(),
    owner: "raneyja",
    repo: "Coop-AI",
    activeFile: "apps/api/settings.py"
  });
  assert.match(enriched, /Related documentation/);
  assert.match(enriched, /COOP-101/);
  assert.match(enriched, /VS Code extension/);
  assert.match(enriched, /COOP-55/);
});

test("plain R chat does not attach leftover Blast docs", () => {
  const answer = "This file configures the preview environment.";
  const enriched = enrichChatResponseForAction({
    content: answer,
    userQuestion: "what does this file do?",
    contextBundle: blastBundleWithLeftoverDocs(),
    owner: "coop-ai",
    repo: "plane",
    activeFile: "apps/api/settings.py"
  });
  assert.equal(enriched, answer);
  assert.doesNotMatch(enriched, /COOP-101|Related documentation|VS Code extension/i);
});

test("L Desktop file does not inject leftover Blast docs or callers", () => {
  const answer = "This local file raises SetHtmlEvent.";
  const enriched = enrichChatResponseForAction({
    quickAction: "blast-radius",
    content: answer,
    userQuestion: "what does this file do?",
    contextBundle: blastBundleWithLeftoverDocs(),
    owner: "coop-ai",
    repo: "plane",
    activeFile: "/Users/jon/Desktop/Widget.cs",
    fileAssistant: true
  });
  assert.equal(enriched, answer);
  assert.doesNotMatch(enriched, /Related documentation|COOP-101|unverified|in this repo/i);
});

test("/docs answers that invent repo files are rewritten to titles only", () => {
  const enriched = enrichChatResponseForAction({
    content:
      "The authentication middleware is in src/middleware/auth.js, where it implements token validation.",
    integrationProvider: "google-docs",
    contextBundle: [
      {
        data: {
          googleDocsSearch: {
            documents: [{ title: "Coop AI — Architecture Overview", htmlUrl: "https://docs.google.com/x" }]
          }
        }
      }
    ]
  });
  assert.ok(!enriched.includes("src/middleware/auth.js"));
  assert.match(enriched, /\/docs searches Google Docs only/);
  assert.ok(enriched.includes("Coop AI — Architecture Overview"));
});

const total = passed + failed;
console.log(`\nchatResponseEnrichment: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
