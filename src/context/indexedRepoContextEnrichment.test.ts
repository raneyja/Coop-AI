import assert from "node:assert/strict";
import { enrichContextWithIndexedRepo } from "./indexedRepoContextEnrichment";
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

  await test("enrichContextWithIndexedRepo attaches manifest and remote file for workspace repos", async () => {
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
            indexedAt: "2026-01-01T00:00:00.000Z"
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
    assert.ok(data.manifest);
    assert.ok(data.treeOverview);
    assert.ok(data.repoInventory);
    const localFiles = data.localFiles as { files?: Array<{ path: string }> };
    assert.equal(localFiles?.files?.[0]?.path, "README.md");
  });

  const total = passed + failed;
  console.log(`\nindexedRepoContextEnrichment: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
