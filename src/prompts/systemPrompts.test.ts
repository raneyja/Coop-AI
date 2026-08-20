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
const OUTPUT_CONTRACT_MARKER = "## Response structure";
const TYPOGRAPHY_MARKER = "## Typography (not markdown)";

test("chat use case includes audience and output contract", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(TYPOGRAPHY_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
  assert.ok(prompt.includes("Do NOT use: # headings"));
  assert.ok(prompt.includes("*italics* for uncertainty"));
  assert.ok(prompt.includes("use a **citation fence** (cite intent)"));
  assert.ok(prompt.includes("copied **verbatim** from attached evidence"));
  assert.ok(prompt.includes("Do **not** abbreviate repo code"));
  assert.ok(prompt.includes("PASS example first line:"));
  assert.ok(prompt.includes("FAIL: literal placeholders"));
  assert.ok(prompt.includes("one **subsection title** per item"));
  assert.ok(prompt.includes("## Required response structure"));
});

test("chat use case requires answer-style Your question and applyable edit patches", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes("Never restate, paraphrase, or truncate the user's question text"));
  assert.ok(prompt.includes("FAIL: restating, paraphrasing, or truncating the user's question"));
  assert.ok(prompt.includes("## Concrete file edits (when recommending code to apply)"));
  assert.ok(prompt.includes("<<<<<<< SEARCH"));
  assert.ok(prompt.includes("Multiple edits → multiple patch blocks"));
  assert.ok(prompt.includes("emit `File:` + ```patch SEARCH/REPLACE blocks"));
  assert.ok(prompt.includes("not literal `startLine:endLine:…` placeholders"));
});

test("paperclip attachment rule is gated on hasPaperclipAttachments (B6)", () => {
  const withoutAttachments = systemPromptForUseCase("chat");
  assert.equal(withoutAttachments.includes("User-attached files (paperclip)"), false);

  const withAttachments = systemPromptForUseCase("chat", { hasPaperclipAttachments: true });
  assert.ok(withAttachments.includes("User-attached files (paperclip)"));

  // Applies to the patch-output (edit) contract too.
  assert.equal(systemPromptForUseCase("code_edit").includes("User-attached files (paperclip)"), false);
  assert.ok(
    systemPromptForUseCase("code_edit", { hasPaperclipAttachments: true }).includes(
      "User-attached files (paperclip)"
    )
  );
});

test("chat use case includes enterprise evidence rules", () => {
  const prompt = systemPromptForUseCase("chat");
  assert.ok(prompt.includes("strong / medium / weak / limited"));
  assert.ok(prompt.includes("integration blocks show <empty>"));
  assert.ok(prompt.includes("Never invent ticket IDs, PR numbers"));
  assert.ok(prompt.includes("Weight sources by reliability for decisions"));
  assert.ok(prompt.includes("search samples / capped result sets"));
});

test("comprehension use case includes audience block via withOutputContract", () => {
  const prompt = systemPromptForUseCase("comprehension");
  assert.ok(prompt.includes(AUDIENCE_MARKER));
  assert.ok(prompt.includes(OUTPUT_CONTRACT_MARKER));
  assert.ok(prompt.includes("## Required response structure"));
  assert.ok(prompt.includes("**Architecture**"));
  assert.ok(prompt.includes("**Your question**"));
  assert.ok(prompt.includes("## User focus (required)"));
  assert.ok(prompt.includes("PASS:"));
  assert.ok(prompt.includes("FAIL:"));
  assert.ok(prompt.includes("generic form→API→DB"));
  assert.ok(prompt.includes("**How the open file fits**"));
  assert.ok(prompt.includes("Omit entirely for repo-wide runs with no open file"));
  assert.ok(prompt.includes("Based on inventory + anchors; no Confluence/Jira"));
  assert.ok(prompt.includes("Do not treat disconnected or empty Coop integrations"));
  assert.ok(prompt.includes('Avoid generic "read the README"'));
  assert.ok(prompt.includes("one concrete fact"));
  assert.ok(prompt.includes("answer that ask explicitly"));
});

