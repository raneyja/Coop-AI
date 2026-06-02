import assert from "node:assert/strict";
import { scoreManifest, topManifestPaths } from "./scoreManifest";
import type { EditorContext, ManifestFileEntry } from "./types";

const manifest: ManifestFileEntry[] = [
  {
    filePath: "src/auth/handler.ts",
    symbols: [{ name: "authenticate", kind: "function" }]
  },
  {
    filePath: "src/auth/token.ts",
    symbols: [{ name: "refreshToken", kind: "function" }]
  },
  {
    filePath: "src/billing/invoice.ts",
    symbols: [{ name: "createInvoice", kind: "function" }]
  }
];

const editor: EditorContext = {
  activeFile: "src/auth/handler.ts",
  openEditors: ["src/auth/token.ts"],
  selectedSymbol: "authenticate"
};

const ranked = topManifestPaths("how does authenticate work", editor, manifest, 3);
assert.deepEqual(ranked, ["src/auth/handler.ts", "src/auth/token.ts"]);

const billingRanked = topManifestPaths("billing invoice", {}, manifest, 3);
assert.equal(billingRanked[0], "src/billing/invoice.ts");

const scores = scoreManifest("authenticate handler", editor, manifest);
assert.ok(scores[0]!.score >= scores[1]!.score);

console.log("scoreManifest tests passed");
