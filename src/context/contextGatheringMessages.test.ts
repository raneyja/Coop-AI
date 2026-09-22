import assert from "node:assert/strict";
import { contextGatheringMessagesFor } from "./contextGatheringMessages";
import { UserIntent, type IntentEvent } from "./intentDetector";

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

function event(partial: Partial<IntentEvent> & Pick<IntentEvent, "intent">): IntentEvent {
  return {
    id: "test",
    timestamp: new Date(),
    costEstimate: "expensive",
    context: {},
    ...partial
  };
}

const THEATER = [
  "Gathering workspace context…",
  "Searching indexed codebase…",
  "Gathering deeper repo context…",
  "Updating lightweight context…",
  "Gathering integration context…",
  "Fetching context…"
];

function assertNoTheater(messages: string[]): void {
  for (const line of THEATER) {
    assert.ok(!messages.includes(line), `theater label present: ${line}`);
  }
  assert.ok(!messages.some((message) => /estate index/i.test(message)));
  assert.ok(!messages.some((message) => /Slack|Jira|Confluence|Notion|Teams/i.test(message)));
  assert.ok(!messages.some((message) => /blast/i.test(message)));
}

const EXPLAIN = "What does this file do?";

test("understand-repo names the overview, not an estate search", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "understand-repo", owner: "acme", repo: "coop-ai" }
    }),
    {
      codeHostProvider: "gitlab",
      codeHostConnected: true,
      integrations: { jira: true, confluence: true },
      honestRepoScope: true,
      repoId: "gitlab:acme/coop-ai"
    }
  );
  assert.deepEqual(messages, ["Building repository overview…"]);
  assertNoTheater(messages);
});

test("understand-repo does not seed disconnected or connected integrations", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "understand-repo", owner: "acme", repo: "coop-ai" }
    }),
    {
      codeHostProvider: "github",
      codeHostConnected: false,
      integrations: { jira: true, confluence: true },
      honestRepoScope: true,
      repoId: "github:acme/coop-ai"
    }
  );
  assert.deepEqual(messages, ["Building repository overview…"]);
});

test("trace-decision names decision evidence, not a pull-request search", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "trace-decision", owner: "acme", repo: "coop-ai" }
    }),
    { codeHostProvider: "bitbucket", codeHostConnected: true, honestRepoScope: true, repoId: "bitbucket:acme/coop-ai" }
  );
  assert.deepEqual(messages, ["Tracing decision evidence…"]);
  assert.ok(!messages.some((message) => /pull request history/i.test(message)));
});

test("1 L explain names the open file and never the index", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "workspace",
        owner: "acme",
        repo: "coop-ai",
        repoId: "github:acme/coop-ai",
        queryText: EXPLAIN
      }
    }),
    {
      sessionMode: "file-assistant",
      attachedFilePaths: ["src/a.ts"],
      codeHostProvider: "github",
      codeHostConnected: true,
      integrations: { slack: true, jira: true },
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: true
    }
  );
  assert.deepEqual(messages, ["Read `src/a.ts`"]);
  assertNoTheater(messages);
});

test("4 leftover Use-repo on an L file still does not justify index or estate lines", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "/Users/jon/notes.ts",
        fileSource: "external",
        owner: "acme",
        repo: "coop-ai",
        branch: "main",
        repoId: "github:acme/coop-ai",
        queryText: EXPLAIN
      }
    }),
    {
      sessionMode: "file-assistant",
      attachedFilePaths: ["/Users/jon/notes.ts"],
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      codeHostConnected: true,
      codeHostProvider: "github"
    }
  );
  assert.deepEqual(messages, ["Read `/Users/jon/notes.ts`"]);
  assertNoTheater(messages);
});

test("2 R explain seeds a repo search only when that search will run", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: EXPLAIN
      }
    }),
    {
      sessionMode: "indexed-repo",
      attachedFilePaths: ["src/a.ts"],
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: true
    }
  );
  assert.ok(messages.includes("Read `src/a.ts`"));
  assert.ok(messages.includes("Searching repo for `What does this file do?`"));
  assert.ok(!messages.includes("Searching indexed codebase…"));
  assertNoTheater(messages.filter((message) => !message.startsWith("Searching repo")));
});

test("3 R explain omits the index line when semantic search will not run", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: "hi there"
      }
    }),
    {
      sessionMode: "indexed-repo",
      attachedFilePaths: ["src/a.ts"],
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: true
    }
  );
  assert.deepEqual(messages, ["Read `src/a.ts`"]);
  assert.ok(!messages.some((message) => /indexed codebase|Searching repo/i.test(message)));
});

test("R explain omits the index line when retrieval is disabled", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: EXPLAIN
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: false
    }
  );
  assert.ok(!messages.some((message) => /Searching repo|indexed codebase/i.test(message)));
});

