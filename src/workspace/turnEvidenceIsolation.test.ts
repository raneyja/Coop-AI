import assert from "node:assert/strict";
import { mergeContextBundleResults } from "../chat/mergeContextBundle";
import { hydrateContextBundleFromArtifacts } from "../chat/hydrateContextBundleFromArtifacts";
import type { ContextFetchResult } from "../context/requestBatcher";
import { isolateContextBundleForTurn } from "./repoEvidenceIsolation";

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

const leftoverPages = [
  {
    title: "ADR: Backend service extraction (COOP-101)",
    excerpt: "github:raneyja/Coop-AI coop-ai-core"
  },
  {
    title: "Developer onboarding — VS Code extension",
    excerpt: "VS Code extension onboarding for github:raneyja/Coop-AI"
  }
];

function entry(
  type: string,
  data: Record<string, unknown>
): ContextFetchResult {
  return {
    requestId: type,
    type: type as ContextFetchResult["type"],
    data,
    fetchedAt: new Date()
  };
}

test("merge drops leftover Coop pages when Use-repo is coop-ai/plane", () => {
  const merged = mergeContextBundleResults(
    [entry("chat_context", { confluenceSearch: { pages: leftoverPages } })],
    [
      entry("dependencies", {
        file: "apps/api/settings.py",
        directDependents: [],
        warnings: ["Impact unverified: no dependents found in index"]
      })
    ],
    "apps/api/settings.py",
    { owner: "coop-ai", repo: "plane" }
  );
  const blob = JSON.stringify(merged);
  assert.doesNotMatch(blob, /COOP-101|VS Code extension/);
  const deps = merged.find((item) => item.type === "dependencies");
  const data = deps?.data as { directDependents?: string[]; warnings?: string[] };
  assert.deepEqual(data?.directDependents, []);
  assert.match(data?.warnings?.join(" ") ?? "", /unverified/i);
});

test("merge keeps Coop pages when Use-repo is raneyja/Coop-AI", () => {
  const merged = mergeContextBundleResults(
    [entry("chat_context", { confluenceSearch: { pages: leftoverPages } })],
    [entry("dependencies", { file: "src/extension.ts", directDependents: [] })],
    "src/extension.ts",
    { owner: "raneyja", repo: "Coop-AI" }
  );
  const blob = JSON.stringify(merged);
  assert.match(blob, /COOP-101/);
  assert.match(blob, /VS Code extension/);
});

test("merge with empty incoming docs does not keep a prior repo's pages", () => {
  const merged = mergeContextBundleResults(
    [entry("chat_context", { confluenceSearch: { pages: leftoverPages } })],
    [entry("chat_context", { confluenceSearch: { pages: [] } })],
    undefined,
    { owner: "coop-ai", repo: "plane" }
  );
  assert.doesNotMatch(JSON.stringify(merged), /COOP-101|VS Code extension/);
});

test("/slack this turn drops leftover Jira and foreign Slack", () => {
  const isolated = isolateContextBundleForTurn(
    [
      entry("chat_context", {
        jiraSearch: {
          issues: [{ key: "COOP-101", summary: "Backend extraction for github:raneyja/Coop-AI" }]
        },
        slackSearch: {
          messages: [
            { text: "COOP-101 shipped in github:raneyja/Coop-AI", ts: "1" },
            { text: "plane preview deploy is green", ts: "2" }
          ]
        },
        confluenceSearch: { pages: leftoverPages }
      })
    ],
    { owner: "coop-ai", repo: "plane", namedIntegration: "slack" }
  );
  const data = isolated[0]?.data as {
    jiraSearch?: unknown;
    confluenceSearch?: unknown;
    slackSearch?: { messages?: Array<{ text: string }> };
  };
  assert.equal(data.jiraSearch, undefined);
  assert.equal(data.confluenceSearch, undefined);
  assert.equal(data.slackSearch?.messages?.length, 1);
  assert.match(data.slackSearch?.messages?.[0]?.text ?? "", /plane preview/);
});

test("/compare keeps only the two named repos", () => {
  const isolated = isolateContextBundleForTurn(
    [
      entry("chat_context", {
        dualRepoCompare: {
          left: { owner: "coop-ai", repo: "plane", files: [] },
          right: { owner: "documenso", repo: "documenso", files: [] }
        },
        slackSearch: {
          messages: [
            { text: "plane preview deploy", ts: "1" },
            { text: "documenso signing status", ts: "2" },
            { text: "github:raneyja/Coop-AI ADR COOP-101", ts: "3" }
          ]
        },
        files: [
          { path: "apps/api/settings.py", repoId: "github:coop-ai/plane", content: "plane" },
          { path: "src/extension.ts", repoId: "github:raneyja/Coop-AI", content: "coop" }
        ]
      })
    ],
    { owner: "raneyja", repo: "Coop-AI" }
  );
  const data = isolated[0]?.data as {
    slackSearch?: { messages?: Array<{ text: string }> };
    files?: Array<{ path: string }>;
  };
  const slack = (data.slackSearch?.messages ?? []).map((message) => message.text).join("\n");
  assert.match(slack, /plane preview/);
  assert.match(slack, /documenso/);
  assert.doesNotMatch(slack, /COOP-101/);
  assert.deepEqual(
    (data.files ?? []).map((file) => file.path),
    ["apps/api/settings.py"]
  );
});

test("hydrate drops artifact docs that belong to another repo", () => {
  const bundle = hydrateContextBundleFromArtifacts(
    [
      {
        id: "evidence-1",
        kind: "knowledge-gaps",
        timestamp: Date.now(),
        payload: {
          confluence: { pages: leftoverPages },
          file: "apps/api/settings.py"
        }
      }
    ],
    { owner: "coop-ai", repo: "plane" }
  );
  assert.doesNotMatch(JSON.stringify(bundle), /COOP-101|VS Code extension/);

  const kept = hydrateContextBundleFromArtifacts(
    [
      {
        id: "evidence-2",
        kind: "knowledge-gaps",
        timestamp: Date.now(),
        payload: {
          confluence: { pages: leftoverPages }
        }
      }
    ],
    { owner: "raneyja", repo: "Coop-AI" }
  );
  assert.match(JSON.stringify(kept), /COOP-101/);
});

test("preserved hunts for a different file are evicted", () => {
  const merged = mergeContextBundleResults(
    [
      entry("dependencies", {
        file: "old/file.py",
        directDependents: ["leftover/caller.py"],
        confluenceSearch: { pages: leftoverPages }
      })
    ],
    [entry("file_metadata", { file: "apps/api/settings.py" })],
    "apps/api/settings.py",
    { owner: "coop-ai", repo: "plane" }
  );
  const deps = merged.find((item) => item.type === "dependencies");
  const data = deps?.data as { directDependents?: string[]; confluenceSearch?: unknown };
  assert.equal(data?.directDependents, undefined);
  assert.equal(data?.confluenceSearch, undefined);
});

const total = passed + failed;
console.log(`\nturnEvidenceIsolation: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
