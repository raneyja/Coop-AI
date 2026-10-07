import assert from "node:assert/strict";
import { isRemoteFileSearchFallbackCandidate, mergeRemoteFileSearchHits, searchFilesViaCloudTree } from "./cloudRepoFileSearchFallback";

async function main(): Promise<void> {
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

await test("isRemoteFileSearchFallbackCandidate matches axios 403 errors", () => {
  assert.equal(isRemoteFileSearchFallbackCandidate(new Error("Request failed with status code 403")), true);
});

await test("isRemoteFileSearchFallbackCandidate matches axios 400 / unsupported search errors", () => {
  assert.equal(isRemoteFileSearchFallbackCandidate(new Error("Request failed with status code 400")), true);
  assert.equal(isRemoteFileSearchFallbackCandidate(Object.assign(new Error("backend search unavailable"), { code: "unsupported" })), true);
  assert.equal(isRemoteFileSearchFallbackCandidate(Object.assign(new Error("backend search unavailable"), { status: 404 })), true);
  assert.equal(
    isRemoteFileSearchFallbackCandidate(new Error("File search isn't supported for this code host yet.")),
    true
  );
  assert.equal(
    isRemoteFileSearchFallbackCandidate(new Error("You must enable Advanced Search to use this feature")),
    true
  );
  assert.equal(isRemoteFileSearchFallbackCandidate({ code: "unsupported" }), true);
  assert.equal(isRemoteFileSearchFallbackCandidate({ response: { status: 422 } }), true);
});

await test("searchFilesViaCloudTree finds files by filename", async () => {
  const hits = await searchFilesViaCloudTree(
    async (path) => {
      if (path === "src/server") {
        return {
          entries: [
            { path: "src/server/githubAppApi.ts", name: "githubAppApi.ts", type: "file" },
            { path: "src/server/githubAppService.ts", name: "githubAppService.ts", type: "file" }
          ]
        };
      }
      if (path === "src") {
        return {
          entries: [{ path: "src/server", name: "server", type: "dir" }]
        };
      }
      return { entries: [{ path: "src", name: "src", type: "dir" }] };
    },
    "githubAppApi.ts",
    5
  );
  assert.equal(hits[0]?.path, "src/server/githubAppApi.ts");
});

await test("wide remote trees reach nested handlers within the directory limit", async () => {
  let calls = 0;
  const hits = await searchFilesViaCloudTree(async (path) => {
    calls++;
    if (!path) return { entries: [...Array.from({ length: 60 }, (_, i) => ({ path: `tooling${i}`, name: `tooling${i}`, type: "dir" as const })), { path: "packages", name: "packages", type: "dir" as const }] };
    const next: Record<string, string> = { packages: "packages/lib", "packages/lib": "packages/lib/server-only", "packages/lib/server-only": "packages/lib/server-only/operations" };
    if (next[path]) return { entries: [{ path: next[path], name: next[path].split("/").pop()!, type: "dir" as const }] };
    if (path === "packages/lib/server-only/operations") return { entries: [{ path: `${path}/sign-field.ts`, name: "sign-field.ts", type: "file" as const }] };
    return { entries: [] };
  }, "sign", 1);
  assert.equal(hits[0]?.path, "packages/lib/server-only/operations/sign-field.ts");
  assert.ok(calls <= 48);
});

await test("a matching package cannot monopolize discovery before sibling handlers", async () => {
  const dir = (path: string) => ({ path, name: path.split("/").pop()!, type: "dir" as const });
  const hits = await searchFilesViaCloudTree(async (path) => {
    if (!path) return { entries: [dir("packages")] };
    if (path === "packages") return { entries: [dir("packages/signing"), dir("packages/lib")] };
    if (path === "packages/signing") return { entries: [dir(`${path}/src`)] };
    if (path.startsWith("packages/signing/src")) return { entries: Array.from({ length: 60 }, (_, i) => dir(`${path}/branch${i}`)) };
    if (path === "packages/lib") return { entries: [dir(`${path}/server-only`)] };
    if (path === "packages/lib/server-only") return { entries: [...Array.from({ length: 15 }, (_, i) => dir(`${path}/area${i}`)), dir(`${path}/field`)] };
    if (path === "packages/lib/server-only/field") return { entries: [{ path: `${path}/sign-field.ts`, name: "sign-field.ts", type: "file" as const }] };
    return { entries: [] };
  }, "sign", 20);
  assert.ok(hits.some((hit) => hit.path === "packages/lib/server-only/field/sign-field.ts"));
});

await test("excluded UI matches cannot fill the limit before backend discovery", async () => {
  const hits = await searchFilesViaCloudTree(async (path) => {
    if (!path) return { entries: [...Array.from({ length: 25 }, (_, i) => ({ path: `ui/sign-${i}.tsx`, name: `sign-${i}.tsx`, type: "file" as const })), { path: "server", name: "server", type: "dir" as const }] };
    return { entries: path === "server" ? [{ path: "server/sign-field.ts", name: "sign-field.ts", type: "file" as const }] : [] };
  }, "sign", 20, (path) => !path.endsWith(".tsx"));
  assert.deepEqual(hits.map((hit) => hit.path), ["server/sign-field.ts"]);
});

await test("deep handlers are not hidden by an early filename cap", async () => {
  const dir = (path: string) => ({ path, name: path.split("/").pop()!, type: "dir" as const });
  const hits = await searchFilesViaCloudTree(async (path) => {
    if (!path) {
      return {
        entries: [
          ...Array.from({ length: 110 }, (_, i) => ({ path: `apps/client/sign-${i}.tsx`, name: `sign-${i}.tsx`, type: "file" as const })),
          dir("packages")
        ]
      };
    }
    if (path === "packages") return { entries: [dir("packages/lib")] };
    if (path === "packages/lib") return { entries: [dir("packages/lib/server-only")] };
    if (path === "packages/lib/server-only") return { entries: [dir("packages/lib/server-only/field")] };
    if (path === "packages/lib/server-only/field") {
      return { entries: [{ path: `${path}/sign-field-with-token.ts`, name: "sign-field-with-token.ts", type: "file" as const }] };
    }
    return { entries: [] };
  }, "sign", 1, (path) => !path.startsWith("apps/client/"));
  assert.equal(hits[0]?.path, "packages/lib/server-only/field/sign-field-with-token.ts");
});

await test("indexed graph hits survive a full tree fallback cap", () => {
  const treeHits = Array.from({ length: 100 }, (_, index) => ({
    path: `packages/signing/adjacent-${index}.ts`,
    name: `adjacent-${index}.ts`
  }));
  const actual = { path: "packages/lib/server-only/field/sign-field-with-token.ts", name: "sign-field-with-token.ts" };
  const merged = mergeRemoteFileSearchHits([actual], treeHits, 100);
  assert.equal(merged[0]?.path, actual.path);
  assert.equal(merged.length, 100);
});

console.log(`\ncloudRepoFileSearchFallback: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}
}
void main();
