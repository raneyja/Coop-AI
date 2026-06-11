import { createRequire } from "node:module";
import path from "node:path";
import type { Pool } from "pg";
import { codeHostRequestJson } from "../api/codeHosts/codeHostHttp";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { ManifestSymbol } from "../manifest/types";
import { RepoManifestStore } from "../manifest/repoManifestStore";
import { resolveCodeHostTokenForOrg } from "../server/codeHostCredentialResolver";
import { getConnector } from "../server/codeHostConnectors/registry";
import { gitlabApiBaseUrl, loadGitLabAppConfig } from "../server/gitlabAppConfig";
import { CollectionStore } from "../server/collectionStore";
import { getDbPool, requireDbPool } from "../server/db";
import { buildPartialFailure } from "./errorHandling";
import type { Job } from "./types";
import type { JobExecutionContext, ProgressReporter } from "./executors";

const require = createRequire(__filename);

const GITHUB_API = "https://api.github.com";
const BITBUCKET_API = "https://api.bitbucket.org/2.0";
const SYMBOL_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".py", ".go", ".java", ".rb"]);

export type { ManifestSymbol };

type ParsedRepo = {
  provider: CodeHostProvider;
  owner: string;
  repo: string;
  repoId: string;
};

type TreeBlob = {
  path: string;
  /** Present for GitHub git-blob API; GitLab/Bitbucket fetch by path instead. */
  sha?: string;
};

type GitHubRef = {
  object: { sha: string; type: string };
};

type GitHubTreeResponse = {
  tree: Array<{ path: string; type: string; sha: string }>;
  truncated?: boolean;
};

type GitHubBlob = {
  content: string;
  encoding: string;
};

const WASM_BY_EXTENSION: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".py": "tree-sitter-python.wasm",
  ".go": "tree-sitter-go.wasm",
  ".java": "tree-sitter-java.wasm",
  ".rb": "tree-sitter-ruby.wasm"
};

const SYMBOL_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "method_definition",
  "class_declaration",
  "class_definition",
  "export_statement"
]);

let parserReady: Promise<void> | undefined;
const languageCache = new Map<string, unknown>();

export async function buildStructureManifest(
  job: Job,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  signal: AbortSignal
): Promise<unknown> {
  const orgId = String(job.params.orgId ?? "");
  const collectionId = job.params.collectionId ? String(job.params.collectionId) : undefined;
  const repoId = job.params.repoId ? String(job.params.repoId) : undefined;
  if (!orgId) {
    throw new Error("Invalid parameters: orgId is required");
  }
  if (!collectionId && !repoId) {
    throw new Error("Invalid parameters: repoId or collectionId is required");
  }
  if (!ctx.orgStore) {
    throw new Error("Organization store is not configured");
  }

  const pool = requireDbPool(await getDbPool());
  const repoIds = collectionId
    ? await new CollectionStore(pool).listCollectionRepoIds(orgId, collectionId)
    : [repoId!];
  if (repoIds.length === 0) {
    throw new Error(collectionId ? "Collection has no repos" : "repoId is required");
  }

  if (repoIds.length === 1) {
    return crawlStructureManifestForRepo(orgId, repoIds[0], ctx, report, signal);
  }

  const completedRepos: string[] = [];
  const failedRepos: string[] = [];
  const results: Record<string, unknown> = {};

  for (let i = 0; i < repoIds.length; i += 1) {
    if (signal.aborted) {
      throw new Error("Job cancelled");
    }
    const currentRepoId = repoIds[i];
    const progress = 5 + Math.round((i / repoIds.length) * 90);
    await report(progress, `Crawling manifest for ${currentRepoId}`);
    try {
      results[currentRepoId] = await crawlStructureManifestForRepo(
        orgId,
        currentRepoId,
        ctx,
        async () => undefined,
        signal
      );
      completedRepos.push(currentRepoId);
    } catch (error) {
      failedRepos.push(currentRepoId);
    }
  }

  await report(100, "Collection manifest crawl complete");
  if (failedRepos.length > 0 && completedRepos.length > 0) {
    return buildPartialFailure(
      completedRepos,
      failedRepos,
      {
        collectionId,
        orgId,
        results,
        fileCount: completedRepos.reduce(
          (sum, id) => sum + Number((results[id] as { fileCount?: number }).fileCount ?? 0),
          0
        )
      },
      `Crawled ${completedRepos.length}/${repoIds.length} repos. ${failedRepos.join(", ")} failed.`
    );
  }
  if (failedRepos.length > 0) {
    throw new Error(`Manifest crawl failed for all repos in collection ${collectionId}`);
  }

  return {
    collectionId,
    orgId,
    repoIds: completedRepos,
    results,
    fileCount: completedRepos.reduce(
      (sum, id) => sum + Number((results[id] as { fileCount?: number }).fileCount ?? 0),
      0
    )
  };
}

