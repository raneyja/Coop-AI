import "../../../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import { CoopBackendClient } from "../../CoopBackendClient";
import type { IndexBackend } from "../../../indexing/indexBackend";
import type { LocalSearchResult } from "../../../indexing/types";
import type { AgentToolContext } from "../agentToolContext";
import {
  findQueryMatchLine,
  handleSearchCode,
  normalizeCodeHostSearchQuery,
  indexedEntityFilenameQueries
} from "./searchCode";

const REPO = "github:CoopAI-Corp/plane";
const PARENT_LINE =
  '            raise ValidationError("Parent is not valid issue_id")';
const SERIALIZER_BODY = [
  "class IssueSerializer:",
  "    def validate_parent(self, value):",
  PARENT_LINE,
  "        return value"
].join("\n");

function emptySearch(): LocalSearchResult {
  return { source: "zoekt", hits: [], symbols: [], stale: false };
}

function stubIndex(searchImpl?: (repoId: string, query: string) => Promise<LocalSearchResult>): IndexBackend {
  return {
    isEnabledForRepo: async () => true,
    search: async (repoId: string, query: string) => (searchImpl ? searchImpl(repoId, query) : emptySearch())
  } as unknown as IndexBackend;
}

const tests: Array<[string, () => Promise<void> | void]> = [];
function test(name: string, fn: () => Promise<void> | void) {
  tests.push([name, fn]);
}

test("normalizeCodeHostSearchQuery strips outer quotes", () => {
  assert.equal(
    normalizeCodeHostSearchQuery('"Parent is not valid issue_id"'),
    "Parent is not valid issue_id"
  );
});

test("findQueryMatchLine finds Parent ValidationError line", () => {
  const match = findQueryMatchLine(SERIALIZER_BODY, "Parent is not valid issue_id");
  assert.ok(match);
  assert.equal(match!.lineNumber, 3);
  assert.ok(match!.content.includes("Parent is not valid"));
});

test("Lightning empty + codehost path + body enrich attaches reject line", async () => {
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => [{ path: "apps/api/plane/app/serializers/issue.py" }],
    readRemoteFile: async ({ path }) =>
      path.includes("serializers/issue.py")
        ? { path, content: SERIALIZER_BODY }
        : undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    hitCount: number;
    codeHostFallback?: boolean;
    source: string;
    hits: Array<{ fileName: string; content: string; lineNumber: number }>;
  };
  assert.equal(parsed.codeHostFallback, true);
  assert.equal(parsed.source, "fallback");
  assert.equal(parsed.hitCount, 1);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
  assert.ok(parsed.hits[0].content.includes("Parent is not valid"));
  assert.equal(parsed.hits[0].lineNumber, 3);
});

test("Lightning empty + codehost path + failed body still returns path for auto-read", async () => {
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => [{ path: "apps/api/plane/app/serializers/issue.py" }],
    readRemoteFile: async () => undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    hitCount: number;
    codeHostFallback?: boolean;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.equal(parsed.codeHostFallback, true);
  assert.equal(parsed.hitCount, 1);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
  assert.equal(parsed.hits[0].content, "");
});

test("symbol locate with empty Lightning does not call codehost", async () => {
  let codeHostCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => {
      codeHostCalls += 1;
      return [{ path: "should-not-run.py" }];
    }
  };
  const raw = await handleSearchCode(ctx, {
    query: "IssueCreateSerializer",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as { hitCount: number; codeHostFallback?: boolean };
  assert.equal(codeHostCalls, 0);
  assert.equal(parsed.hitCount, 0);
  assert.equal(parsed.codeHostFallback, undefined);
});

test("Lightning hits skip codehost even for reject query", async () => {
  let codeHostCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({
      source: "zoekt",
      stale: false,
      symbols: [],
      hits: [
        {
          fileName: "serializers/issue.py",
          lineNumber: 10,
          content: PARENT_LINE,
          score: 1
        }
      ]
    })),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => {
      codeHostCalls += 1;
      return [];
    }
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    hitCount: number;
    codeHostFallback?: boolean;
    codeHostFallbackAttempted?: boolean;
  };
  assert.equal(codeHostCalls, 0);
  assert.equal(parsed.hitCount, 1);
  assert.equal(parsed.codeHostFallback, undefined);
  assert.equal(parsed.codeHostFallbackAttempted, false);
});

