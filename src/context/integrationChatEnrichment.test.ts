import assert from "node:assert/strict";
import test from "node:test";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Extra async layers (tool activity wrappers) need a few more turns of the queue. */
async function flushUntil(predicate: () => boolean, maxTurns = 20): Promise<void> {
  for (let i = 0; i < maxTurns; i += 1) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
  }
}

test("enrichChatContextWithIntegrations runs staged parallel integration batches", async () => {
  const localFileResolverPath = require.resolve("./localFileResolver");
  const originalLocalFileResolverCache = require.cache[localFileResolverPath];
  const integrationChatEnrichmentPath = require.resolve("./integrationChatEnrichment");

  const started: string[] = [];
  const confluenceGate = deferred<{ pages: Array<{ title: string; excerpt: string }> }>();
  const notionGate = deferred<{ pages: Array<{ title: string }> }>();
  const jiraGate = deferred<{ issues: Array<{ key: string }> }>();
  const googleDocsGate = deferred<{ documents: Array<{ title: string }> }>();
  const slackGate = deferred<{ messages: Array<{ text: string }> }>();
  const teamsGate = deferred<{ messages: Array<{ text: string }> }>();

  let jiraCrossToolText: string[] | undefined;
  let googleDocsExtraTerms: string[] | undefined;
  let slackJiraIssueKeys: string[] | undefined;
  let slackCrossToolText: string[] | undefined;
  let teamsJiraIssueKeys: string[] | undefined;

  try {
    require.cache[localFileResolverPath] = {
      id: localFileResolverPath,
      filename: localFileResolverPath,
      loaded: true,
      exports: {
        resolveLocalAbsolutePath: () => undefined
      }
    } as NodeJS.Module;

    delete require.cache[integrationChatEnrichmentPath];
    const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");

    const request = {
      id: "ctx-1",
      type: "chat_context",
      params: {
        quickAction: "knowledge-gaps",
        file: "src/server/example.ts"
      },
      intent: {
        context: {
          queryText: "How does COOP-12 relate to docs?"
        }
      }
    } as ContextFetchRequest;

    const result = {
      requestId: "ctx-1",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult;

    const enrichPromise = enrichChatContextWithIntegrations({
      result,
      request,
      secrets: { getCredentials: async () => ({}) } as never,
      codeHostRouter: {} as never,
      owner: "acme",
      repo: "coop-ai",
      codeHostConnected: false,
      deps: {
        shouldFetchConfluenceContext: () => true,
        fetchConfluenceSearchContext: async () => {
          started.push("confluence");
          return confluenceGate.promise;
        },
        shouldFetchNotionContext: () => true,
        fetchNotionSearchContext: async () => {
          started.push("notion");
          return notionGate.promise;
        },
        shouldFetchJiraContext: () => true,
        fetchJiraSearchContext: async (options) => {
          started.push("jira");
          jiraCrossToolText = options.crossToolText;
          return jiraGate.promise;
        },
        shouldFetchSlackContext: () => true,
        fetchSlackSearchContext: async (options) => {
          started.push("slack");
          slackJiraIssueKeys = options.jiraIssueKeys;
          slackCrossToolText = options.crossToolText;
          return slackGate.promise;
        },
        shouldFetchTeamsContext: () => true,
        fetchTeamsSearchContext: async (options) => {
          started.push("teams");
          teamsJiraIssueKeys = options.jiraIssueKeys;
          return teamsGate.promise;
        },
        shouldFetchGoogleDocsContext: () => true,
        fetchGoogleDocsSearchContext: async (options) => {
          started.push("google-docs");
          googleDocsExtraTerms = options.extraTerms;
          return googleDocsGate.promise;
        },
        shouldFetchCodeHostContext: () => false
      }
    });

    await flushMicrotasks();
    assert.equal(started.includes("confluence"), true);
    assert.equal(started.includes("notion"), true);
    assert.equal(started.includes("jira"), false);
    assert.equal(started.includes("google-docs"), false);
    assert.equal(started.includes("slack"), false);
    assert.equal(started.includes("teams"), false);

    notionGate.resolve({ pages: [{ title: "Notion Decision Notes" }] });
    await flushMicrotasks();
    assert.equal(started.includes("jira"), false);
    assert.equal(started.includes("google-docs"), false);

    confluenceGate.resolve({
      pages: [{ title: "Confluence Architecture", excerpt: "COOP-12 acceptance criteria" }]
    });
    await flushUntil(() => started.includes("jira") && started.includes("google-docs"));
    assert.equal(started.includes("jira"), true);
    assert.equal(started.includes("google-docs"), true);
    assert.equal(started.includes("slack"), false);
    assert.equal(started.includes("teams"), false);

    googleDocsGate.resolve({ documents: [{ title: "Google Doc" }] });
    await flushMicrotasks();
    assert.equal(started.includes("slack"), false);
    assert.equal(started.includes("teams"), false);

    jiraGate.resolve({ issues: [{ key: "COOP-12" }] });
    await flushUntil(() => started.includes("slack") && started.includes("teams"));
    assert.equal(started.includes("slack"), true);
    assert.equal(started.includes("teams"), true);

    slackGate.resolve({ messages: [{ text: "Slack thread" }] });
    teamsGate.resolve({ messages: [{ text: "Teams thread" }] });

    const enriched = await enrichPromise;
    const data = enriched.data as Record<string, unknown>;
    assert.ok(data.confluenceSearch);
    assert.ok(data.notionSearch);
    assert.ok(data.jiraSearch);
    assert.ok(data.googleDocsSearch);
    assert.ok(data.slackSearch);
    assert.ok(data.teamsSearch);

    assert.deepEqual(jiraCrossToolText, [
      "Confluence Architecture",
      "COOP-12 acceptance criteria",
      "Notion Decision Notes"
    ]);
    assert.equal(googleDocsExtraTerms?.includes("Confluence Architecture"), true);
    assert.equal(googleDocsExtraTerms?.includes("Notion Decision Notes"), true);
    assert.deepEqual(slackJiraIssueKeys, ["COOP-12"]);
    assert.deepEqual(teamsJiraIssueKeys, ["COOP-12"]);
    assert.deepEqual(slackCrossToolText, jiraCrossToolText);
  } finally {
    delete require.cache[integrationChatEnrichmentPath];
    if (originalLocalFileResolverCache) {
      require.cache[localFileResolverPath] = originalLocalFileResolverCache;
    } else {
      delete require.cache[localFileResolverPath];
    }
  }
});

test("enrichChatContextWithIntegrations returns partial results when budget elapses", async () => {
  const localFileResolverPath = require.resolve("./localFileResolver");
  const originalLocalFileResolverCache = require.cache[localFileResolverPath];
  const integrationChatEnrichmentPath = require.resolve("./integrationChatEnrichment");

  try {
    require.cache[localFileResolverPath] = {
      id: localFileResolverPath,
      filename: localFileResolverPath,
      loaded: true,
      exports: {
        resolveLocalAbsolutePath: () => undefined
      }
    } as NodeJS.Module;

    delete require.cache[integrationChatEnrichmentPath];
    const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");

    const request = {
      id: "ctx-1",
      type: "chat_context",
      params: { quickAction: "understand-repo", file: "src/server/example.ts" },
      intent: { context: { queryText: "overview" } }
    } as ContextFetchRequest;

    const result = {
      requestId: "ctx-1",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult;

    const startedAt = Date.now();
    const enriched = await enrichChatContextWithIntegrations({
      result,
      request,
      secrets: { getCredentials: async () => ({}) } as never,
      codeHostRouter: {} as never,
      owner: "acme",
      repo: "coop-ai",
      codeHostConnected: false,
      budgetMs: 40,
      deps: {
        shouldFetchConfluenceContext: () => true,
        fetchConfluenceSearchContext: async () => ({ pages: [{ title: "Fast Confluence" }] }) as never,
        shouldFetchNotionContext: () => true,
        fetchNotionSearchContext: async () => ({ pages: [{ title: "Fast Notion" }] }) as never,
        // Jira hangs forever — it must be dropped once the budget elapses.
        shouldFetchJiraContext: () => true,
        fetchJiraSearchContext: () => new Promise(() => undefined) as never,
        shouldFetchGoogleDocsContext: () => true,
        fetchGoogleDocsSearchContext: () => new Promise(() => undefined) as never,
        shouldFetchSlackContext: () => true,
        fetchSlackSearchContext: () => new Promise(() => undefined) as never,
        shouldFetchTeamsContext: () => true,
        fetchTeamsSearchContext: () => new Promise(() => undefined) as never,
        shouldFetchCodeHostContext: () => false
      }
    });
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 1000, `expected budget to bound latency, took ${elapsed}ms`);
    const data = enriched.data as Record<string, unknown>;
    // Stage 1 (Confluence + Notion) resolves immediately and is included.
    assert.ok(data.confluenceSearch);
    assert.ok(data.notionSearch);
    // Stage 2+ tools hang and are dropped by the budget.
    assert.equal(data.jiraSearch, undefined);
    assert.equal(data.slackSearch, undefined);
  } finally {
    delete require.cache[integrationChatEnrichmentPath];
    if (originalLocalFileResolverCache) {
      require.cache[localFileResolverPath] = originalLocalFileResolverCache;
    } else {
      delete require.cache[localFileResolverPath];
    }
  }
});

test("onToolActivity emits query labels and hit detail, not generic theater", async () => {
  const localFileResolverPath = require.resolve("./localFileResolver");
  const originalLocalFileResolverCache = require.cache[localFileResolverPath];
  const integrationChatEnrichmentPath = require.resolve("./integrationChatEnrichment");

  try {
    require.cache[localFileResolverPath] = {
      id: localFileResolverPath,
      filename: localFileResolverPath,
      loaded: true,
      exports: {
        resolveLocalAbsolutePath: () => undefined
      }
    } as NodeJS.Module;

    delete require.cache[integrationChatEnrichmentPath];
    const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");

    const events: Array<{ phase: string; label: string; detail?: string }> = [];
    await enrichChatContextWithIntegrations({
      result: {
        requestId: "ctx-1",
        type: "chat_context",
        data: {},
        fetchedAt: new Date()
      } as ContextFetchResult,
      request: {
        id: "ctx-1",
        type: "chat_context",
        params: { quickAction: "understand-repo" },
        intent: { context: { queryText: "overview" } }
      } as ContextFetchRequest,
      secrets: { getCredentials: async () => ({}) } as never,
      codeHostRouter: {} as never,
      owner: "CoopAI-Corp",
      repo: "plane",
      codeHostConnected: false,
      onToolActivity: (event) => {
        events.push({ phase: event.phase, label: event.label, detail: event.detail });
      },
      deps: {
        shouldFetchConfluenceContext: () => true,
        fetchConfluenceSearchContext: async () =>
          ({ pages: [{ title: "Plane architecture" }, { title: "Setup" }] }) as never,
        shouldFetchNotionContext: () => false,
        fetchNotionSearchContext: async () => ({ pages: [] }) as never,
        shouldFetchJiraContext: () => false,
        fetchJiraSearchContext: async () => ({ issues: [] }) as never,
        shouldFetchSlackContext: () => false,
        fetchSlackSearchContext: async () => ({ messages: [] }) as never,
        shouldFetchTeamsContext: () => false,
        fetchTeamsSearchContext: async () => ({ messages: [] }) as never,
        shouldFetchGoogleDocsContext: () => false,
        fetchGoogleDocsSearchContext: async () => ({ documents: [] }) as never,
        shouldFetchCodeHostContext: () => false
      }
    });

    const start = events.find((event) => event.phase === "start");
    const done = events.find((event) => event.phase === "done");
    assert.equal(start?.label, "Searching Confluence for `plane`");
    assert.equal(done?.label, "Searched Confluence for `plane`");
    assert.equal(done?.detail, "Plane architecture\nSetup");
    assert.equal(events.some((event) => /Searching Confluence pages/.test(event.label)), false);
  } finally {
    delete require.cache[integrationChatEnrichmentPath];
    if (originalLocalFileResolverCache) {
      require.cache[localFileResolverPath] = originalLocalFileResolverCache;
    } else {
      delete require.cache[localFileResolverPath];
    }
  }
});

test("job-scoped providers start in parallel with capability-specific terms", async () => {
  const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");
  const gates = new Map<string, Deferred<unknown>>();
  const args = new Map<string, Record<string, unknown>>();
  const started: string[] = [];
  const gateFor = (provider: string): Deferred<unknown> => {
    const gate = deferred<unknown>();
    gates.set(provider, gate);
    return gate;
  };
  const fetchFor =
    (provider: string) =>
    async (options: Record<string, unknown>): Promise<unknown> => {
      started.push(provider);
      args.set(provider, options);
      return gateFor(provider).promise;
    };

  const promise = enrichChatContextWithIntegrations({
    result: {
      requestId: "jobs",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult,
    request: {
      id: "jobs",
      type: "chat_context",
      params: { fetchIntegrations: ["jira", "slack", "teams", "confluence", "notion", "google-docs"] },
      intent: { context: { queryText: "compound ask" } }
    } as ContextFetchRequest,
    secrets: { getCredentials: async () => ({}) } as never,
    codeHostRouter: {} as never,
    owner: "acme",
    repo: "app",
    codeHostProvider: "gitlab",
    codeHostConnected: true,
    integrations: {
      jira: true,
      slack: true,
      teams: true,
      confluence: true,
      notion: true,
      googleDocs: true
    },
    jobs: [
      { capability: "decision", terms: ["sql-injection"] },
      { capability: "docs", terms: ["rollback runbook"] },
      { capability: "code-host", terms: ["PR #53"] }
    ],
    deps: {
      shouldFetchConfluenceContext: () => true,
      fetchConfluenceSearchContext: fetchFor("confluence") as never,
      shouldFetchNotionContext: () => true,
      fetchNotionSearchContext: fetchFor("notion") as never,
      shouldFetchJiraContext: () => true,
      fetchJiraSearchContext: fetchFor("jira") as never,
      shouldFetchSlackContext: () => true,
      fetchSlackSearchContext: fetchFor("slack") as never,
      shouldFetchTeamsContext: () => true,
      fetchTeamsSearchContext: fetchFor("teams") as never,
      shouldFetchGoogleDocsContext: () => true,
      fetchGoogleDocsSearchContext: fetchFor("google-docs") as never,
      shouldFetchCodeHostContext: () => false,
      fetchCodeHostSearchContext: fetchFor("code-host") as never
    }
  });

  await flushUntil(() => started.length === 7);
  assert.deepEqual(new Set(started), new Set([
    "confluence",
    "notion",
    "jira",
    "google-docs",
    "slack",
    "teams",
    "code-host"
  ]));
  assert.deepEqual(args.get("jira")?.extraTerms, ["sql-injection"]);
  assert.deepEqual(args.get("slack")?.extraTerms, ["sql-injection"]);
  assert.deepEqual(args.get("teams")?.extraTerms, ["sql-injection"]);
  assert.deepEqual(args.get("notion")?.extraTerms, ["rollback runbook"]);
  assert.deepEqual(args.get("google-docs")?.extraTerms, ["rollback runbook"]);
  assert.deepEqual(args.get("confluence")?.extraTerms, ["sql-injection", "rollback runbook"]);
  assert.equal(args.get("code-host")?.queryText, "PR #53");
  assert.equal(args.get("code-host")?.provider, "gitlab");
  for (const gate of gates.values()) gate.resolve({});
  await promise;
});

test("job-scoped timeout never reports late completion", async () => {
  const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");
  const jiraGate = deferred<{ issues: [] }>();
  const events: Array<{ phase: string; label: string; detail?: string }> = [];
  const enriched = await enrichChatContextWithIntegrations({
    result: {
      requestId: "timeout",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult,
    request: {
      id: "timeout",
      type: "chat_context",
      params: { fetchIntegrations: ["jira"] },
      intent: { context: { queryText: "compound ask" } }
    } as ContextFetchRequest,
    secrets: { getCredentials: async () => ({}) } as never,
    codeHostRouter: {} as never,
    integrations: { jira: true },
    jobs: [{ capability: "decision", terms: ["auth rollback"] }],
    budgetMs: 15,
    onToolActivity: (event) => events.push(event),
    deps: {
      shouldFetchConfluenceContext: () => false,
      shouldFetchNotionContext: () => false,
      shouldFetchJiraContext: () => true,
      fetchJiraSearchContext: () => jiraGate.promise as never,
      shouldFetchSlackContext: () => false,
      shouldFetchTeamsContext: () => false,
      shouldFetchGoogleDocsContext: () => false,
      shouldFetchCodeHostContext: () => false
    }
  });

  assert.deepEqual(events.map((event) => event.phase), ["start", "timed-out"]);
  assert.match(events[1]?.label ?? "", /^Timed out searching Jira/);
  assert.match(events[1]?.detail ?? "", /did not finish/);
  assert.deepEqual((enriched.data as Record<string, unknown>).jiraSearch, {
    error: "Search timed out before context gathering ended."
  });

  jiraGate.resolve({ issues: [] });
  await flushMicrotasks();
  assert.deepEqual(events.map((event) => event.phase), ["start", "timed-out"]);
  assert.equal(events.some((event) => /^Searched Jira/.test(event.label)), false);
});

test("job-scoped provider without a matching job does not fall back to repo terms", async () => {
  const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");
  let jiraCalls = 0;
  await enrichChatContextWithIntegrations({
    result: {
      requestId: "no-fallback",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult,
    request: {
      id: "no-fallback",
      type: "chat_context",
      params: { fetchIntegrations: ["jira"] },
      intent: { context: { queryText: "where is requireAuth implemented?" } }
    } as ContextFetchRequest,
    secrets: { getCredentials: async () => ({}) } as never,
    codeHostRouter: {} as never,
    owner: "acme",
    repo: "app",
    integrations: { jira: true },
    jobs: [{ capability: "locate", terms: ["requireAuth"] }],
    deps: {
      shouldFetchConfluenceContext: () => false,
      shouldFetchNotionContext: () => false,
      shouldFetchJiraContext: () => true,
      fetchJiraSearchContext: async () => {
        jiraCalls += 1;
        return { issues: [] } as never;
      },
      shouldFetchSlackContext: () => false,
      shouldFetchTeamsContext: () => false,
      shouldFetchGoogleDocsContext: () => false,
      shouldFetchCodeHostContext: () => false
    }
  });
  assert.equal(jiraCalls, 0);
});

test("expired job budget skips fetch instead of claiming searched-empty", async () => {
  const { enrichChatContextWithIntegrations } = require("./integrationChatEnrichment") as typeof import("./integrationChatEnrichment");
  let jiraCalls = 0;
  const phases: string[] = [];
  const enriched = await enrichChatContextWithIntegrations({
    result: {
      requestId: "expired",
      type: "chat_context",
      data: {},
      fetchedAt: new Date()
    } as ContextFetchResult,
    request: {
      id: "expired",
      type: "chat_context",
      params: { fetchIntegrations: ["jira"] },
      intent: { context: { queryText: "decision" } }
    } as ContextFetchRequest,
    secrets: { getCredentials: async () => ({}) } as never,
    codeHostRouter: {} as never,
    integrations: { jira: true },
    jobs: [{ capability: "decision", terms: ["auth rollback"] }],
    budgetMs: 0,
    onToolActivity: (event) => phases.push(event.phase),
    deps: {
      shouldFetchConfluenceContext: () => false,
      shouldFetchNotionContext: () => false,
      shouldFetchJiraContext: () => true,
      fetchJiraSearchContext: async () => {
        jiraCalls += 1;
        return { issues: [] } as never;
      },
      shouldFetchSlackContext: () => false,
      shouldFetchTeamsContext: () => false,
      shouldFetchGoogleDocsContext: () => false,
      shouldFetchCodeHostContext: () => false
    }
  });
  assert.equal(jiraCalls, 0);
  assert.deepEqual(phases, ["skipped"]);
  assert.deepEqual((enriched.data as Record<string, unknown>).jiraSearch, {
    error: "Search was skipped because context gathering had ended."
  });
});