async function crawlStructureManifestForRepo(
  orgId: string,
  repoId: string,
  ctx: JobExecutionContext,
  report: ProgressReporter,
  signal: AbortSignal
): Promise<unknown> {
  const target = parseRepoId(repoId);

  const token = await resolveCodeHostTokenForOrg(orgId, target.provider, {
    orgStore: ctx.orgStore!,
    connector: getConnector(target.provider),
    allowPatFallback: ctx.allowPatFallback ?? false
  });
  if (!token) {
    throw new Error(
      `Missing ${target.provider} App installation for organization (install the CoopAI ${target.provider} App)`
    );
  }

  const pool = requireDbPool(await getDbPool());
  const store = new RepoManifestStore(pool);

  await report(5, "Fetching repository tree");
  if (signal.aborted) {
    throw new Error("Job cancelled");
  }

  const { branch, blobs } = await fetchRecursiveTree(target, token);
  const symbolCandidates = blobs.filter((blob) => hasSymbolExtension(blob.path));

  await report(15, `Tree loaded (${blobs.length} files, ${symbolCandidates.length} to parse)`);

  const manifestRows: Array<{ filePath: string; symbols: ManifestSymbol[] }> = [];
  const allPaths = blobs.map((blob) => blob.path);

  for (const blob of blobs) {
    if (!hasSymbolExtension(blob.path)) {
      manifestRows.push({ filePath: blob.path, symbols: [] });
    }
  }

  for (let i = 0; i < symbolCandidates.length; i += 1) {
    if (signal.aborted) {
      throw new Error("Job cancelled");
    }
    const blob = symbolCandidates[i];
    const progress = 15 + Math.round((i / Math.max(symbolCandidates.length, 1)) * 70);
    await report(progress, `Parsing symbols: ${blob.path}`);

    const body = await fetchFileContent(target, blob, token, branch);
    const symbols = await extractSymbols(blob.path, body);
    manifestRows.push({ filePath: blob.path, symbols });
  }

  await report(90, "Saving manifest");
  const crawledAt = new Date();
  await store.upsertManifestRows(orgId, repoId, manifestRows, crawledAt);
  await store.deletePathsNotInSet(orgId, repoId, allPaths);

  await report(100, "Manifest crawl complete");
  return {
    repoId,
    orgId,
    branch,
    fileCount: allPaths.length,
    parsedFileCount: symbolCandidates.length,
    symbolFileCount: manifestRows.filter((row) => row.symbols.length > 0).length,
    lastCrawledAt: crawledAt.toISOString()
  };
}

export function parseRepoId(repoId: string): ParsedRepo {
  const providerPart = repoId.includes(":") ? repoId.split(":")[0] : "github";
  const slug = repoId.includes(":") ? repoId.split(":")[1] : repoId;
  const [owner, repo] = (slug ?? repoId).split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoId: ${repoId}`);
  }
  const provider = providerPart as CodeHostProvider;
  if (provider !== "github" && provider !== "gitlab" && provider !== "bitbucket") {
    throw new Error(`Invalid repoId provider: ${providerPart}`);
  }
  return { provider, owner, repo, repoId };
}

function resolveGitlabApiBase(): string {
  return gitlabApiBaseUrl(loadGitLabAppConfig()?.gitlabBaseUrl);
}

async function fetchRecursiveTree(
  target: ParsedRepo,
  token: string
): Promise<{ branch: string; blobs: TreeBlob[] }> {
  switch (target.provider) {
    case "github":
      return fetchGithubRecursiveTree(target, githubHeaders(token));
    case "gitlab":
      return fetchGitlabRecursiveTree(target, token);
    case "bitbucket":
      return fetchBitbucketRecursiveTree(target, token);
    default:
      throw new Error(`Unsupported provider: ${target.provider}`);
  }
}

async function fetchFileContent(
  target: ParsedRepo,
  blob: TreeBlob,
  token: string,
  branch: string
): Promise<string> {
  switch (target.provider) {
    case "github":
      if (!blob.sha) {
        throw new Error(`Missing blob sha for ${blob.path}`);
      }
      return fetchGithubBlob(target, blob.sha, githubHeaders(token));
    case "gitlab":
      return fetchGitlabFile(target, blob.path, token, branch);
    case "bitbucket":
      return fetchBitbucketFile(target, blob.path, token, branch);
    default:
      throw new Error(`Unsupported provider: ${target.provider}`);
  }
}

async function fetchGithubRecursiveTree(
  target: ParsedRepo,
  headers: Record<string, string>
): Promise<{ branch: string; blobs: TreeBlob[] }> {
  const repoUrl = `${GITHUB_API}/repos/${target.owner}/${target.repo}`;
  const repo = await codeHostRequestJson<{ default_branch: string }>(repoUrl, {
    headers,
    provider: "github"
  });
  const branch = repo.default_branch;
  const ref = await codeHostRequestJson<GitHubRef>(`${repoUrl}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers,
    provider: "github"
  });
  const commitSha = ref.object.sha;
  const tree = await codeHostRequestJson<GitHubTreeResponse>(
    `${repoUrl}/git/trees/${commitSha}?recursive=1`,
    { headers, provider: "github" }
  );
  if (tree.truncated) {
    throw new Error("Repository tree response was truncated; manifest crawl requires full tree");
  }
  const blobs = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({ path: entry.path, sha: entry.sha }));
  return { branch, blobs };
}

