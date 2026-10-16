import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { IndexSchema, OccurrenceSchema, SymbolRole, type Occurrence } from "@scip-code/scip";
import { decodeScipIndex, decodeScipIndexFile } from "./scipIndexDecoder";

function rows(occurrence: Occurrence) {
  const index = create(IndexSchema, { documents: [{ relativePath: "sample.java", occurrences: [occurrence] }] });
  return decodeScipIndex(fromBinary(IndexSchema, toBinary(IndexSchema, index)));
}
function definition(range: number[]) {
  return create(OccurrenceSchema, { symbol: "scip-java maven fixture 0.0.0 Fixture#add().", symbolRoles: SymbolRole.Definition, range });
}

test("actual scip-java 0.13.1 artifact yields definitions and a call reference", () => {
  const decoded = decodeScipIndexFile(path.join(process.cwd(), "src/jobs/fixtures/scip-java-0.13.1.scip"));
  const add = decoded.find(row => row.symbol === "add");
  assert.ok(add);
  assert.equal(add.filePath, "src/main/java/Fixture.java");
  assert.equal(add.lineStart, 1);
  assert.equal(add.kind, "function");
  assert.ok(add.references.some(ref => ref.file_path === add.filePath && ref.line === 1));
  assert.ok(decoded.some(row => row.symbol === "use"));
});

test("legacy single and multiline ranges retain one-based lines", () => {
  assert.equal(rows(definition([0, 2, 5]))[0]?.lineStart, 1);
  assert.equal(rows(definition([2, 5, 4, 1]))[0]?.lineEnd, 5);
});

test("typed ranges take precedence and accept zero coordinates", () => {
  const single = definition([20, 0, 4]);
  single.typedRange = { case: "singleLineRange", value: { $typeName: "scip.SingleLineRange", line: 0, startCharacter: 0, endCharacter: 0 } };
  assert.equal(rows(single)[0]?.lineStart, 1);
  const multi = definition([]);
  multi.typedRange = { case: "multiLineRange", value: { $typeName: "scip.MultiLineRange", startLine: 2, startCharacter: 3, endLine: 4, endCharacter: 1 } };
  assert.equal(rows(multi)[0]?.lineEnd, 5);
  multi.typedRange.value.endLine = 2;
  multi.typedRange.value.endCharacter = 3;
  assert.equal(rows(multi)[0]?.lineEnd, 3);
});

test("invalid typed ranges cannot fall back to plausible legacy coordinates", () => {
  const occurrence = definition([0, 0, 2]);
  occurrence.typedRange = { case: "singleLineRange", value: { $typeName: "scip.SingleLineRange", line: -1, startCharacter: 0, endCharacter: 2 } };
  assert.deepEqual(rows(occurrence), []);
  occurrence.typedRange.value.line = 0;
  occurrence.typedRange.value.startCharacter = 3;
  assert.deepEqual(rows(occurrence), []);
});

test("malformed legacy shapes, negative and reversed ranges are rejected", () => {
  for (const range of [[], [0, 0], [0, 0, 1, 2, 3], [-1, 0, 2], [0, 3, 2], [2, 0, 1, 2]]) {
    assert.deepEqual(rows(definition(range)), []);
  }
});


// Exercise the actual child/decoder/store caller against the producer contract:
// a target root equal to cwd is destructive output, never a source-root option.
import fs from "node:fs";
import os from "node:os";
import type { Pool } from "pg";
import { runScipIndexer } from "./runScipIndexer";

test("Java/Kotlin callers preserve project inputs and cannot fabricate a precise failed index", async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "coop-scip-caller-"));
  const previousPath = process.env.PATH;
  try {
    const bin = path.join(owned, "bin"); fs.mkdirSync(bin);
    const golden = path.join(owned, "golden.scip");
    fs.copyFileSync(path.join(process.cwd(), "src/jobs/fixtures/scip-java-0.13.1.scip"), golden);
    const executable = path.join(bin, "scip-java");
    fs.writeFileSync(executable, `#!${process.execPath}
const fs=require('fs'),path=require('path'),args=process.argv.slice(2);
if(args[0]!=='index')process.exit(40);
const target=args.indexOf('--targetroot');
if(target>=0&&path.resolve(args[target+1])===process.cwd())process.exit(42);
if(fs.readFileSync('input.txt','utf8')==='invalid')process.exit(1);
const output=args.indexOf('--output');if(output<0)process.exit(41);
fs.copyFileSync(${JSON.stringify(golden)},args[output+1]);
`, { mode: 0o700 });
    process.env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${previousPath ?? ''}`;
    for (const language of ["java", "kotlin"]) for (const input of ["valid", "invalid"]) {
      const project = path.join(owned, `${language}-${input}`); fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, "input.txt"), input);
      const writes: string[] = [];
      const pool = { query: async (sql: string) => { writes.push(sql); return { rows: [], rowCount: 0 }; } } as unknown as Pool;
      const result = await runScipIndexer("synthetic", "synthetic", language, project, pool);
      assert.equal(fs.readFileSync(path.join(project, "input.txt"), "utf8"), input);
      assert.equal(fs.existsSync(path.join(project, "index.scip")), false);
      if (input === "valid") {
        assert.equal(result.indexQuality, "precise"); assert.ok(result.symbolCount > 0);
        assert.ok(writes.some(sql => sql.startsWith("INSERT")));
      } else {
        assert.notEqual(result.indexQuality, "precise"); assert.equal(result.symbolCount, 0);
        assert.equal(writes.length, 0);
      }
    }
  } finally {
    process.env.PATH = previousPath; fs.rmSync(owned, { recursive: true, force: true });
  }
});
