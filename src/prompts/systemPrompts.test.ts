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
const TYPOGRAPHY_MARKER = "## Typography (not markdown)";

test("chat use case includes audience and output contract", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(TYPOGRAPHY_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
  assert.ok(prompt.includes("Do NOT use: # headings"));
  assert.ok(prompt.includes("*italics* for uncertainty"));
  assert.ok(prompt.includes("Uniform response template"));
  assert.ok(prompt.includes("User-attached files (paperclip)"));
  assert.ok(prompt.includes("## Required response structure"));
});

test("chat use case includes enterprise evidence rules", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes("strong / medium / weak / limited"));
  assert.ok(prompt.includes("integration blocks show <empty>"));
  assert.ok(prompt.includes("pull requests and commit history above Slack/Teams"));
  assert.ok(prompt.includes("Never invent ticket IDs, PR numbers"));
  assert.ok(prompt.includes("Weight sources by reliability for decisions"));
});

test("comprehension use case includes audience block via withOutputContract", () => {
  const prompt = systemPromptForUseCase("comprehension");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
  assert.ok(prompt.includes("## Required response structure"));
  assert.ok(prompt.includes("**Architecture**"));
  assert.ok(prompt.includes("**How the open file fits**"));
  assert.ok(prompt.includes("Omit entirely for repo-wide runs with no open file"));
});

test("comprehension use case requires active file section when activeFile is set", () => {
  const prompt = systemPromptForUseCase("comprehension", { activeFile: "src/server/githubAppApi.ts" });
  assert.ok(prompt.includes("**How the open file fits**"));
  assert.ok(prompt.includes("Required for this response"));
  assert.ok(prompt.includes("`src/server/githubAppApi.ts`"));
  assert.ok(!prompt.includes("Omit entirely for repo-wide runs with no open file"));
});

test("knowledge_gaps use case requires scannable top-gaps structure", () => {
  const prompt = systemPromptForUseCase("knowledge_gaps");
  assert.ok(prompt.includes("## Grouping"));
  assert.ok(prompt.includes("**Documentation gaps**"));
  assert.ok(prompt.includes("at most 3"));
  assert.ok(prompt.includes("**Recommended next step**"));
  assert.ok(prompt.includes("Exactly one concrete action"));
  assert.ok(prompt.includes("Forbidden section names"));
  assert.ok(prompt.includes("Never alternate **Open question:**"));
  assert.ok(prompt.includes("**What to check:**"));
  assert.ok(prompt.includes("Never bullet the title"));
  assert.ok(prompt.includes("Omit the entire section"));
  assert.ok(!prompt.includes("List exactly N bullets"));
  assert.ok(!prompt.includes("Numbered list of 2-4"));
});

test("ownership use case leads with contact and omits empty optional sections", () => {
  const prompt = systemPromptForUseCase("ownership");
  assert.ok(prompt.includes("**Summary**"));
  assert.ok(prompt.includes("**True experts**"));
  assert.ok(prompt.includes("**Escalation path**"));
  assert.ok(prompt.includes("**Omit entirely** when no escalation target is evidenced"));
  assert.ok(prompt.includes("lead with who to contact, not an ownership essay"));
  assert.ok(prompt.includes("Omit empty optional sections"));
  assert.ok(prompt.includes("Never invent owners"));
  assert.ok(!prompt.includes("**Recommended next step**"));
  // Optional sections remain as omit-unless-useful, not always-required essay padding
  assert.ok(prompt.includes("**Availability**"));
  assert.ok(prompt.includes("**Omit** when unknown or not actionable"));
  assert.ok(prompt.includes("**Risks**"));
  assert.ok(prompt.includes("do not invent bus-factor essays"));
  assert.ok(prompt.includes("**Knowledge transfer**"));
  assert.ok(prompt.includes("**Omit** otherwise"));
});

test("blast_radius use case enforces short graph-grounded structure", () => {
  const prompt = systemPromptForUseCase("blast_radius");
  assert.ok(prompt.includes("**Hard omit**"));
  assert.ok(prompt.includes("never invent dependents"));
  assert.ok(prompt.includes("not found in the index"));
  assert.ok(prompt.includes("**Direct impact**"));
  assert.ok(prompt.includes("**Testing surfaces**"));
  assert.ok(prompt.includes("Omit** unless test evidence exists"));
  assert.ok(prompt.includes("Core path: **Summary** → **Direct impact**"));
  assert.equal(prompt.includes("None identified"), false);
});