test("5 L buffer attach records Read and does not fall through to the remote script", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "workspace",
        queryText: EXPLAIN
      }
    }),
    { sessionMode: "file-assistant", attachedFilePaths: ["src/a.ts"] }
  );
  assert.deepEqual(messages, ["Read `src/a.ts`"]);
});

test("6 integration slash does not seed a repo hunt", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        owner: "acme",
        repo: "coop-ai",
        repoId: "github:acme/coop-ai",
        queryText: "who decided redis",
        integrationProvider: "slack"
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      integrations: { slack: true },
      codeHostConnected: true,
      semanticRetrievalEnabled: true
    }
  );
  assert.deepEqual(messages, []);
});

test("7 file-assistant blast does not seed blast gather labels", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: {
        buttonClicked: "blast-radius",
        file: "src/a.ts",
        fileSource: "workspace",
        owner: "acme",
        repo: "coop-ai",
        queryText: "/blast"
      }
    }),
    { sessionMode: "file-assistant", honestRepoScope: true, repoId: "github:acme/coop-ai" }
  );
  assert.deepEqual(messages, []);
});

test("remote blast names dependency work and not a fake gather script", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: {
        buttonClicked: "blast-radius",
        file: "src/a.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai"
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      codeHostConnected: true,
      integrations: { jira: true, slack: true }
    }
  );
  assert.deepEqual(messages, ["Analyzing dependencies…", "Scanning callers and dependents…"]);
  assertNoTheater(messages);
});

test("locate hunt does not seed indexed gather — the agent posts Searched and Read", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/a.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: "where is requireAuth implemented?"
      }
    }),
    {
      sessionMode: "indexed-repo",
      attachedFilePaths: ["src/a.ts"],
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: true
    }
  );
  assert.deepEqual(messages, ["Read `src/a.ts`"]);
  assert.ok(!messages.some((message) => /workspace context|indexed codebase|Searching repo/i.test(message)));
});

test("ship-check English does not enter Blast labels", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        owner: "acme",
        repo: "coop-ai",
        queryText: "If I change that missing-key response, what else should I check?"
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai",
      semanticRetrievalEnabled: true
    }
  );
  assert.ok(!messages.some((message) => /blast|Analyzing dependencies|workspace context|indexed codebase/i.test(message)));
});

test("9 history ask on R seeds created-lookup only when that fetch runs", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/server/authMiddleware.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: "who created this file?"
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai"
    }
  );
  assert.ok(messages.includes("Look up who created `src/server/authMiddleware.ts`"));
  assert.ok(!messages.some((message) => /indexed codebase|workspace context|estate/i.test(message)));
});

test("9 caller and history todos are not promised on L", () => {
  const ask =
    "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?";
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/server/authMiddleware.ts",
        fileSource: "workspace",
        owner: "acme",
        repo: "coop-ai",
        queryText: ask
      }
    }),
    {
      sessionMode: "file-assistant",
      attachedFilePaths: ["src/server/authMiddleware.ts"],
      honestRepoScope: true,
      repoId: "github:acme/coop-ai"
    }
  );
  assert.deepEqual(messages, ["Read `src/server/authMiddleware.ts`"]);
  assert.ok(!messages.some((message) => /rely on|who created/i.test(message)));
});

test("9 caller todo on R is omitted when the agent hunt owns the turn", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/server/authMiddleware.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: "who calls this file?"
      }
    }),
    {
      sessionMode: "indexed-repo",
      honestRepoScope: true,
      repoId: "github:acme/coop-ai"
    }
  );
  assert.ok(!messages.some((message) => /rely on/i.test(message)));
});

test("9 caller todo on R stays when gather runs the dependents fetch", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        file: "src/server/authMiddleware.ts",
        fileSource: "remote",
        owner: "acme",
        repo: "coop-ai",
        queryText: "who calls this file?"
      }
    }),
    {
      sessionMode: "indexed-repo",
      codeEditIntent: true,
      honestRepoScope: true,
      repoId: "github:acme/coop-ai"
    }
  );
  assert.ok(messages.includes("Find files that rely on `src/server/authMiddleware.ts`"));
});

test("plain chat without a repo target has no estate or workspace line", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: { queryText: "hello" }
    }),
    { codeHostProvider: "github", codeHostConnected: true, semanticRetrievalEnabled: true }
  );
  assert.deepEqual(messages, []);
});

test("remote highlight change does not seed a repo search", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        queryText: "add a comment that says testest",
        file: ".dockerignore",
        fileSource: "remote",
        lines: { start: 11, end: 11 },
        owner: "raneyja",
        repo: "Coop-AI",
        repoId: "github:raneyja/Coop-AI"
      }
    }),
    {
      codeHostProvider: "github",
      codeHostConnected: true,
      honestRepoScope: true,
      repoId: "github:raneyja/Coop-AI",
      semanticRetrievalEnabled: true,
      sessionMode: "indexed-repo"
    }
  );
  assert.ok(!messages.some((message) => /Searching repo/i.test(message)));
});

const total = passed + failed;
console.log(`\n${passed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);
