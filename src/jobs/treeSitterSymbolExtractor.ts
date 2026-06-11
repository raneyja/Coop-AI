import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SymbolIndexKind, SymbolIndexRow } from "../indexing/repoSymbolIndexStore";

const require = createRequire(__filename);

const SYMBOL_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb"]);

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

export async function extractTreeSitterSymbols(localPath: string): Promise<SymbolIndexRow[]> {
  const rows: SymbolIndexRow[] = [];
  const files = walkRepoFiles(localPath);

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SYMBOL_EXTENSIONS.has(ext)) {
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(path.join(localPath, filePath), "utf8");
    } catch {
      continue;
    }

    const symbols = await extractSymbolsFromSource(filePath, source);
    for (const symbol of symbols) {
      rows.push({
        symbol: symbol.name,
        filePath,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd,
        kind: symbol.kind,
        references: []
      });
    }
  }

  return rows;
}

type ExtractedSymbol = {
  name: string;
  kind: SymbolIndexKind;
  lineStart: number;
  lineEnd: number;
};

async function extractSymbolsFromSource(filePath: string, source: string): Promise<ExtractedSymbol[]> {
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
  const symbols: ExtractedSymbol[] = [];
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
    const key = `${kind}:${name}:${node.startPosition.row}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    symbols.push({
      name,
      kind,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1
    });
  });

  tree.delete();
  return symbols;
}

type SyntaxNode = {
  type: string;
  text: string;
  childCount: number;
  child(index: number): SyntaxNode;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
};

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
      const nested = symbolNameFromNode(child);
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
      const nested = symbolNameFromNode(child);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function symbolKindFromNode(nodeType: string): SymbolIndexKind {
  if (nodeType === "class_declaration" || nodeType === "class_definition") {
    return "class";
  }
  if (nodeType === "method_definition") {
    return "function";
  }
  return "function";
}

function walkRepoFiles(root: string): string[] {
  const files: string[] = [];
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
        files.push(path.relative(root, fullPath).replace(/\\/g, "/"));
      }
    }
  }
  return files;
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SYMBOL_EXTENSIONS.has(ext);
}
