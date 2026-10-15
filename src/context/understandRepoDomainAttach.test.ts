import assert from "node:assert/strict";
import {
  collectUnderstandDomainPaths,
  filterComposeArchitectureFiles,
  isUnderstandArchitectureNoisePath,
  isUnderstandDomainSourcePath,
  isolateUnderstandRepoSummary,
  pickUnderstandParentDirs,
  selectUnderstandDomainPathsFromListings,
  treeHasAppsLayout,
  MAX_UNDERSTAND_WALK_LISTINGS
} from "./understandRepoDomainAttach";

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

const planeTree: Record<string, Array<{ name: string; type: "dir" | "file" }>> = {
  apps: [
    { name: "api", type: "dir" },
    { name: "web", type: "dir" },
    { name: "live", type: "dir" },
    { name: "admin", type: "dir" },
    { name: "space", type: "dir" },
    { name: "proxy", type: "dir" }
  ],
  "apps/api": [
    { name: "manage.py", type: "file" },
    { name: "plane", type: "dir" },
    { name: "bin", type: "dir" }
  ],
  "apps/api/plane": [
    { name: "db", type: "dir" },
    { name: "api", type: "dir" },
    { name: "app", type: "dir" }
  ],
  "apps/api/plane/db": [{ name: "models", type: "dir" }],
  "apps/api/plane/db/models": [
    { name: "issue.py", type: "file" },
    { name: "state.py", type: "file" },
    { name: "__init__.py", type: "file" }
  ],
  "apps/api/plane/api": [{ name: "middleware", type: "dir" }],
  "apps/api/plane/api/middleware": [{ name: "api_authentication.py", type: "file" }],
  "apps/web": [{ name: "app", type: "dir" }],
  "apps/web/app": [{ name: "root.tsx", type: "file" }],
  "apps/live": [{ name: "src", type: "dir" }],
  "apps/live/src": [{ name: "server.ts", type: "file" }]
};

