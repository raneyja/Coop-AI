import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const execFileAsync = promisify(execFile);

export type CloneTarget = {
  repoId: string;
  owner: string;
  repo: string;
  provider: "github" | "gitlab" | "bitbucket";
  branch?: string;
  /** Tenant that owns this clone. Required so two orgs never share a directory. */
  orgId?: string;
  /** Job id so concurrent clones of the same org+repo do not rm -rf each other. */
  jobId?: string;
};

export type CloneResult = {
  localPath: string;
  /** Checked-out branch (repo default when clone omits `-b`). */
  branch?: string;
  headCommit?: string;
  files: Array<{ path: string; size: number }>;
};

export async function cloneRepository(
  target: CloneTarget,
  token?: string,
  workRoot?: string,
  signal?: AbortSignal
): Promise<CloneResult> {
  signal?.throwIfAborted();
  const prefix = resolveCloneLocalPath(target, workRoot);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  // This invocation owns only its fresh directory, even when an attempt repeats.
  const localPath = fs.mkdtempSync(prefix + "-");
  const remote = buildCloneUrl(target);
  const username = target.provider === "github" ? "x-access-token"
    : target.provider === "gitlab" ? "oauth2" : "x-token-auth";
  const authorization = token ? Buffer.from(`${username}:${token}`).toString("base64") : undefined;
  try {
    await runGit(["clone", "--depth", "1", remote, localPath],
      gitChildEnvironment(localPath, remote, authorization), 600_000, signal);
    signal?.throwIfAborted();
    // These local lookups have no credential and settle physically before cleanup.
    const env = gitChildEnvironment(localPath);
    const [headCommit, branch] = await Promise.all([
      readHead(localPath, ["HEAD"], env, signal),
      readHead(localPath, ["--abbrev-ref", "HEAD"], env, signal)
    ]);
    signal?.throwIfAborted();
    return {localPath, branch: branch === "HEAD" ? undefined : branch, headCommit, files: walkRepoFiles(localPath)};
  } catch (error) {
    try { removeRepositoryClone(localPath); } finally { signal?.throwIfAborted(); }
    let message = error instanceof Error ? error.message : "Repository clone failed";
    for (const secret of [token, token && encodeURIComponent(token), authorization]) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
    throw new Error(message);
  }
}

/** Directory name is `{org}__{job}__{repo}` under the clone root. `..` cannot escape the root. */
export function resolveCloneLocalPath(target: CloneTarget, workRoot?: string): string {
  const root = path.resolve(workRoot ?? path.join(os.tmpdir(), "coopai-clones"));
  const dirName = [
    sanitizeCloneSegment(target.orgId ?? "no-org"),
    sanitizeCloneSegment(target.jobId ?? "no-job"),
    sanitizeCloneSegment(target.repoId)
  ].join("__");
  const localPath = path.resolve(root, dirName);
  if (localPath !== root && !localPath.startsWith(root + path.sep)) {
    throw new Error("invalid clone path");
  }
  return localPath;
}

export function sanitizeCloneSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\./g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "_";
  }
  return cleaned;
}

export function removeRepositoryClone(localPath: string): void {
  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }
}

export function cloneHostForProvider(provider: CloneTarget["provider"]): string {
  if (provider === "gitlab") {
    return "gitlab.com";
  }
  if (provider === "bitbucket") {
    return "bitbucket.org";
  }
  return "github.com";
}

function buildCloneUrl(target: CloneTarget): string {
  const host = cloneHostForProvider(target.provider);
  const slug = `${target.owner}/${target.repo}.git`;
  return `https://${host}/${slug}`;
}

/** Git owns only this explicit platform/transport environment and its command config. */
function gitChildEnvironment(localPath: string, remote?: string, authorization?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TMP", "TEMP",
    "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { HOME: localPath, USERPROFILE: localPath, XDG_CONFIG_HOME: localPath,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GIT_TRACE: "0", GIT_TRACE_CURL: "0",
    GIT_TRACE2: "0", GIT_TRACE2_EVENT: "0", GIT_TRACE2_PERF: "0", GIT_TRACE_PACKET: "0" });
  const settings = [["credential.helper", ""], ["core.askPass", ""], ["http.followRedirects", "false"],
    ["http.extraHeader", ""], ["init.templateDir", ""],
    ...(remote ? [[`http.${remote}.extraHeader`, ""],
      ...(authorization ? [[`http.${remote}.extraHeader`, `Authorization: Basic ${authorization}`]] : [])] : [])];
  env.GIT_CONFIG_COUNT = String(settings.length);
  for (const [index, [key, value]] of settings.entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return env;
}

async function runGit(args: string[], env: NodeJS.ProcessEnv, timeout: number, signal?: AbortSignal): Promise<{stdout: string}> {
  const started = performance.now();
  const command = execFileAsync("git", args, { timeout, maxBuffer: 4 * 1024 * 1024, signal, env, cwd: env.HOME });
  // execFile can settle on abort before the child stops writing, or resolve after
  // a timed-out child exits zero. Both require the actual close boundary.
  const closed = new Promise<void>(resolve => command.child.once("close", () => resolve()));
  let result;
  try { result = await command; } finally { await closed; }
  signal?.throwIfAborted();
  if (command.child.killed || performance.now() - started >= timeout) throw new Error("Git command timed out or was terminated");
  return result;
}

async function readHead(localPath: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(["-C", localPath, "rev-parse", ...args], env, 10_000, signal);
    return stdout.trim() || undefined;
  } catch {
    // A lookup failure remains optional; the clone owner checks Stop after both settle.
    return undefined;
  }
}

function walkRepoFiles(root: string): Array<{ path: string; size: number }> {
  const files: Array<{ path: string; size: number }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (isTextCandidate(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: path.relative(root, fullPath).replace(/\\/g, "/"),
            size: stat.size
          });
        } catch {
          // skip
        }
      }
    }
  }
  return files;
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt",
    ".rb", ".php", ".cs", ".md", ".json", ".yaml", ".yml", ".sql"
  ].includes(ext);
}

export function parseRepoId(repoId: string): CloneTarget {
  const providerPart = repoId.includes(":") ? repoId.split(":")[0] : "github";
  const slug = repoId.includes(":") ? repoId.split(":")[1] : repoId;
  const [owner, repo] = (slug ?? repoId).split("/");
  const provider =
    providerPart === "gitlab" ? "gitlab" : providerPart === "bitbucket" ? "bitbucket" : "github";
  return {
    repoId,
    owner: owner ?? "unknown",
    repo: repo ?? "repo",
    provider
  };
}