test("comprehension use case requires active file section when activeFile is set", () => {
  const prompt = systemPromptForUseCase("comprehension", { activeFile: "src/server/githubAppApi.ts" });
  assert.ok(prompt.includes("**How the open file fits**"));
  assert.ok(prompt.includes("Required for this response"));
  assert.ok(prompt.includes("`src/server/githubAppApi.ts`"));
  assert.ok(!prompt.includes("Omit entirely for repo-wide runs with no open file"));
});

test("knowledge_gaps use case requires grouped subsection structure", () => {
  const prompt = systemPromptForUseCase("knowledge_gaps");
  assert.ok(prompt.includes("## Response structure"));
  assert.ok(prompt.includes("**Documentation gaps**"));
  assert.ok(prompt.includes("**Notion pages reviewed**"));
  assert.ok(prompt.includes("**Confluence pages reviewed**"));
  assert.ok(prompt.includes('count="N"'));
  assert.ok(prompt.includes("Forbidden section names"));
  assert.ok(prompt.includes("subsection title"));
  assert.ok(prompt.includes("never top-level bullets without a subsection title"));
  assert.ok(prompt.includes("**What to check:**"));
  assert.ok(prompt.includes("Never bullet the title"));
  assert.ok(prompt.includes("Omit the entire section"));
});