test("UI text matching a reject query does not suppress codehost fallback", async () => {
  let codeHostCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({
      source: "embedding",
      stale: false,
      symbols: [],
      hits: [
        {
          fileName: "apps/web/components/parent-select.tsx",
          lineNumber: 10,
          content: 'const message = "Parent is not valid issue_id";',
          score: 1
        }
      ]
    })),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => {
      codeHostCalls += 1;
      return [{ path: "apps/api/plane/app/serializers/issue.py" }];
    },
    readRemoteFile: async ({ path }) =>
      path.includes("serializers/issue.py")
        ? { path, content: SERIALIZER_BODY }
        : undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    codeHostFallback?: boolean;
    codeHostFallbackAttempted?: boolean;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.equal(codeHostCalls, 1);
  assert.equal(parsed.codeHostFallbackAttempted, true);
  assert.equal(parsed.codeHostFallback, true);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
  assert.ok(parsed.hits[0].content.includes("Parent is not valid"));
});

test("a different field's server reject does not suppress codehost fallback", async () => {
  let codeHostCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({
      source: "zoekt",
      stale: false,
      symbols: [],
      hits: [
        {
          fileName: "apps/api/serializers/issue.py",
          lineNumber: 20,
          content: 'raise ValidationError("State is not valid")',
          score: 1
        }
      ]
    })),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => {
      codeHostCalls += 1;
      return [{ path: "apps/api/plane/app/serializers/issue.py" }];
    },
    readRemoteFile: async ({ path }) =>
      path.includes("serializers/issue.py")
        ? { path, content: SERIALIZER_BODY }
        : undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    codeHostFallback?: boolean;
    codeHostFallbackAttempted?: boolean;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.equal(codeHostCalls, 1);
  assert.equal(parsed.codeHostFallbackAttempted, true);
  assert.equal(parsed.codeHostFallback, true);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
  assert.ok(parsed.hits[0].content.includes("Parent is not valid"));
});

test("literal codehost query follows an empty phrase query", async () => {
  const hostQueries: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({
      source: "embedding",
      stale: false,
      symbols: [],
      hits: [
        {
          fileName: "apps/web/components/parent-select.tsx",
          lineNumber: 10,
          content: "parent issue_id",
          score: 1
        }
      ]
    })),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async ({ query }) => {
      hostQueries.push(query);
      return query.startsWith('"')
        ? []
        : [{ path: "apps/api/plane/app/serializers/issue.py" }];
    },
    readRemoteFile: async ({ path }) =>
      path.includes("serializers/issue.py")
        ? { path, content: SERIALIZER_BODY }
        : undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    codeHostFallback?: boolean;
    codeHostFallbackAttempted?: boolean;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.deepEqual(hostQueries, ['"Parent is not valid issue_id"', "Parent is not valid issue_id"]);
  assert.equal(parsed.codeHostFallbackAttempted, true);
  assert.equal(parsed.codeHostFallback, true);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
});

test("reject fallback uses a field token after phrase and literal misses", async () => {
  const hostQueries: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async ({ query }) => {
      hostQueries.push(query);
      return query === "issue_id" ? [{ path: "apps/api/plane/app/serializers/issue.py" }] : [];
    },
    readRemoteFile: async ({ path }) => ({ path, content: SERIALIZER_BODY })
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    codeHostFallbackStatus: string;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.deepEqual(hostQueries, [
    '"Parent is not valid issue_id"',
    "Parent is not valid issue_id",
    "issue_id"
  ]);
  assert.equal(parsed.codeHostFallbackStatus, "results");
  assert.equal(parsed.hits[0].fileName, "apps/api/plane/app/serializers/issue.py");
});