async function fetchGithubBlob(
  target: ParsedRepo,
  sha: string,
  headers: Record<string, string>
): Promise<string> {
  const blob = await codeHostRequestJson<GitHubBlob>(
    `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/blobs/${sha}`,
    { headers, provider: "github" }
  );
  if (blob.encoding !== "base64") {
    throw new Error(`Unexpected blob encoding: ${blob.encoding}`);
  }
  return Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchGitlabRecursiveTree(
  target: ParsedRepo,
  token: string
): Promise<{ branch: string; blobs: TreeBlob[] }> {
  const apiBase = resolveGitlabApiBase();
  const headers = gitlabHeaders(token);
  const projectId = encodeURIComponent(`${target.owner}/${target.repo}`);
  const project = await codeHostRequestJson<{ default_branch: string }>(
    `${apiBase}/projects/${projectId}`,
    { headers, provider: "gitlab" }
  );
  const branch = project.default_branch;
  const blobs: TreeBlob[] = [];
  let page = 1;
  while (true) {
    const tree = await codeHostRequestJson<Array<{ path: string; type: string }>>(
      `${apiBase}/projects/${projectId}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`,
      { headers, provider: "gitlab" }
    );
    for (const entry of tree) {
      if (entry.type === "blob") {
        blobs.push({ path: entry.path });
      }
    }
    if (tree.length < 100) {
      break;
    }
    page += 1;
  }
  return { branch, blobs };
}

async function fetchGitlabFile(
  target: ParsedRepo,
  filePath: string,
  token: string,
  branch: string
): Promise<string> {
  const apiBase = resolveGitlabApiBase();
  const headers = gitlabHeaders(token);
  const projectId = encodeURIComponent(`${target.owner}/${target.repo}`);
  const response = await fetch(
    `${apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(branch)}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitLab file fetch failed (${response.status}): ${body}`);
  }
  return response.text();
}

// Bitbucket has no recursive tree endpoint — BFS directory walk. Slower than GitHub/GitLab
// on large repos but acceptable for one-time manifest crawl.
async function fetchBitbucketRecursiveTree(
  target: ParsedRepo,
  token: string
): Promise<{ branch: string; blobs: TreeBlob[] }> {
  const headers = bitbucketHeaders(token);
  const repoUrl = `${BITBUCKET_API}/repositories/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const repo = await codeHostRequestJson<{ mainbranch?: { name: string } }>(repoUrl, {
    headers,
    provider: "bitbucket"
  });
  const branch = repo.mainbranch?.name ?? "main";
  const blobs: TreeBlob[] = [];
  const dirs: string[] = [""];

  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    let nextUrl = dir
      ? `${repoUrl}/src/${encodeURIComponent(branch)}/${encodeBitbucketPath(dir)}?pagelen=100`
      : `${repoUrl}/src/${encodeURIComponent(branch)}/?pagelen=100`;

    while (nextUrl) {
      const page = await codeHostRequestJson<{
        values?: Array<{ path: string; type: string }>;
        next?: string;
      }>(nextUrl, { headers, provider: "bitbucket" });

      for (const item of page.values ?? []) {
        if (item.type === "commit_file") {
          blobs.push({ path: item.path });
        } else if (item.type === "commit_directory") {
          dirs.push(item.path);
        }
      }
      nextUrl = page.next ?? "";
    }
  }

  return { branch, blobs };
}

async function fetchBitbucketFile(
  target: ParsedRepo,
  filePath: string,
  token: string,
  branch: string
): Promise<string> {
  const headers = bitbucketHeaders(token);
  const repoUrl = `${BITBUCKET_API}/repositories/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const response = await fetch(
    `${repoUrl}/src/${encodeURIComponent(branch)}/${encodeBitbucketPath(filePath)}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bitbucket file fetch failed (${response.status}): ${body}`);
  }
  return response.text();
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "coop-ai-backend"
  };
}

