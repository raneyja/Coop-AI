#!/usr/bin/env node
// Exact maintenance-source metrics. This script is never a customer repo reader.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";

const root = path.resolve(process.argv[2] ?? ".");
const roots = ["src", "admin/src", "ops/src", "website/src", "scripts", "migrations"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css"]);
const files = [], functions = [], imports = [], totals = {};
function visit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".next", ".git"].includes(entry.name)) visit(name);
    } else if (entry.isFile() && extensions.has(path.extname(name)) && !/ \d+\./.test(entry.name)) {
      const relative = path.relative(root, name).split(path.sep).join("/");
      const text = fs.readFileSync(name, "utf8");
      const lines = text.length === 0 ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
      const kind = /\.(test|spec|fixture)\./.test(entry.name) ? "test" : relative.startsWith("scripts/") || relative.startsWith("migrations/") ? "support" : "source";
      const row = { path: relative, kind, lines, sha256: crypto.createHash("sha256").update(text).digest("hex") };
      files.push(row);
      totals[kind] ??= { files: 0, lines: 0 };
      totals[kind].files++; totals[kind].lines += lines;
      if (/\.[cm]?[jt]sx?$/.test(name)) {
        const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
        function scan(node) {
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ from: relative, module: node.moduleSpecifier.text });
          }
          if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
            const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
            functions.push({ path: relative, line: start, name: node.name?.getText(source) ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : "anonymous"), lines: end - start + 1 });
          }
          ts.forEachChild(node, scan);
        }
        scan(source);
      }
    }
  }
}
for (const dir of roots) visit(path.join(root, dir));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
process.stdout.write(JSON.stringify({
  definition: { version: 1, roots, extensions: [...extensions], lines: "physical UTF-8 text lines including blanks/comments; terminal newline does not add a line", exclusions: "dependencies, generated output, assets, docs, numbered duplicate files; test/spec/fixture files separate", historicComparison: "New explicitly fixed corpus; historical audit had a different test/support classification. Compare before/after from this script only." },
  totals, files: files.sort((a, b) => a.path.localeCompare(b.path)),
  largestFunctions: functions.sort((a, b) => b.lines - a.lines).slice(0, 40),
  staticImports: imports,
  dynamicEntrypoints: { extensionMain: pkg.main, activationEvents: pkg.activationEvents, commands: pkg.contributes?.commands?.map(c => c.command), scripts: pkg.scripts, limitation: "Inventory leads only; runtime routes/jobs/registrations and supported behavior must be inspected for every deletion." }
}, null, 2) + "\n");