test("Lightning wrong hits for phrase query still trigger codehost fail-open", async () => {
  let codeHostCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({
      source: "zoekt",
      stale: false,
      symbols: [],
      hits: [
        {
          fileName: "apps/api/plane/utils/error_codes.py",
          lineNumber: 1,
          content: "VALIDATION_ERROR = 1",
          score: 1
        }
      ]
    })),
    resolveAbsolutePath: () => undefined,
    searchCodeHost: async () => {
      codeHostCalls += 1;
      return [{ path: "apps/api/plane/app/serializers/issue.py" }];
    },
    readRemoteFile: async ({ path }) =>
      path.includes("serializers/issue.py")
        ? { path, content: SERIALIZER_BODY }
        : undefined
  };
  const raw = await handleSearchCode(ctx, {
    query: "Parent is not valid issue_id",
    repoId: REPO
  });
  const parsed = JSON.parse(raw) as {
    hitCount: number;
    codeHostFallback?: boolean;
    hits: Array<{ fileName: string; content: string }>;
  };
  assert.equal(codeHostCalls, 1);
  assert.equal(parsed.codeHostFallback, true);
  assert.ok(parsed.hits[0].fileName.includes("serializers/issue.py"));
  assert.ok(parsed.hits[0].content.includes("Parent is not valid"));
});

test("cloud content search unsupported recovers through filename discovery and verifies remote body", async () => {
  const files: string[] = [];
  let hostCalls = 0;
  const legacyBackend = Object.assign(Object.create(CoopBackendClient.prototype), {
    authHeaders: async () => ({}),
    http: { get: async () => ({ data: { repoId: REPO, hits: [] } }) }
  }) as CoopBackendClient;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({ ...emptySearch(), source: "embedding", hits: [{ fileName: "web/parent.tsx", lineNumber: 1, content: "parent", score: 1 }] })),
    resolveAbsolutePath: () => undefined,
    researchQuery: "Where does the API reject a bad parent issue_id?",
    searchCodeHost: async () => {
      hostCalls++;
      return (await legacyBackend.fetchRepoSearch("https://api.coop-ai.dev", REPO, "parent", "preview", 8, "content")).hits;
    },
    findFiles: async ({ query }) => { files.push(query); return query === "issue." ? ["server/serializers/issue.rb"] : []; },
    readRemoteFile: async ({ path }) => ({ path, content: "def validate_parent(value)\n  raise ValidationError(\"Cannot set parent from another project.\")\nend" })
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "Parent is not valid issue_id" }));
  assert.equal(hostCalls, 1);
  assert.ok(files.includes("issue."));
  assert.equal(result.filenameFallbackStatus, "verified");
  assert.equal(result.hits[0].fileName, "server/serializers/issue.rb");
  assert.ok(result.hits[0].content.includes("Cannot set parent"));
});

test("a validate-prefixed definition lookup does not become a reject hunt", async () => {
  let filenameCalls = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => emptySearch()),
    resolveAbsolutePath: () => undefined,
    researchQuery: "Where is validateQuantumPlatypusSessionNonce defined? Show its actual implementation if it exists.",
    findFiles: async () => { filenameCalls++; return []; }
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "validate_quantum_platypus_session_nonce" }));
  assert.equal(filenameCalls, 0);
  assert.equal(result.hits.length, 0);
});

test("operation filenames recover signing after a neighboring PDF guard", async () => {
  const queries: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({ ...emptySearch(), hits: [{ fileName: "server/files/helpers.ts", lineNumber: 1, content: "if (envelope.status !== Status.PENDING) throw new Error('Download a partially signed PDF');", score: 1 }] })),
    resolveAbsolutePath: () => undefined,
    researchQuery: "A signer gets an error that the document must be pending for signing. Where does the server reject this request and what status check enforces it?",
    findFiles: async ({ query, excludeClientUi }) => { assert.equal(excludeClientUi, true); queries.push(query); return query === "sign" ? ["server/operations/sign-field.ts"] : []; },
    readRemoteFile: async ({ path }) => ({ path, content: "export const signField = async () => {\n if (document.status !== Status.PENDING) {\n throw new Error('Document must be pending for signing');\n }\n};" })
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "must be pending for signing" }));
  assert.equal(queries[0], "sign");
  assert.equal(queries.length, 1, "verified signing evidence stops further filename walks");
  assert.equal(result.filenameFallbackStatus, "verified");
  assert.equal(result.hits[0].fileName, "server/operations/sign-field.ts");
});

