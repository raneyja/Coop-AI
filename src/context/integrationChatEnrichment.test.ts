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
    await flushMicrotasks();
    assert.equal(started.includes("jira"), true);
    assert.equal(started.includes("google-docs"), true);
    assert.equal(started.includes("slack"), false);
    assert.equal(started.includes("teams"), false);

    googleDocsGate.resolve({ documents: [{ title: "Google Doc" }] });
    await flushMicrotasks();
    assert.equal(started.includes("slack"), false);
    assert.equal(started.includes("teams"), false);

    jiraGate.resolve({ issues: [{ key: "COOP-12" }] });
    await flushMicrotasks();
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

test("trace-decision always skips title-only Notion/Docs (even without a linked PR)", async () => {
  const localFileResolverPath = require.resolve("./localFileResolver");
  const originalLocalFileResolverCache = require.cache[localFileResolverPath];
  const integrationChatEnrichmentPath = require.resolve("./integrationChatEnrichment");
  const started: string[] = [];

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
      id: "ctx-trace",
      type: "decision_history",
      params: { quickAction: "trace-decision", file: "src/server/example.ts" },
      intent: { context: { queryText: "why exists" } }
    } as ContextFetchRequest;

    const result = {
      requestId: "ctx-trace",
      type: "decision_history",
      data: {
        timeline: {
          file: "src/server/example.ts",
          completeness: "minimal",
          originalCommit: {
            sha: "abc123456789",
            author: "alice",
            date: "2024-01-01",
            message: "Add retry helper"
          },
          alternatives: [],
          chronology: [],
          warnings: ["No linked pull request found for the introducing commit."]
        }
      },
      fetchedAt: new Date()
    } as ContextFetchResult;

    const enriched = await enrichChatContextWithIntegrations({
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
          return { pages: [{ title: "ADR", excerpt: "Retries" }] } as never;
        },
        shouldFetchNotionContext: () => true,
        fetchNotionSearchContext: async () => {
          started.push("notion");
          return { pages: [{ title: "Notion page" }] } as never;
        },
        shouldFetchJiraContext: () => true,
        fetchJiraSearchContext: async () => {
          started.push("jira");
          return { issues: [] } as never;
        },
        shouldFetchGoogleDocsContext: () => true,
        fetchGoogleDocsSearchContext: async () => {
          started.push("google-docs");
          return { documents: [{ title: "Doc" }] } as never;
        },
        shouldFetchSlackContext: () => true,
        fetchSlackSearchContext: async () => {
          started.push("slack");
          return { messages: [] } as never;
        },
        shouldFetchTeamsContext: () => false,
        shouldFetchCodeHostContext: () => false
      }
    });

    const data = enriched.data as Record<string, unknown>;
    assert.ok(started.includes("confluence"));
    assert.ok(started.includes("jira"));
    assert.ok(started.includes("slack"));
    assert.equal(started.includes("notion"), false);
    assert.equal(started.includes("google-docs"), false);
    assert.ok(data.confluenceSearch);
    assert.equal(data.notionSearch, undefined);
    assert.equal(data.googleDocsSearch, undefined);
  } finally {
    delete require.cache[integrationChatEnrichmentPath];
    if (originalLocalFileResolverCache) {
      require.cache[localFileResolverPath] = originalLocalFileResolverCache;
    } else {
      delete require.cache[localFileResolverPath];
    }
  }
});
