import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CloneTarget = {
  repoId: string;
  owner: string;
  repo: string;
  provider: "github" | "gitlab" | "bitbucket";
  branch?: string;
};

export type CloneResult = {
  localPath: string;
  headCommit?: string;
  files: Array<{ path: string; size: number }>;
};

export async function cloneRepository(
  target: CloneTarget,
  token?: string,
  workRoot?: string
): Promise<CloneResult> {
  const root = workRoot ?? path.join(os.tmpdir(), "coopai-clones");
  const safeId = target.repoId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = path.join(root, safeId);

  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const remote = buildCloneUrl(target, token);
  await execFileAsync("git", ["clone", "--depth", "1", remote, localPath], {
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024
  });

  const headCommit = await readHeadCommit(localPath);
  const files = walkRepoFiles(localPath);

  return { localPath, headCommit, files };
}

export function removeRepositoryClone(localPath: string): void {
  if (fs.existsSync(localPath)) {
    fs.rmSync(localPath, { recursive: true, force: true });
  }
}

function buildCloneUrl(target: CloneTarget, token?: string): string {
  const host =
    target.provider === "gitlab"
      ? "gitlab.com"
      : target.provider === "bitbucket"
        ? "bitbucket.org"
        : "github.com";
  const slug = `${target.owner}/${target.repo}.git`;
  if (token && target.provider === "github") {
    return `https://x-access-token:${encodeURIComponent(token)}@${host}/${slug}`;
  }
  if (token && target.provider === "gitlab") {
    return `https://oauth2:${encodeURIComponent(token)}@${host}/${slug}`;
  }
  if (token && target.provider === "bitbucket") {
    return `https://x-token-auth:${encodeURIComponent(token)}@${host}/${slug}`;
  }
  return `https://${host}/${slug}`;
}

async function readHeadCommit(localPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", localPath, "rev-parse", "HEAD"], {
      timeout: 10_000
    });
    return stdout.trim() || undefined;
  } catch {
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