test("backend State lookup remotely opens declaration after UI-only index hits", async () => {
  const reads: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({ ...emptySearch(), hits: [{ fileName: "web/state.ts", lineNumber: 1, content: "type State = string", score: 1 }] })),
    resolveAbsolutePath: () => undefined,
    researchQuery: "Where do work-item states live in the backend?",
    findFiles: async ({ query }) => query === "state." ? [
      "server/api/serializers/state.py", "server/api/urls/state.py", "server/api/views/state.py",
      "server/app/serializers/state.py", "server/app/views/state.py", "server/models/state.go"
    ] : [],
    readRemoteFile: async ({ path }) => { reads.push(path); return { path, content: path === "server/models/state.go" ? "package models\ntype State struct {\n ID string\n}" : "class StateSerializer: pass" }; }
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "work item states" }));
  assert.equal(result.filenameFallbackStatus, "verified");
  assert.equal(result.hits[0].fileName, "server/models/state.go");
  assert.equal(result.hits[0].lineNumber, 2);
  assert.equal(reads[0], "server/models/state.go", "model declaration precedes similarly named API wrappers");
});

test("indexed entity filename hints recover a transition when the user vocabulary differs", async () => {
  const queries: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => ({ ...emptySearch(), hits: [
      ...Array.from({ length: 18 }, (_, index) => ({ fileName: `web/project-states/state-${index}.tsx`, lineNumber: 1, content: "state options", score: 1 })),
      { fileName: "packages/i18n/src/locales/en/workflow.json", lineNumber: 1, content: "transition", score: 0.8 },
      { fileName: "packages/i18n/src/locales/fr/workflow.json", lineNumber: 1, content: "transition", score: 0.7 },
      { fileName: "server/seeds/tickets.json", lineNumber: 1, content: "state_id", score: 0.5 }
    ] })),
    resolveAbsolutePath: () => undefined,
    researchQuery: "Where does the API reject a bad state transition?",
    findFiles: async ({ query }) => { queries.push(query); return query === "ticket." ? ["server/serializers/ticket.py"] : []; },
    readRemoteFile: async ({ path }) => ({ path, content: 'def validate(data):\n if data.get("state"):\n  raise ValidationError("State is not valid state_id")' })
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "work item state" }));
  assert.ok(queries.includes("ticket."));
  assert.ok(!queries.includes("workflow."), "locale JSON cannot become a backend entity hint");
  assert.ok(queries.indexOf("ticket.") < queries.indexOf("state.") || !queries.includes("state."), "backend entity hints precede field catalog discovery");
  assert.equal(result.filenameFallbackStatus, "verified");
  assert.equal(result.hits[0].fileName, "server/serializers/ticket.py");
});

test("semantic reject retrieval refines with the task instead of repeating a casing alias", async () => {
  const task = "Users cannot move a work item out of backlog. Where does the API reject the transition?";
  const queries: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async (_repo, query) => {
      queries.push(query);
      return { ...emptySearch(), source: "embedding", hits: query === task
        ? [{ fileName: "server/serializers/ticket.py", lineNumber: 8, content: 'if data.get("state"):\n raise ValidationError("State is not valid state_id")', score: 0.9 }]
        : [{ fileName: "web/state.ts", lineNumber: 1, content: "state options", score: 0.8 }] };
    }),
    resolveAbsolutePath: () => undefined,
    researchQuery: task
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "validate_state" }));
  assert.deepEqual(queries, ["validate_state", task]);
  assert.ok(result.hits.some((hit: { fileName: string }) => hit.fileName === "server/serializers/ticket.py"));
});

test("remotely disproven filename candidates do not get queued for another read", async () => {
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(async () => emptySearch()),
    resolveAbsolutePath: () => undefined,
    researchQuery: "What rejects a bad state transition?",
    findFiles: async () => ["server/serializers/state.py"],
    readRemoteFile: async ({ path }) => ({ path, content: 'def validate(data):\n if data.get("group"):\n  raise ValidationError("Invalid state group")' })
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "validate_state" }));
  assert.equal(result.hits.length, 0);
});