test("inline_completion excludes audience and output contract", () => {
  const prompt = systemPromptForUseCase("inline_completion");
  assert.equal(prompt.includes(AUDIENCE_MARKER), false);
  assert.equal(prompt.includes(OUTPUT_CONTRACT_MARKER), false);
  assert.ok(prompt.includes("code completion engine"));
});

test("code_edit use case uses patch output contract without Summary template", () => {
  const prompt = systemPromptForUseCase("code_edit");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes("## Patch output format (required)"));
  assert.ok(prompt.includes("<<<<<<< SEARCH"));
  assert.ok(prompt.includes(">>>>>>> REPLACE"));
  assert.ok(prompt.includes("edit mode"));
  assert.ok(prompt.includes("## Completeness (required)"));
  assert.ok(prompt.includes("fully implement"));
  assert.equal(prompt.includes("Uniform response template"), false);
  assert.equal(prompt.includes("1. **Summary** or **Answer**"), false);
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

  assert.ok(message.includes('<confluence_pages count="1">'));
  assert.ok(message.includes("List all 1 page titles under **Confluence pages reviewed**"));
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

test("buildUserMessageWithContext tolerates partial integration payloads in blast-radius bundle", () => {
  const message = buildUserMessageWithContext("Estimate blast radius.", {
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    contextBundle: [
      {
        type: "dependencies",
        data: {
          file: "fastify.js",
          directDependents: [],
          ownersByFile: [{ file: "fastify.js", owner: "climba03003", source: "codeowners" }],
          slackSearch: { query: "coop-demo-lab/fastify OR fastify" },
          codeHostSearch: { provider: "github", repoQuery: "coop-demo-lab/fastify" }
        }
      }
    ]
  });

  assert.ok(message.includes("<graph_context>"));
  assert.ok(message.includes("<slack_messages>"));
  assert.ok(message.includes("<empty>No matching Slack messages found.</empty>"));
  assert.ok(message.includes("<code_host_activity>"));
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

test("buildUserMessageWithContext renders project instructions and dedupes AGENTS.md entry files", () => {
  const message = buildUserMessageWithContext("How should I work in this repo?", {
    contextBundle: [
      {
        type: "file_metadata",
        data: {
          entryFiles: [
            { path: "AGENTS.md", content: "remote agents copy" },
            { path: "README.md", content: "# Coop" }
          ]
        }
      }
    ],
    projectInstructions: [{ path: "AGENTS.md", content: "local agents copy", kind: "agents-md" }]
  });

  assert.ok(message.includes("<project_instructions>"));
  assert.ok(message.includes("local agents copy"));
  assert.ok(message.includes("README.md"));
  assert.ok(!message.includes("remote agents copy"));
});

test("buildUserMessageWithContext adds monorepo note when treeOverview has multiple top-level dirs", () => {
  const message = buildUserMessageWithContext("How is auth wired?", {
    owner: "acme",
    repo: "platform",
    file: "services/auth/src/login.ts",
    contextBundle: [
      {
        type: "file_metadata",
        data: {
          treeOverview: {
            topLevelDirs: ["services/", "packages/", "docs/"],
            topLevelFiles: ["package.json", "turbo.json"]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<monorepo_context>"));
  assert.ok(message.includes("services/"));
  assert.ok(message.includes("packages/"));
  assert.ok(message.includes("Active editor context applies to the `services/` package"));
  assert.ok(message.includes("services/auth/src/login.ts"));
});

test("buildUserMessageWithContext omits monorepo note for single top-level dir", () => {
  const message = buildUserMessageWithContext("How is auth wired?", {
    file: "src/login.ts",
    contextBundle: [
      {
        type: "file_metadata",
        data: {
          treeOverview: { topLevelDirs: ["src/"], topLevelFiles: ["package.json"] }
        }
      }
    ]
  });

  assert.equal(message.includes("<monorepo_context>"), false);
});

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nsystemPrompts: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