test("blast_radius use case includes impact sections", () => {
  const prompt = systemPromptForUseCase("blast_radius");
  assert.ok(prompt.includes("**Transitive dependents**"));
  assert.ok(prompt.includes("**Testing surfaces**"));
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
  assert.ok(prompt.includes("## Editor selection (required when present)"));
  assert.ok(prompt.includes("fully implement"));
  assert.ok(prompt.includes("exact copy of the entire"));
  assert.ok(prompt.includes("PENDING/OPEN"));
  assert.equal(prompt.includes("Uniform response template"), false);
  assert.equal(prompt.includes("1. **Summary** or **Answer**"), false);
  assert.equal(prompt.includes("Selection or focus hints mark where to start looking"), false);
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

  assert.ok(message.includes('<jira_tickets match="text" shown="1">'));
  assert.ok(message.includes("Search sample only"));
  assert.ok(message.includes('key="COOP-101"'));
  assert.ok(message.includes("Auth hardening"));

  // B7: integration records are XML-only — not double-sent inside <graph_context>.
  const graphContext = message.slice(message.indexOf("<graph_context>"), message.indexOf("</graph_context>"));
  assert.equal(graphContext.includes("jiraSearch"), false, "graph_context must not duplicate jiraSearch");
  // B7: graph_context JSON is compact (no pretty-print indentation).
  assert.equal(graphContext.includes('\n  "'), false, "graph_context should be compact JSON");
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

  assert.ok(message.includes('<slack_messages shown="1">'));
  assert.ok(message.includes("Search sample only"));
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

  assert.ok(message.includes("<code_host_activity"));
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

test("formatChatMessageWithLocalFiles includes editor_selection for highlighted range", () => {
  const message = formatChatMessageWithLocalFiles({
    message: "/edit shorten this highlighted block",
    file: "apps/api/middleware/auth.py",
    selectedLines: [17, 27],
    files: [
      {
        path: "apps/api/middleware/auth.py",
        content: [
          "line1",
          "line2",
          "line3",
          "line4",
          "line5",
          "line6",
          "line7",
          "line8",
          "line9",
          "line10",
          "line11",
          "line12",
          "line13",
          "line14",
          "line15",
          "line16",
          "class APIKeyAuthentication:",
          "    media_type = 'application/json'",
          "    def get_api_token(self, request):",
          "        return request.headers.get('X-Api-Key')",
          "line21",
          "line22",
          "line23",
          "line24",
          "line25",
          "line26",
          "line27"
        ].join("\n")
      }
    ]
  });

  assert.ok(message.includes('<editor_selection path="apps/api/middleware/auth.py" lines="17-27">'));
  assert.ok(message.includes("class APIKeyAuthentication:"));
  assert.ok(message.includes("def get_api_token"));
  assert.ok(message.includes("Edit directive:"));
  assert.ok(message.includes("character-for-character"));
  assert.ok(message.includes("Do not substitute a different function"));
});

test("formatChatMessageWithLocalFiles keeps L56–61 even when the full file is attached", () => {
  const rows = Array.from({ length: 90 }, (_, i) => {
    const line = i + 1;
    if (line === 56) return "    def validate_name(self):";
    if (line >= 57 && line <= 61) return `        # selected body ${line}`;
    if (line === 80) return "    def get_queryset(self):";
    return `# filler ${line}`;
  });
  const message = formatChatMessageWithLocalFiles({
    message: "/edit add a one-line comment above the selected function.",
    file: "apps/api/plane/db/models/state.py",
    selectedLines: [56, 61],
    files: [
      {
        path: "apps/api/plane/db/models/state.py",
        content: rows.join("\n")
      }
    ]
  });

  assert.ok(message.includes('<editor_selection path="apps/api/plane/db/models/state.py" lines="56-61">'));
  assert.ok(message.includes("def validate_name(self):"));
  assert.ok(message.includes("Do not substitute a different function"));
  const selectionBlock = message.slice(
    message.indexOf("<editor_selection"),
    message.indexOf("</editor_selection>")
  );
  assert.equal(selectionBlock.includes("def get_queryset"), false);
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
  assert.ok(message.includes("<slack_messages"));
  assert.ok(message.includes("<empty>No matching Slack messages found.</empty>"));
  assert.ok(message.includes("<code_host_activity"));
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
  assert.ok(message.includes("In-repo package manifests / entry points"));
  assert.ok(message.includes("package.json"));
  assert.ok(message.includes("activate()"));
});

test("buildUserMessageWithContext renders concrete package structure over workspace globs", () => {
  const message = buildUserMessageWithContext("What's in the top-level package structure?", {
    owner: "documenso",
    repo: "documenso",
    branch: "main",
    contextBundle: [
      {
        type: "file_metadata",
        data: {
          treeOverview: { topLevelDirs: ["apps", "packages"], topLevelFiles: ["package.json"] },
          entryFiles: [
            {
              path: "package.json",
              content: '{"name":"documenso","workspaces":["apps/*","packages/*"]}'
            }
          ],
          packageStructure: {
            packages: ["apps/remix", "packages/prisma", "packages/signing"],
            parents: ["apps", "packages"],
            workspaceGlobs: ["apps/*", "packages/*"]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_package_structure>"));
  assert.ok(message.includes("apps/remix"));
  assert.ok(message.includes("packages/signing"));
  assert.ok(message.includes("packages/prisma"));
  assert.ok(message.includes("workspace_globs"));
  assert.ok(message.includes("Prefer these names over workspace globs"));
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

test("buildUserMessageWithContext renders repo_inventory for file-count questions", () => {
  const message = buildUserMessageWithContext("how many files are inside of this repo?", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          repoInventory: { source: "manifest", fileCount: 1842, lastCrawledAt: "2026-07-01T00:00:00.000Z" }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_inventory>"));
  assert.ok(message.includes('file_count="1842"'));
  assert.ok(message.includes('source="manifest"'));
  assert.ok(message.includes("Measured repository totals"));
});

test("buildUserMessageWithContext renders line_count for LOC questions", () => {
  const message = buildUserMessageWithContext("how many lines of code are in this repo?", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          repoInventory: {
            source: "index-stats",
            fileCount: 1233,
            lineCount: 66934,
            languages: ["ts", "md"],
            indexedAt: "2026-07-24T00:00:00.000Z"
          }
        }
      }
    ]
  });

  assert.ok(message.includes('source="index-stats"'));
  assert.ok(message.includes('line_count="66934"'));
  assert.ok(message.includes('file_count="1233"'));
  assert.ok(message.includes("66934 line(s) of code"));
});

test("buildUserMessageWithContext forbids estimating a missing line count", () => {
  const message = buildUserMessageWithContext("how many lines of code are in this repo?", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          repoInventory: {
            source: "tree",
            fileCount: 1233,
            note:
              "No line count is recorded for this repository — Deep-Index has not stored line stats for it yet. " +
              "Say the line count is unavailable and offer to re-index. Do not estimate it from file counts or attached snippets."
          }
        }
      }
    ]
  });

  assert.ok(message.includes('file_count="1233"'));
  assert.equal(message.includes("line_count="), false);
  assert.match(message, /Do not estimate it from file counts/);
});

test("repo_inventory is declared the only source for totals", () => {
  const message = buildUserMessageWithContext("how many lines of code?", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: { repoInventory: { source: "unavailable", note: "Coop has no indexed inventory." } }
      }
    ]
  });

  assert.match(message, /only valid source for file, line, or size totals/i);
  assert.match(message, /never compute them from <repo_semantic_files>/i);
});

