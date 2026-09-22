import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  removeRepositoryClone,
  resolveCloneLocalPath,
  type CloneTarget
} from "./gitCloneService";

const repo: CloneTarget = {
  repoId: "github:acme/app",
  owner: "acme",
  repo: "app",
  provider: "github"
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-clone-test-"));
const orgA = resolveCloneLocalPath({ ...repo, orgId: "org-a", jobId: "job-a" }, root);
const orgB = resolveCloneLocalPath({ ...repo, orgId: "org-b", jobId: "job-b" }, root);
assert.notEqual(orgA, orgB);
assert.equal(orgA.startsWith(root + path.sep), true);
assert.equal(orgB.startsWith(root + path.sep), true);

const gitlab = resolveCloneLocalPath(
  { ...repo, repoId: "gitlab:acme/app", provider: "gitlab", orgId: "org-a", jobId: "job-a" },
  root
);
const bitbucket = resolveCloneLocalPath(
  {
    ...repo,
    repoId: "bitbucket:acme/app",
    provider: "bitbucket",
    orgId: "org-a",
    jobId: "job-a"
  },
  root
);
assert.notEqual(gitlab, bitbucket);
assert.notEqual(gitlab, orgA);

fs.mkdirSync(orgA, { recursive: true });
fs.mkdirSync(orgB, { recursive: true });
fs.writeFileSync(path.join(orgA, "a.txt"), "a");
fs.writeFileSync(path.join(orgB, "b.txt"), "b");
removeRepositoryClone(orgA);
assert.equal(fs.existsSync(orgA), false);
assert.equal(fs.existsSync(path.join(orgB, "b.txt")), true);

const traversal = resolveCloneLocalPath(
  { ...repo, orgId: "../../etc", jobId: "..", repoId: "../passwd" },
  root
);
assert.equal(traversal.startsWith(root + path.sep), true);
assert.equal(traversal.includes(`${path.sep}..${path.sep}`), false);

fs.rmSync(root, { recursive: true, force: true });
console.log("gitCloneService: ok");
