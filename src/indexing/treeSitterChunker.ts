import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(__filename);

/** ~512 tokens at ~4 chars/token. */
export const MAX_CHUNK_CHARS = 2048;
export const MIN_CHUNK_CHARS = 80;

const TREE_SITTER_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".rb"
]);

const TEXT_EXTENSIONS = new Set([
  ...TREE_SITTER_EXTENSIONS,
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".rs",
  ".cpp",
  ".cc",
  ".c",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".kts",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".dockerfile",
  ".vue",
  ".svelte",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".xml",
  ".txt"
]);

const WASM_BY_EXTENSION: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".py": "tree-sitter-python.wasm",
  ".go": "tree-sitter-go.wasm",
  ".java": "tree-sitter-java.wasm",
  ".rb": "tree-sitter-ruby.wasm"
};

const CHUNK_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "method_definition",
  "class_declaration",
  "class_definition",
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
  "module",
  "program",
  "source_file",
  "compilation_unit"
]);

export type TextChunk = {
  filePath: string;
  chunkIndex: number;
  text: string;
  lineStart: number;
  lineEnd: number;
};

let parserReady: Promise<void> | undefined;
const languageCache = new Map<string, unknown>();

export function listEmbeddableFiles(localPath: string): string[] {
  const files: string[] = [];
  const stack = [localPath];
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
      } else if (isEmbeddableFile(fullPath)) {
        files.push(path.relative(localPath, fullPath).replace(/\\/g, "/"));
      }
    }
  }
  return files;
}

export async function chunkFileSource(filePath: string, source: string): Promise<TextChunk[]> {
  const ext = path.extname(filePath).toLowerCase();
  const segments =
    TREE_SITTER_EXTENSIONS.has(ext) && source.trim().length > 0
      ? await chunkWithTreeSitter(filePath, source, ext)
      : splitByLines(source);
  return finalizeChunks(filePath, segments);
}

async function chunkWithTreeSitter(
  filePath: string,
  source: string,
  ext: string
): Promise<Array<{ text: string; lineStart: number; lineEnd: number }>> {
  try {
    await ensureParserReady();
    const Parser = (await import("web-tree-sitter")).default;
    const language = await loadLanguage(ext);
    const parser = new Parser();
    parser.setLanguage(language as never);
    const tree = parser.parse(source);
    const segments: Array<{ text: string; lineStart: number; lineEnd: number }> = [];
    collectChunkSegments(tree.rootNode as SyntaxNode, source, segments);
    tree.delete();
    if (segments.length > 0) {
      return segments;
    }
  } catch {
    // Fall back to line splitting for parse failures or unsupported grammars.
  }
  return splitByLines(source);
}

function collectChunkSegments(
  node: SyntaxNode,
  source: string,
  segments: Array<{ text: string; lineStart: number; lineEnd: number }>
): void {
  if (CHUNK_NODE_TYPES.has(node.type) && node.type !== "program" && node.type !== "source_file") {
    const text = source.slice(node.startIndex, node.endIndex).trim();
    if (text.length >= MIN_CHUNK_CHARS) {
      segments.push({
        text,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1
      });
      return;
    }
  }

  for (let i = 0; i < node.childCount; i += 1) {
    collectChunkSegments(node.child(i), source, segments);
  }

  if (
    segments.length === 0 &&
    (node.type === "program" || node.type === "source_file" || node.type === "module")
  ) {
    const text = source.slice(node.startIndex, node.endIndex).trim();
    if (text.length >= MIN_CHUNK_CHARS) {
      segments.push({
        text,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1
      });
    }
  }
}

function splitByLines(source: string): Array<{ text: string; lineStart: number; lineEnd: number }> {
  const lines = source.split(/\r?\n/);
  const segments: Array<{ text: string; lineStart: number; lineEnd: number }> = [];
  let buffer: string[] = [];
  let lineStart = 1;

  const flush = (lineEnd: number) => {
    const text = buffer.join("\n").trim();
    if (text.length >= MIN_CHUNK_CHARS) {
      segments.push({ text, lineStart, lineEnd });
    }
    buffer = [];
    lineStart = lineEnd + 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const candidate = buffer.length > 0 ? `${buffer.join("\n")}\n${line}` : line;
    if (candidate.length > MAX_CHUNK_CHARS && buffer.length > 0) {
      flush(i);
      buffer.push(line);
      continue;
    }
    buffer.push(line);
    if (candidate.length >= MAX_CHUNK_CHARS) {
      flush(i + 1);
    }
  }

  if (buffer.length > 0) {
    flush(lines.length);
  }
  return segments;
}

function finalizeChunks(
  filePath: string,
  segments: Array<{ text: string; lineStart: number; lineEnd: number }>
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  for (const segment of segments) {
    for (const text of splitOversizedText(segment.text)) {
      if (text.trim().length < MIN_CHUNK_CHARS) {
        continue;
      }
      chunks.push({
        filePath,
        chunkIndex,
        text: text.trim(),
        lineStart: segment.lineStart,
        lineEnd: segment.lineEnd
      });
      chunkIndex += 1;
    }
  }
  return chunks;
}

function splitOversizedText(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += MAX_CHUNK_CHARS) {
    parts.push(text.slice(offset, offset + MAX_CHUNK_CHARS));
  }
  return parts;
}

type SyntaxNode = {
  type: string;
  startIndex: number;
  endIndex: number;
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

function isEmbeddableFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === "Dockerfile" || base === "Makefile") {
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

export function isEmbeddablePath(filePath: string): boolean {
  return isEmbeddableFile(filePath);
}
