import assert from "node:assert/strict";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import { extractExistingCapabilityEvidence } from "../context/existingCapabilityGrounding";
import { parseChatProse } from "../webview/lib/chatProseParser";

let passed = 0;
let failed = 0;

test("gaps final output supplies a verbatim interactive source citation when omitted", () => {
  const body = "\nexport function positiveSum(values: number[]) {\n  return values[0];\n}";
  const bundle = [{ type: "knowledge_gaps", data: { focusFiles: [{ path: "src/mathRenamed.ts", content: body, startLine: 1 }] } }];
  const enriched = enrichChatResponseForAction({ content: "A source defect needs review.", quickAction: "knowledge-gaps", contextBundle: bundle });
  assert.ok(enriched.includes("```2:4:src/mathRenamed.ts\nexport function positiveSum(values: number[]) {\n  return values[0];\n}"));
  const cite = parseChatProse(enriched).blocks.find((block) => block.type === "code-citation");
  assert.ok(cite?.type === "code-citation");
  assert.equal(cite.path, "src/mathRenamed.ts");
  assert.equal(cite.startLine, 2);
  assert.equal(cite.endLine, 4);
  assert.equal(cite.code, body.slice(1));
  const again = enrichChatResponseForAction({ content: enriched, quickAction: "knowledge-gaps", contextBundle: bundle });
  assert.equal((again.match(/2:4:src\/mathRenamed.ts/g) ?? []).length, 1);
});

test("gaps final output never invents line offsets for arbitrary snippets", () => {
  const enriched = enrichChatResponseForAction({ content: "Review helper.", quickAction: "knowledge-gaps", contextBundle: [{ type: "knowledge_gaps", data: { focusFiles: [{ path: "src/helper.ts", content: "const helper = 1;" }] } }] });
  assert.equal(enriched.includes("**Reviewed source**"), false);
});

test("knowledge gaps final response rejects absence inferred from empty review evidence", () => {
  const enriched = enrichChatResponseForAction({
    content: "**Summary**\n\nTwo concrete gaps: no README or CODEOWNERS.\n\n**Documentation gaps**\n\nNo nearby docs under src/mathRenamed.ts.",
    quickAction: "knowledge-gaps",
    activeFile: "src/mathRenamed.ts",
    contextBundle: [{ data: { jobScan: { gaps: [] } } }]
  });
  assert.equal(enriched.includes("Two concrete gaps"), false);
  assert.equal(enriched.includes("No nearby docs under"), false);
  assert.ok(enriched.includes("Documentation coverage is unknown"));
});

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

test("/docs preserves code paths actually described by the opened document body", () => {
  const content = "The document describes src/server/githubAppApi.ts as the backend API.";
  const enriched = enrichChatResponseForAction({
    integrationProvider: "google-docs", content,
    contextBundle: [{ data: { googleDocsSearch: { documents: [{
      title: "Coop AI — Architecture Overview", htmlUrl: "https://docs.google.com/document/d/fixture/edit",
      excerpt: "Backend: src/server/githubAppApi.ts. This is synthetic demo documentation."
    }] } } }]
  });
  assert.match(enriched, /document describes src\/server\/githubAppApi\.ts/);
  assert.doesNotMatch(enriched, /no document titles|do not describe that/);
  const unsupported = enrichChatResponseForAction({
    integrationProvider: "google-docs", content: "The document describes src/invented/auth.js.",
    contextBundle: [{ data: { googleDocsSearch: { documents: [{
      title: "Coop AI — Architecture Overview", excerpt: "Backend: src/server/githubAppApi.ts."
    }] } } }]
  });
  assert.doesNotMatch(unsupported, /src\/invented\/auth\.js/);
  assert.match(unsupported, /Coop AI — Architecture Overview/);
});

test("/docs final response supplies the opened document source link once", () => {
  const url = "https://docs.google.com/document/d/fixture/edit";
  const bundle = [{ data: { googleDocsSearch: { documents: [{
    title: "Coop AI — Architecture Overview", htmlUrl: url, excerpt: "Synthetic demo documentation describes a React sidebar."
  }] } } }];
  const summary = "The document describes a React sidebar and identifies itself as synthetic demo documentation.";
  const enriched = enrichChatResponseForAction({ integrationProvider: "google-docs", content: summary, contextBundle: bundle });
  assert.match(enriched, /\[Coop AI — Architecture Overview\]\(https:\/\/docs.google.com\/document\/d\/fixture\/edit\)/);
  const alreadyLinked = `${summary} [Architecture Overview](${url})`;
  const preserved = enrichChatResponseForAction({ integrationProvider: "google-docs", content: alreadyLinked, contextBundle: bundle });
  assert.equal(preserved.split(url).length - 1, 1);
});

test("gaps import-only next steps verify symbol use while preserving conditional finding and source", () => {
  const body = "export function positiveSum(values: number[]) {\n  return values[0];\n}";
  const finding = "**Source findings**\n\nObserved: only the first element is returned. If the intended contract is a total, confirm that expectation before changing it.";
  const bundle = [
    {type: "knowledge_gaps", data: {focusFiles: [{path: "src/mathRenamed.ts", content: body, startLine: 1}, {path: "src/caller.ts", content: "import { fixtureBranchLabel } from './mathRenamed';", startLine: 1}]}},
    {type: "dependencies", data: {directDependents: ["src/caller.ts"], graphMeta: {source: "import-parse", edgeCount: 1}}}
  ];
  const result = enrichChatResponseForAction({content: finding + "\n\n**Recommended next steps**\n\n1. The only known caller is src/caller.ts, which would be affected.", quickAction: "knowledge-gaps", contextBundle: bundle, activeFile: "src/mathRenamed.ts"});
  assert.ok(result.includes("Observed: only the first element is returned"));
  assert.ok(result.includes("If the intended contract is a total"));
  assert.ok(result.includes("```1:3:src/mathRenamed.ts"));
  assert.ok(result.includes("Inspect retrieved file dependents (`src/caller.ts`) for actual use"));
  assert.ok(result.includes("Runtime impact remains unverified"));
  assert.equal(result.includes("only known caller"), false);
  assert.equal(result.includes("which would be affected"), false);
});

const total = passed + failed;
console.log(`\nchatResponseEnrichment: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