function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "User-Agent": "coop-ai-backend"
  };
}

function bitbucketHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "coop-ai-backend"
  };
}

function encodeBitbucketPath(filePath: string): string {
  return filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function hasSymbolExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SYMBOL_EXTENSIONS.has(ext);
}

async function ensureParserReady(): Promise<void> {
  if (!parserReady) {
    parserReady = initParser();
  }
  await parserReady;
}

async function initParser(): Promise<void> {
  const Parser = (await import("web-tree-sitter")).default;
  const wasmDir = path.dirname(require.resolve("web-tree-sitter/package.json"));
  await Parser.init({
    locateFile(scriptName: string) {
      return path.join(wasmDir, scriptName);
    }
  });
}

async function loadLanguage(ext: string): Promise<unknown> {
  const wasmFile = WASM_BY_EXTENSION[ext];
  if (!wasmFile) {
    throw new Error(`No tree-sitter grammar configured for extension ${ext}`);
  }
  const cached = languageCache.get(wasmFile);
  if (cached) {
    return cached;
  }
  await ensureParserReady();
  const Parser = (await import("web-tree-sitter")).default;
  const wasmsRoot = path.join(
    path.dirname(require.resolve("tree-sitter-wasms/package.json")),
    "out"
  );
  const language = await Parser.Language.load(path.join(wasmsRoot, wasmFile));
  languageCache.set(wasmFile, language);
  return language;
}

type SyntaxNode = {
  type: string;
  text: string;
  childCount: number;
  child(index: number): SyntaxNode;
};

async function extractSymbols(filePath: string, source: string): Promise<ManifestSymbol[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!SYMBOL_EXTENSIONS.has(ext)) {
    return [];
  }

  await ensureParserReady();
  const Parser = (await import("web-tree-sitter")).default;
  const language = await loadLanguage(ext);
  const parser = new Parser();
  parser.setLanguage(language as never);
  const tree = parser.parse(source);
  const symbols: ManifestSymbol[] = [];
  const seen = new Set<string>();

  walkSyntaxNode(tree.rootNode as SyntaxNode, (node) => {
    if (!SYMBOL_NODE_TYPES.has(node.type)) {
      return;
    }
    const name = symbolNameFromNode(node);
    if (!name) {
      return;
    }
    const kind = symbolKindFromNode(node.type);
    const key = `${kind}:${name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    symbols.push({ name, kind });
  });

  tree.delete();
  return symbols;
}

function walkSyntaxNode(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i += 1) {
    walkSyntaxNode(node.child(i), visit);
  }
}

function symbolNameFromNode(node: SyntaxNode): string | undefined {
  if (node.type === "export_statement") {
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      const nested = symbolNameFromNode(child as never);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const nameTypes = new Set(["identifier", "type_identifier", "property_identifier", "field_identifier"]);
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (nameTypes.has(child.type)) {
      return child.text;
    }
    if (child.type === "name" || child.type === "declarator") {
      const nested = symbolNameFromNode(child as never);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function symbolKindFromNode(nodeType: string): ManifestSymbol["kind"] {
  if (nodeType === "class_declaration" || nodeType === "class_definition") {
    return "class";
  }
  if (nodeType === "method_definition") {
    return "method";
  }
  if (nodeType === "export_statement") {
    return "export";
  }
  return "function";
}

export async function listOrgIdsForRepo(pool: Pool, repoId: string): Promise<string[]> {
  const result = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM org_repos WHERE repo_id = $1`,
    [repoId]
  );
  return result.rows.map((row) => String(row.org_id));
}
