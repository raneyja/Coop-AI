import assert from "node:assert/strict";
import test from "node:test";
import { groundBlastSourceCitations, validateBlastSourceCitations } from "./blastRadiusSourceGuard";
import { splitMarkdownBlocks } from "./markdownProse";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import type { BlastRadiusSourceFile } from "../context/blastRadiusSourceEvidence";

function source(path: string, content: string, startLine = 1): BlastRadiusSourceFile {
  return { path, content, startLine, endLine: startLine + content.split("\n").length - 1,
    repoId: "github:org/project", branch: "release", role: "target", truncated: false };
}
function cite(code: string, info = "1:3:src/action.ts", fence = "```"): string {
  return fence + info + "\n" + code + "\n" + fence;
}

test("exact source is preserved across languages, comments, whitespace and blank lines", () => {
  for (const [path, code] of [
    ["src/action.ts", "return\n  /a b/.test(value);\n// trailing comment  "],
    ["src/action.py", "if ready:\n\n    persist()"],
    ["src/action.go", "if ready {\n\tpersist()\n}"],
    ["src/action.sql", "SELECT 'a b'\n\nFROM actions;"]
  ]) {
    const input = cite(code, "1:3:" + path);
    const checked = validateBlastSourceCitations(input, { sourceFiles: [source(path, code)] });
    assert.equal(checked.invalidCount, 0, path);
    assert.equal(checked.verifiedCount, 1, path);
    assert.equal(checked.content, input, path);
  }
});

test("operators, strings, comments, indentation, blank lines and ASI cannot be reconstructed", () => {
  const code = "if (ready !== false) {\n  persist('a b');\n\n  // keep this condition\n}";
  const evidence = { sourceFiles: [source("src/action.ts", code)] };
  for (const changed of [
    code.replace("!==", "==="), code.replace("a b", "ab"), code.replace("  persist", "persist"),
    code.replace("\n\n", "\n"), code.replace("// keep this condition", "// changed"),
    code.replace("  persist('a b');", "  persist(\"a b\");")
  ]) {
    const checked = validateBlastSourceCitations(cite(changed, "1:5:src/action.ts"), evidence);
    assert.equal(checked.invalidCount, 1);
    assert.equal(checked.verifiedCount, 0);
    assert.doesNotMatch(checked.content, /```/);
  }
  const asi = { sourceFiles: [source("src/action.ts", "return\n  /a b/.test(value);")] };
  assert.equal(validateBlastSourceCitations(cite("return /a b/.test(value);", "1:2:src/action.ts"), asi).invalidCount, 1);
});

test("line metadata repair needs a unique exact span or the full correct claimed span", () => {
  const code = "if ready:\n    persist()";
  const evidence = { sourceFiles: [source("src/action.py", code, 18)] };
  assert.equal(groundBlastSourceCitations(cite(code, "1:2:src/action.py"), evidence), cite(code, "18:19:src/action.py"));
  const repeated = { sourceFiles: [source("src/action.py", code + "\n\n" + code)] };
  assert.equal(validateBlastSourceCitations(cite(code, "99:100:src/action.py"), repeated).invalidCount, 1);
  assert.equal(validateBlastSourceCitations(cite(code, "1:2:src/action.py"), repeated).verifiedCount, 1);
  assert.equal(validateBlastSourceCitations(cite(code, "1:99:src/action.py"), repeated).invalidCount, 1);
});

test("unopened paths, duplicate files and mixed repository/ref identities fail closed", () => {
  const body = "persist();", file = source("src/action.ts", body);
  for (const files of [
    [], [source("src/other.ts", body)], [file, { ...file }],
    [file, { ...source("src/other.ts", body), repoId: "github:other/project" }],
    [file, { ...source("src/other.ts", body), branch: "other-ref" }],
    [{ ...file, repoId: "" }]
  ]) {
    assert.equal(validateBlastSourceCitations(cite(body, "1:1:src/action.ts"), { sourceFiles: files }).invalidCount, 1);
  }
});

test("long and tilde fences keep literal fence lines within exact source", () => {
  const code = "const text = `\n```\nexample\n```\n`;";
  for (const fence of ["````", "~~~~"]) {
    const checked = validateBlastSourceCitations(cite(code, "1:5:src/action.ts", fence),
      { sourceFiles: [source("src/action.ts", code)] });
    assert.equal(checked.invalidCount, 0);
    const blocks = splitMarkdownBlocks(checked.content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "code");
    if (blocks[0].kind === "code") {
      assert.equal(blocks[0].closed, true);
      assert.equal(blocks[0].body.replace(/\n$/, ""), code);
    }
  }
});

test("CRLF source bytes and a leading/trailing source blank line remain exact", () => {
  for (const code of ["if ready {\r\n\r\n\tpersist()\r\n}\r", "\nif ready:\n    persist()\n"]) {
    const path = "src/action.txt", file = source(path, code);
    const checked = validateBlastSourceCitations(cite(code, "1:" + file.endLine + ":" + path), { sourceFiles: [file] });
    assert.equal(checked.invalidCount, 0);
    const block = splitMarkdownBlocks(checked.content).find(b => b.kind === "code");
    assert.ok(block?.kind === "code");
    assert.equal(block.body.replace(/\n$/, ""), code);
  }
});

test("malformed, empty and unfinished explicit citations fail; anonymous examples stay anonymous", () => {
  const evidence: BlastRadiusEvidence = { sourceFiles: [source("src/action.ts", "persist();")] };
  for (const content of [
    cite("persist();", "0:1:src/action.ts"), cite("persist();", "4:2:src/action.ts"),
    cite("", "1:1:src/action.ts"), "````1:1:src/action.ts\npersist();",
    cite("0:1:src/action.ts\npersist();", "typescript")
  ]) assert.equal(validateBlastSourceCitations(content, evidence).invalidCount, 1, content);
  const anonymous = cite("persist('example');", "typescript");
  assert.deepEqual(validateBlastSourceCitations(anonymous, evidence),
    { content: anonymous, invalidCount: 0, verifiedCount: 0, windows: [{ path: "src/action.ts", content: "persist();", startLine: 1 }] });
});

test("first-body numeric citation is verified without treating arbitrary source paths as metadata", () => {
  const code = "const path = 'src/other.ts';\npersist();";
  const checked = validateBlastSourceCitations(cite("1:2:src/action.ts\n" + code, "typescript"),
    { sourceFiles: [source("src/action.ts", code)] });
  assert.equal(checked.verifiedCount, 1);
  assert.equal(checked.content, cite(code, "1:2:src/action.ts"));
});