test("retrieval diagnostics record criteria and candidate rejection without source bodies", async () => {
  const events: Record<string, unknown>[] = [];
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(),
    resolveAbsolutePath: () => undefined,
    researchQuery: "A client sent a parent that isn’t in this project — the API returns an error. Where does the API reject a bad parent_id?",
    onDiagnostic: (event) => events.push(event),
    findFiles: async () => ["server/validation.py"],
    readRemoteFile: async ({ path }) => ({ path, content: "REMOTE_BODY_SENTINEL: no requested guard" })
  };
  await handleSearchCode(ctx, { repoId: REPO, query: "validate_parent" });
  assert.ok(events.some((event) => event.stage === "index-search" && event.query === "validate_parent" && event.hitCount === 0));
  assert.ok(events.some((event) => event.stage === "filename-criteria" && Array.isArray(event.criteria)));
  assert.ok(events.some((event) => event.stage === "candidate" && event.path === "server/validation.py" && event.status === "ruled-out"));
  assert.ok(!JSON.stringify(events).includes("REMOTE_BODY_SENTINEL"));
});

test("equivalent hunts reuse results while both lexical identifier forms remain searchable", async () => {
  const searches: string[] = [];
  const ctx: AgentToolContext = {
    indexBackend: { isEnabledForRepo: async () => true, search: async (_repo: string, pattern: string) => {
      searches.push(pattern); return emptySearch();
    } } as unknown as IndexBackend,
    resolveAbsolutePath: () => undefined, researchQuery: "Where is validateWidgetNonce defined?"
  };
  const first = await handleSearchCode(ctx, { repoId: REPO, query: "validateWidgetNonce" });
  assert.deepEqual(searches, ["validateWidgetNonce", "validate_widget_nonce"]);
  assert.equal(await handleSearchCode(ctx, { repoId: REPO, query: ' "validate_widget_nonce" ' }), first);
  assert.equal(searches.length, 2);
  await handleSearchCode({ ...ctx }, { repoId: REPO, query: "validateWidgetNonce" });
  assert.equal(searches.length, 4, "A new turn cannot reuse the prior turn's search results");
});

test("ruled-out remote candidates retain status without duplicate body work across refinements", async () => {
  let reads = 0;
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(), resolveAbsolutePath: () => undefined,
    researchQuery: "Where does the API reject a bad parent_id?",
    findFiles: async () => ["server/serializers/unrelated.py"],
    readRemoteFile: async ({ path }) => { reads++; return { path, content: "def unrelated(data):\n    return data" }; }
  };
  await handleSearchCode(ctx, { repoId: REPO, query: "validate_parent" });
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "parent_id project" }));
  assert.equal(reads, 1);
  assert.ok(result.candidateLedger.some((candidate: { path: string; status: string }) => candidate.path === "server/serializers/unrelated.py" && candidate.status === "ruled_out"));
});

test("filename discovery preserves a complete remotely verified filtering method", async () => {
  const body = ['class TicketSerializer:', '    def validate(self, data):',
    '        data["assignees"] = Member.objects.filter(id__in=data["assignees"]).values_list("id", flat=True)',
    '        return data'].join("\n");
  const ctx: AgentToolContext = {
    indexBackend: stubIndex(), resolveAbsolutePath: () => undefined,
    researchQuery: "A client sent an assignee outside the team. Where does the API reject a bad assignee_id?",
    findFiles: async () => ["server/serializers/ticket.py"], readRemoteFile: async ({ path }) => ({ path, content: body })
  };
  const result = JSON.parse(await handleSearchCode(ctx, { repoId: REPO, query: "validate_assignee" }));
  assert.equal(result.hits[0]?.content, body);
  assert.ok(result.candidateLedger.some((candidate: { status: string }) => candidate.status === "verified"));
});

test("indexed entity hints retain a domain directory and omit the shared namespace", async () => {
  assert.deepEqual(indexedEntityFilenameQueries([
    { fileName: "customer_namespace/web/items/components/a.ts" },
    { fileName: "customer_namespace/web/items/components/b.ts" }
  ]), ["item."]);
});

async function main() {
  for (const [name, fn] of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
}

void main();
