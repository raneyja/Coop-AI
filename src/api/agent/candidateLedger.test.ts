import assert from "node:assert/strict";
import { CandidateLedger, canonicalSearchCriterion } from "./candidateLedger";

async function main(): Promise<void> {
  const ledger = new CandidateLedger();
  let requests = 0;
  const run = async () => { requests++; return { content: "verified excerpt" }; };
  const results = await Promise.all([
    ledger.once("index", "repo@main", '"parent_id"', run),
    ledger.once("index", "repo@main", " parentId ", run)
  ]);
  assert.equal(requests, 1);
  assert.equal(results[0], results[1]);
  await ledger.once("index", "repo@other", "parent_id", run);
  assert.equal(requests, 2);
  await ledger.once("index", "repo@main", "parent_id activation", run);
  assert.equal(requests, 3);
  ledger.record("repo@main", "api/parent.py", "parent_id", "verified");
  ledger.record("repo@main", "api/parent.py", "parentId", "untested");
  ledger.record("repo@main", "api/other.py", "parent_id", "ruled_out");
  ledger.record("repo@main", "api/missing.py", "parent_id", "unavailable");
  assert.deepEqual(ledger.snapshot("repo@main").map((row) => row.status), ["verified", "ruled_out", "unavailable"]);
  assert.deepEqual(ledger.snapshot("foreign"), []);
  ledger.record("repo@main", "api/parent.py", "deactivation", "untested");
  assert.equal(ledger.snapshot("repo@main").length, 4);
  let failures = 0;
  const fail = async () => { failures++; throw new Error("unavailable"); };
  await assert.rejects(ledger.once("body", "repo@main", "api/Case.py", fail));
  await assert.rejects(ledger.once("body", "repo@main", "api/Case.py", fail));
  assert.equal(failures, 1);
  assert.equal(canonicalSearchCriterion(' "parentId" '), 'parent_id');
  console.log("candidateLedger: passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