test("buildUserMessageWithContext marks semantic files as a retrieval sample", () => {
  const message = buildUserMessageWithContext("How does indexing work?", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          repoSemanticSearch: {
            matchedPathCount: 42,
            attachmentCap: 3,
            files: [
              { path: "src/indexing/indexManager.ts", repoId: "github:acme/coop-ai", content: "export class IndexManager {}" }
            ]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_semantic_files>"));
  assert.ok(message.includes("Retrieval sample only"));
  assert.ok(message.includes("attached 1 of 42 matched path(s)"));
  assert.ok(message.includes("Never count these paths as the total number of files"));
});

test("buildUserMessageWithContext renders dual repo_compare evidence for both sides", () => {
  const message = buildUserMessageWithContext("Compare auth.", {
    owner: "CoopAI-Corp",
    repo: "plane",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          dualRepoCompare: {
            source: "dual-repo-compare",
            topic: "auth tenancy",
            stickyRepoExcluded: "github:acme/other",
            left: {
              repoId: "github:CoopAI-Corp/plane",
              owner: "CoopAI-Corp",
              repo: "plane",
              files: [
                {
                  path: "apps/api/plane/authentication.py",
                  repoId: "github:CoopAI-Corp/plane",
                  content: "class APIKeyAuthentication"
                }
              ]
            },
            right: {
              repoId: "github:CoopAI-Corp/documenso",
              owner: "CoopAI-Corp",
              repo: "documenso",
              files: [
                {
                  path: "packages/lib/server-only/api-token/get.ts",
                  repoId: "github:CoopAI-Corp/documenso",
                  content: "getApiTokenByToken"
                }
              ]
            }
          },
          localFiles: {
            files: [{ path: "src/chat/CoopChatSession.ts", content: "should not attach" }]
          }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_compare"));
  assert.ok(message.includes('side="CoopAI-Corp/plane"'));
  assert.ok(message.includes('side="CoopAI-Corp/documenso"'));
  assert.ok(message.includes("APIKeyAuthentication"));
  assert.ok(message.includes("getApiTokenByToken"));
  assert.ok(message.includes("excluded_sticky_repo"));
  assert.ok(!message.includes("src/chat/CoopChatSession.ts"));
  assert.ok(!message.includes("<local_files>"));
  assert.match(systemPromptForUseCase("chat"), /repo_compare/);
});

test("buildUserMessageWithContext renders live tree overview", () => {
  const message = buildUserMessageWithContext("list the top-level directories", {
    owner: "acme",
    repo: "coop-ai",
    contextBundle: [
      {
        type: "chat_context",
        data: {
          treeOverview: { topLevelDirs: ["src", "docs"], topLevelFiles: ["package.json", "README.md"] }
        }
      }
    ]
  });

  assert.ok(message.includes("<repo_tree_overview>"));
  assert.ok(message.includes("directories: src, docs"));
  assert.ok(message.includes("files: package.json, README.md"));
});

test("pr_summary use case is short notes without the chat output contract", () => {
  const prompt = systemPromptForUseCase("pr_summary");
  assert.ok(prompt.includes("pull request notes"));
  assert.equal(prompt.includes(AUDIENCE_MARKER), false);
  assert.equal(prompt.includes(OUTPUT_CONTRACT_MARKER), false);
});

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nsystemPrompts: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