async function run(): Promise<void> {
  await test("walk includes arbitrary customer roots while skipping metadata/generated directories", () => {
    assert.deepEqual(pickUnderstandParentDirs([".github", "apps", "packages", "deployments", ".git", "dist", "CustomModules"]), [
      ".github", "CustomModules", "apps", "deployments", "packages"
    ]);
  });

  await test("compose and entrypoint scripts are architecture noise", () => {
    assert.equal(isUnderstandArchitectureNoisePath("docker-compose.yml"), true);
    assert.equal(isUnderstandArchitectureNoisePath("apps/api/bin/docker-entrypoint-api.sh"), true);
    assert.equal(isUnderstandArchitectureNoisePath("AGENTS.md"), true);
    assert.equal(isUnderstandArchitectureNoisePath("apps/api/plane/db/models/issue.py"), false);
  });

  await test("candidate paths do not assume a source folder or language", () => {
    assert.equal(isUnderstandDomainSourcePath("apps/api/manage.py"), true);
    assert.equal(isUnderstandDomainSourcePath("docker-compose.yml"), false);
    assert.equal(isUnderstandDomainSourcePath("package.json"), true);
    assert.equal(isUnderstandDomainSourcePath("Custom/record.kt"), true);
  });

  await test("listings pick issue/auth over compose", () => {
    const picked = selectUnderstandDomainPathsFromListings([
      { dir: "", entries: [{ name: "docker-compose.yml", type: "file" }] },
      {
        dir: "apps/api/plane/db/models",
        entries: [
          { name: "issue.py", type: "file" },
          { name: "state.py", type: "file" }
        ]
      },
      {
        dir: "apps/api/plane/api/middleware",
        entries: [{ name: "api_authentication.py", type: "file" }]
      }
    ]);
    assert.ok(picked.some((path) => path.endsWith("issue.py")), `picked=${picked.join(", ")}`);
    assert.ok(picked.some((path) => path.includes("api_authentication")), `picked=${picked.join(", ")}`);
    assert.ok(!picked.includes("docker-compose.yml"));
  });

  await test("filterComposeArchitectureFiles drops compose when apps exist", () => {
    const kept = filterComposeArchitectureFiles(
      [
        { path: "docker-compose.yml" },
        { path: "AGENTS.md" },
        { path: "README.md" },
        { path: "apps/api/manage.py" }
      ],
      true
    );
    assert.ok(kept.some((file) => file.path === "apps/api/manage.py"));
    assert.ok(kept.some((file) => file.path === "README.md"));
    assert.ok(!kept.some((file) => file.path === "docker-compose.yml"));
    assert.ok(!kept.some((file) => file.path === "AGENTS.md"));
  });

  await test("isolateUnderstandRepoSummary drops leftover Notion/Docs and compose", () => {
    const isolated = isolateUnderstandRepoSummary({
      entryFiles: [
        { path: "docker-compose.yml", content: "services:" },
        { path: "apps/api/manage.py", content: "django" }
      ],
      treeOverview: { topLevelDirs: ["apps"] },
      notion: { pages: [{ id: "1", title: "GitHub App API" }] },
      googleDocs: { documents: [{ id: "2", title: "SwingIQ" }] }
    });
    assert.equal(isolated.notion, undefined);
    assert.equal(isolated.googleDocs, undefined);
    assert.ok(isolated.entryFiles?.some((file) => file.path === "apps/api/manage.py"));
    assert.ok(!isolated.entryFiles?.some((file) => file.path === "docker-compose.yml"));
  });

  await test("treeHasAppsLayout", () => {
    assert.equal(treeHasAppsLayout(["apps", "packages"]), true);
    assert.equal(treeHasAppsLayout(["src", "docs"]), false);
  });

  await test("collectUnderstandDomainPaths walks Plane apps/ to models and auth", async () => {
    const paths = await collectUnderstandDomainPaths({
      topLevelDirs: ["apps", "packages", ".github"],
      listDirectory: async (path) => planeTree[path]
    });
    assert.ok(
      paths.some((path) => /issue\.py|state\.py|api_authentication|manage\.py|root\.tsx|server\.ts/i.test(path)),
      `expected Plane domain files, got ${paths.join(", ")}`
    );
    assert.ok(paths.length >= 3, `expected several first-read files, got ${paths.join(", ")}`);
    assert.ok(!paths.some((path) => /docker-compose|entrypoint|AGENTS/i.test(path)));
  });

  await test("arbitrary languages and directories survive the bounded remote walk", async () => {
    const paths = await collectUnderstandDomainPaths({topLevelDirs: ["Custom", "lib", ".git", "dist"], listDirectory: async path =>
      path === "Custom" ? [{name: "Domain", type: "dir"}] :
      path === "Custom/Domain" ? [{name: "handler.kt", type: "file"}, {name: "Operation", type: "file"}] :
      path === "lib" ? [{name: "record.cs", type: "file"}] : []});
    assert.ok(paths.includes("Custom/Domain/handler.kt"));
    assert.ok(paths.includes("Custom/Domain/Operation"));
    assert.ok(paths.includes("lib/record.cs"));
  });
  await test("remote case-distinct directory names retain separate bodies", async () => {
    const visited: string[] = [];
    const paths = await collectUnderstandDomainPaths({topLevelDirs: ["Module", "module"], listDirectory: async path => {
      visited.push(path); return [{name: "operation.rs", type: "file"}];
    }});
    assert.deepEqual(visited, ["Module", "module"]);
    assert.ok(paths.includes("Module/operation.rs"));
    assert.ok(paths.includes("module/operation.rs"));
  });
  await test("unreadable directory attempts count against the global listing bound", async () => {
    let calls = 0;
    await collectUnderstandDomainPaths({topLevelDirs: Array.from({length: 40}, (_, index) => `module-${index}`),
      listDirectory: async () => {calls++; return undefined;}});
    assert.equal(calls, MAX_UNDERSTAND_WALK_LISTINGS);
  });

  const total = passed + failed;
  console.log(`\nunderstandRepoDomainAttach: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
