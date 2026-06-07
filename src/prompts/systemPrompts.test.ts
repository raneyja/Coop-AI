import assert from "node:assert/strict";
import { buildUserMessageWithContext, formatChatMessageWithLocalFiles, systemPromptForUseCase } from "./systemPrompts";

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

const AUDIENCE_MARKER = "## Audience & environment";
const OUTPUT_CONTRACT_MARKER = "## Response style";

test("chat use case includes audience and output contract", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
});

test("comprehension use case includes audience block via withOutputContract", () => {
  const prompt = systemPromptForUseCase("comprehension");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
});

test("inline_completion excludes audience and output contract", () => {
  const prompt = systemPromptForUseCase("inline_completion");
  assert.equal(prompt.includes(AUDIENCE_MARKER), false);
  assert.equal(prompt.includes(OUTPUT_CONTRACT_MARKER), false);
  assert.ok(prompt.includes("code completion engine"));
});

test("buildUserMessageWithContext renders jira_tickets from context bundle", () => {
  const message = buildUserMessageWithContext("List Jira tickets for this repo.", {
    owner: "acme",
    repo: "coop-ai-core",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          jiraSearch: {
            jql: '(text ~ "acme/coop-ai-core") ORDER BY updated DESC',
            repoQuery: "acme/coop-ai-core",
            issues: [
              {
                key: "COOP-101",
                summary: "Auth hardening",
                status: "Done",
                issueType: "Story",
                updated: "2026-01-02T00:00:00.000Z",
                htmlUrl: "https://acme.atlassian.net/browse/COOP-101"
              }
            ]
          }
        }
      }
    ]
  });

  assert.ok(message.includes('<jira_tickets match="text">'));
  assert.ok(message.includes('key="COOP-101"'));
  assert.ok(message.includes("Auth hardening"));
});

test("buildUserMessageWithContext renders slack_messages from context bundle", () => {
  const message = buildUserMessageWithContext("Any Slack threads?", {
    owner: "acme",
    repo: "coop-ai-core",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          slackSearch: {
            query: "acme/coop-ai-core OR coop-ai-core",
            repoQuery: "acme/coop-ai-core",
            messages: [
              {
                channelName: "epd",
                userName: "alex",
                text: "Shipped auth hardening for coop-ai-core",
                ts: "1710000000.000100",
                permalink: "https://example.slack.com/archives/C1/p1710000000000100"
              }
            ]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<slack_messages>"));
  assert.ok(message.includes('channel="epd"'));
  assert.ok(message.includes("auth hardening"));
});

test("buildUserMessageWithContext renders code_host_activity from context bundle", () => {
  const message = buildUserMessageWithContext("Open PRs?", {
    owner: "acme",
    repo: "coop-ai-core",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          codeHostSearch: {
            provider: "github",
            repoQuery: "acme/coop-ai-core",
            pullRequests: [
              {
                number: 42,
                title: "Auth hardening",
                state: "open",
                merged: false,
                author: "alex",
                updatedAt: "2026-01-02T00:00:00.000Z",
                htmlUrl: "https://github.com/acme/coop-ai-core/pull/42"
              }
            ],
            issues: []
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<code_host_activity>"));
  assert.ok(message.includes('number="42"'));
  assert.ok(message.includes("Auth hardening"));
});

test("buildUserMessageWithContext renders confluence_pages from context bundle", () => {
  const message = buildUserMessageWithContext("Any Confluence docs?", {
    owner: "acme",
    repo: "coop-ai-core",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          confluenceSearch: {
            cql: 'type=page AND (text ~ "coop-ai-core")',
            repoQuery: "acme/coop-ai-core",
            pages: [
              {
                id: "123",
                title: "Auth middleware RFC",
                updated: "2026-01-02T00:00:00.000Z",
                htmlUrl: "https://acme.atlassian.net/wiki/spaces/EPD/pages/123"
              }
            ]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<confluence_pages>"));
  assert.ok(message.includes("Auth middleware RFC"));
});

test("formatChatMessageWithLocalFiles embeds authoritative file_content", () => {
  const message = formatChatMessageWithLocalFiles({
    message: "Quote the 503 condition.",
    file: "src/server/githubAppApi.ts",
    files: [
      {
        path: "src/server/githubAppApi.ts",
        content: "if (!deps.githubApp || !deps.githubAppConfig) {",
        lineRange: [53, 55]
      }
    ]
  });

  assert.ok(message.includes("<file_content"));
  assert.ok(message.includes("deps.githubApp"));
  assert.ok(message.includes("Quote the 503 condition."));
});

test("buildUserMessageWithContext renders local_files from context bundle", () => {
  const message = buildUserMessageWithContext("Estimate blast radius.", {
    file: "src/panel.ts",
    contextBundle: [
      {
        type: "dependencies",
        data: {
          localFiles: {
            source: "local-workspace",
            activeFile: "src/panel.ts",
            fallbackLevel: "partial",
            files: [{ path: "src/panel.ts", content: "export function bindSession() {}", lineRange: [1, 3] }]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<local_files>"));
  assert.ok(message.includes("authoritative source code"));
  assert.ok(message.includes('path="src/panel.ts" lines="1-3"'));
  assert.ok(message.includes("bindSession"));
});

test("buildUserMessageWithContext renders repo entry files from context bundle", () => {
  const message = buildUserMessageWithContext("Understand this repository.", {
    owner: "raneyja",
    repo: "Coop-AI",
    branch: "main",
    contextBundle: [
      {
        type: "file_metadata",
        data: {
          repoId: "raneyja/Coop-AI",
          entryFiles: [
            { path: "package.json", content: '{ "name": "coop-ai" }' },
            { path: "src/extension.ts", content: "export function activate() {}" }
          ],
          treeOverview: { topLevelDirs: ["src"], topLevelFiles: ["package.json"] }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_entry_files>"));
  assert.ok(message.includes("Representative repository entry points"));
  assert.ok(message.includes("package.json"));
  assert.ok(message.includes("activate()"));
});

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nsystemPrompts: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
