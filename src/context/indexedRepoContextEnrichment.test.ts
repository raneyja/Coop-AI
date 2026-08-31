import assert from "node:assert/strict";
import {
  enrichContextWithIndexedRepo,
  indexedRepoEvidenceWants,
  understandRepoEmptyEvidenceMessage,
  understandRepoMissingEntryBodiesMessage,
  hasUnderstandRepoEntryBodies
} from "./indexedRepoContextEnrichment";
import type { ContextFetchRequest } from "./requestBatcher";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("enrichContextWithIndexedRepo attaches remote file without inventory for blast-radius", async () => {
    const request: ContextFetchRequest = {
      id: "test:file_metadata:0",
      type: "file_metadata",
      params: {
        repoId: "github:acme/app",
        owner: "acme",
        repo: "app",
        branch: "main",
        file: "README.md",
        fileSource: "remote",
        quickAction: "blast-radius"
      },
      intent: {
        id: "evt-1",
        intent: "quick_action_clicked" as const,
        timestamp: new Date(),
        costEstimate: "expensive" as const,
        context: {
          repoId: "github:acme/app",
          owner: "acme",
          repo: "app",
          branch: "main",
          buttonClicked: "blast-radius"
        }
      },
      cost: "expensive",
      createdAt: new Date()
    };

    const result = await enrichContextWithIndexedRepo({
      deps: {
        api: {
          fetchRepoManifest: async () => ({
            repoId: "github:acme/app",
            files: [{ path: "README.md", symbols: [] }, { path: "package.json", symbols: [] }],
            fileCount: 2,
            lastCrawledAt: "2026-01-01T00:00:00.000Z"
          }),
          fetchRepoInventoryViaCloud: async () => ({
            fileCount: 2,
            lineCount: 100,
            indexedAt: "2026-01-01T00:00:00.000Z",
            branch: "main"
          }),
          getBackendClient: () => ({
            fetchRepoFile: async () => ({
              path: "README.md",
              content: "# App\n",
              encoding: "utf-8"
            })
          })
        } as never,
        apiBaseUrl: "https://api.coop-ai.dev",
        codeHostRouter: {
          getRepositoryTree: async () => ({
            path: "",
            branch: "main",
            entries: [
              { name: "README.md", path: "README.md", type: "file" as const },
              { name: "src", path: "src", type: "dir" as const }
            ]
          })
        } as never
      },
      target: {
        repoId: "github:acme/app",
        owner: "acme",
        repo: "app",
        branch: "main",
        provider: "github"
      },
      request,
      result: {
        requestId: request.id,
        type: request.type,
        data: { file: "README.md" },
        fetchedAt: new Date()
      },
      budgetMs: 5_000
    });

    const data = result.data as Record<string, unknown>;
    assert.equal(data.indexedWorkspaceAttached, true);
    assert.equal(data.manifest, undefined);
    assert.equal(data.treeOverview, undefined);
    assert.equal(data.repoInventory, undefined);
    const localFiles = data.localFiles as { files?: Array<{ path: string }> };
    assert.equal(localFiles?.files?.[0]?.path, "README.md");
  });

  await test("ping / greeting does not want inventory or tree", async () => {
    const ping: ContextFetchRequest = {
      id: "test:ping",
      type: "chat_context",
      params: { repoId: "github:acme/app", owner: "acme", repo: "app", branch: "main" },
      intent: {
        id: "evt-ping",
        intent: "manual_chat_submit" as const,
        timestamp: new Date(),
        costEstimate: "cheap" as const,
        context: { queryText: "test" }
      },
      cost: "cheap",
      createdAt: new Date()
    };
    assert.deepEqual(indexedRepoEvidenceWants(ping), {
      inventory: false,
      tree: false,
      manifest: false,
      entryFiles: false
    });
    const hi = { ...ping, intent: { ...ping.intent, context: { queryText: "hi" } } };
    assert.equal(indexedRepoEvidenceWants(hi).inventory, false);
    assert.equal(indexedRepoEvidenceWants(hi).tree, false);
  });

  await test("file-count question wants inventory not tree", async () => {
    const request: ContextFetchRequest = {
      id: "test:count",
      type: "chat_context",
      params: { repoId: "github:acme/app", owner: "acme", repo: "app", branch: "main" },
      intent: {
        id: "evt-count",
        intent: "manual_chat_submit" as const,
        timestamp: new Date(),
        costEstimate: "cheap" as const,
        context: { queryText: "how many files are inside of this repo?" }
      },
      cost: "cheap",
      createdAt: new Date()
    };
    const wants = indexedRepoEvidenceWants(request);
    assert.equal(wants.inventory, true);
    assert.equal(wants.tree, false);
    assert.equal(wants.manifest, false);
    assert.equal(wants.entryFiles, false);

    const result = await enrichContextWithIndexedRepo({
      deps: {
        api: {
          fetchRepoManifest: async () => ({
            repoId: "github:acme/app",
            files: [],
            fileCount: 0
          }),
          fetchRepoInventoryViaCloud: async () => ({
            fileCount: 10,
            lineCount: 2930,
            indexedAt: "2026-01-01T00:00:00.000Z",
            branch: "main"
          }),
          getBackendClient: () => ({
            fetchRepoFile: async () => undefined
          })
        } as never,
        apiBaseUrl: "https://api.coop-ai.dev",
        codeHostRouter: {
          getRepositoryTree: async () => ({
            path: "",
            branch: "main",
            entries: [{ name: "app", path: "app", type: "dir" as const }]
          })
        } as never
      },
      target: {
        repoId: "github:acme/app",
        owner: "acme",
        repo: "app",
        branch: "main",
        provider: "github"
      },
      request,
      result: {
        requestId: request.id,
        type: request.type,
        data: {},
        fetchedAt: new Date()
      },
      budgetMs: 5_000
    });

    const data = result.data as Record<string, unknown>;
    assert.equal((data.repoInventory as { fileCount?: number }).fileCount, 10);
    assert.equal(data.treeOverview, undefined);
  });

  await test("plain chat ping does not attach inventory or tree", async () => {
    const request: ContextFetchRequest = {
      id: "test:plain-ping",
      type: "chat_context",
      params: { repoId: "github:coopai-group/InspectIQ", owner: "coopai-group", repo: "InspectIQ", branch: "main" },
      intent: {
        id: "evt-plain-ping",
        intent: "manual_chat_submit" as const,
        timestamp: new Date(),
        costEstimate: "cheap" as const,
        context: { queryText: "test" }
      },
      cost: "cheap",
      createdAt: new Date()
    };

    const result = await enrichContextWithIndexedRepo({
      deps: {
        api: {
          fetchRepoManifest: async () => ({
            repoId: "github:coopai-group/InspectIQ",
            files: [{ path: "README.md", symbols: [] }],
            fileCount: 10
          }),
          fetchRepoInventoryViaCloud: async () => ({
            fileCount: 10,
            lineCount: 2930,
            indexedAt: "2026-01-01T00:00:00.000Z",
            branch: "main"
          }),
          getBackendClient: () => ({
            fetchRepoFile: async () => ({
              path: "README.md",
              content: "# InspectIQ\n",
              encoding: "utf-8"
            })
          })
        } as never,
        apiBaseUrl: "https://api.coop-ai.dev",
        codeHostRouter: {
          getRepositoryTree: async () => ({
            path: "",
            branch: "main",
            entries: [
              { name: "app", path: "app", type: "dir" as const },
              { name: "public", path: "public", type: "dir" as const }
            ]
          })
        } as never
      },
      target: {
        repoId: "github:coopai-group/InspectIQ",
        owner: "coopai-group",
        repo: "InspectIQ",
        branch: "main",
        provider: "github"
      },
      request,
      result: {
        requestId: request.id,
        type: request.type,
        data: {},
        fetchedAt: new Date()
      },
      budgetMs: 5_000
    });

    const data = result.data as Record<string, unknown>;
    assert.equal(data.indexedWorkspaceAttached, true);
    assert.equal(data.repoInventory, undefined);
    assert.equal(data.treeOverview, undefined);
    assert.equal(data.manifest, undefined);
    assert.equal(data.entryFiles, undefined);
  });

  await test("budget timeout keeps inventory instead of discarding to empty shell", async () => {
    const request: ContextFetchRequest = {
      id: "test:understand:0",
      type: "file_metadata",
      params: {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        quickAction: "understand-repo"
      },
      intent: {
        id: "evt-2",
        intent: "quick_action_clicked" as const,
        timestamp: new Date(),
        costEstimate: "expensive" as const,
        context: {
          repoId: "github:CoopAI-Corp/plane",
          owner: "CoopAI-Corp",
          repo: "plane",
          branch: "main",
          buttonClicked: "understand-repo"
        }
      },
      cost: "expensive",
      createdAt: new Date()
    };

    const result = await enrichContextWithIndexedRepo({
      deps: {
        api: {
          fetchRepoManifest: async () => {
            await new Promise((r) => setTimeout(r, 50));
            return { repoId: "github:CoopAI-Corp/plane", files: [], fileCount: 0 };
          },
          fetchRepoInventoryViaCloud: async () => ({
            fileCount: 4616,
            lineCount: 550_957,
            indexedAt: "2026-01-01T00:00:00.000Z",
            branch: "preview"
          }),
          getBackendClient: () => ({
            fetchRepoFile: async () => {
              await new Promise((r) => setTimeout(r, 5_000));
              return { path: "README.md", content: "# slow", encoding: "utf-8" };
            }
          })
        } as never,
        apiBaseUrl: "https://api.coop-ai.dev",
        codeHostRouter: {
          getRepositoryTree: async () => {
            await new Promise((r) => setTimeout(r, 50));
            return {
              path: "",
              branch: "preview",
              entries: [
                { name: "README.md", path: "README.md", type: "file" as const },
                { name: "apps", path: "apps", type: "dir" as const }
              ]
            };
          }
        } as never
      },
      target: {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        provider: "github"
      },
      request,
      result: {
        requestId: request.id,
        type: request.type,
        data: {},
        fetchedAt: new Date()
      },
      budgetMs: 80
    });

    const data = result.data as Record<string, unknown>;
    assert.equal(data.resolvedBranch, "preview");
    assert.ok(data.repoInventory, "timeout must keep inventory");
    assert.equal((data.repoInventory as { fileCount?: number }).fileCount, 4616);
  });

  await test("understand-repo attaches inventory + tree + entry file bodies", async () => {
    const request: ContextFetchRequest = {
      id: "test:understand:full",
      type: "file_metadata",
      params: {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        quickAction: "understand-repo"
      },
      intent: {
        id: "evt-3",
        intent: "quick_action_clicked" as const,
        timestamp: new Date(),
        costEstimate: "expensive" as const,
        context: {
          repoId: "github:CoopAI-Corp/plane",
          owner: "CoopAI-Corp",
          repo: "plane",
          branch: "main",
          buttonClicked: "understand-repo"
        }
      },
      cost: "expensive",
      createdAt: new Date()
    };

    const result = await enrichContextWithIndexedRepo({
      deps: {
        api: {
          fetchRepoManifest: async () => ({
            repoId: "github:CoopAI-Corp/plane",
            files: [
              { path: "README.md", symbols: [] },
              { path: "package.json", symbols: [] }
            ],
            fileCount: 2,
            lastCrawledAt: "2026-01-01T00:00:00.000Z"
          }),
          fetchRepoInventoryViaCloud: async () => ({
            fileCount: 4616,
            lineCount: 550_957,
            indexedAt: "2026-01-01T00:00:00.000Z",
            branch: "preview"
          }),
          getBackendClient: () => ({
            fetchRepoFile: async (_base: string, _repoId: string, path: string) => ({
              path,
              content: path === "README.md" ? "# Plane\n" : '{"name":"plane"}\n',
              encoding: "utf-8"
            })
          })
        } as never,
        apiBaseUrl: "https://api.coop-ai.dev",
        codeHostRouter: {
          getRepositoryTree: async () => ({
            path: "",
            branch: "preview",
            entries: [
              { name: "README.md", path: "README.md", type: "file" as const },
              { name: "apps", path: "apps", type: "dir" as const },
              { name: "package.json", path: "package.json", type: "file" as const }
            ]
          }),
          getFileContent: async (path: string) => ({
            path,
            content: path.endsWith("README.md") ? "# Plane\n" : '{"name":"plane"}\n',
            encoding: "utf-8" as const,
            lines: []
          })
        } as never
      },
      target: {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        provider: "github"
      },
      request,
      result: {
        requestId: request.id,
        type: request.type,
        data: {},
        fetchedAt: new Date()
      },
      budgetMs: 5_000
    });

    const data = result.data as Record<string, unknown>;
    assert.equal(data.resolvedBranch, "preview");
    assert.equal((data.repoInventory as { fileCount?: number }).fileCount, 4616);
    const tree = data.treeOverview as { topLevelFiles?: string[]; topLevelDirs?: string[] };
    assert.ok((tree.topLevelFiles?.length ?? 0) + (tree.topLevelDirs?.length ?? 0) > 0);
    const entryFiles = data.entryFiles as Array<{ path: string; content?: string }>;
    assert.ok(entryFiles.length >= 1);
    assert.ok(entryFiles.some((file) => (file.content ?? "").trim().length > 0));
  });

  await test("understandRepoEmptyEvidenceMessage refuses architecture invention", async () => {
    const message = understandRepoEmptyEvidenceMessage({
      owner: "CoopAI-Corp",
      repo: "plane",
      branch: "preview"
    });
    assert.match(message, /Attach check failed/i);
    assert.match(message, /0\.1\.0/);
    assert.match(message, /could not attach repository evidence/i);
    assert.match(message, /can.t summarize architecture from the repo name alone/i);
    assert.match(message, /preview/);
  });

  await test("understandRepoMissingEntryBodiesMessage refuses identity-only architecture", async () => {
    assert.equal(hasUnderstandRepoEntryBodies({ entryFiles: [{ path: "README.md" }] }), false);
    assert.equal(
      hasUnderstandRepoEntryBodies({ entryFiles: [{ path: "README.md", content: "# Hi" }] }),
      true
    );
    const message = understandRepoMissingEntryBodiesMessage({
      owner: "CoopAI-Corp",
      repo: "plane",
      branch: "preview",
      hasInventory: true,
      hasTree: true
    });
    assert.match(message, /can.t summarize architecture from the repo name alone/i);
    assert.match(message, /inventory/i);
    assert.match(message, /tree overview/i);
  });

  const total = passed + failed;
  console.log(`\nindexedRepoContextEnrichment: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
