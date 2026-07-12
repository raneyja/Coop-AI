import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { detectIndentation, truncateOversizedImports } from "./edgeCases";
import type { ExtractedCodeContext } from "./types";

const MAX_LINE_PREFIX = 80;
const MAX_LINE_SUFFIX_ON_LINE = 80;
const MAX_SUFFIX_WINDOW_CHARS = 500;
const MAX_PREVIOUS_LINES = 10;
const MAX_PREVIOUS_CHARS = 1000;
const MAX_SIGNATURE_CHARS = 200;
const MAX_IMPORTS_CHARS = 500;

export function analyzeDocumentContext(
  document: vscode.TextDocument,
  position: vscode.Position
): ExtractedCodeContext {
  const offset = document.offsetAt(position);
  const fullText = document.getText();
  const lines = fullText.split(/\r?\n/);
  const lineIndex = position.line;
  const currentLine = lines[lineIndex] ?? "";
  const column = position.character;

  const currentLinePrefix = currentLine.slice(0, column).slice(-MAX_LINE_PREFIX);
  const currentLineSuffix = currentLine.slice(column);
  const suffixWindow = extractSuffixWindow(lines, lineIndex, column);

  const previousStart = Math.max(0, lineIndex - MAX_PREVIOUS_LINES);
  const previousSlice = lines.slice(previousStart, lineIndex);
  let previousLines = previousSlice.join("\n");
  if (previousLines.length > MAX_PREVIOUS_CHARS) {
    previousLines = previousLines.slice(-MAX_PREVIOUS_CHARS);
  }

  const importsBlock = truncateOversizedImports(extractImports(lines, document.languageId), MAX_IMPORTS_CHARS);
  const parentSignature = extractParentSignature(lines, lineIndex, document.languageId).slice(
    0,
    MAX_SIGNATURE_CHARS
  );
  const indent = detectIndentation(lines.slice(0, lineIndex + 1));

  const lexical = scanLexicalState(fullText, offset, document.languageId);

  const contextHash = hashContext({
    languageId: document.languageId,
    path: document.uri.fsPath,
    prefix: currentLinePrefix,
    previous: previousLines,
    suffix: suffixWindow,
    signature: parentSignature,
    imports: importsBlock,
    line: lineIndex,
    column
  });

  return {
    languageId: document.languageId,
    filePath: document.uri.fsPath,
    currentLinePrefix,
    currentLineSuffix,
    suffixWindow,
    previousLines,
    importsBlock,
    parentSignature,
    indent,
    cursorOffset: offset,
    contextHash,
    inComment: lexical.inComment,
    inString: lexical.inString,
    afterDot: endsWithPropertyAccess(currentLinePrefix),
    afterOpenParen: /[\(,]\s*$/.test(currentLinePrefix),
    riskySyntax: hasUnbalancedBrackets(fullText.slice(0, offset))
  };
}

export function buildPromptContextBlock(context: ExtractedCodeContext): string {
  const parts: string[] = [];
  if (context.importsBlock) {
    parts.push("IMPORTS:\n" + context.importsBlock);
  }
  if (context.parentSignature) {
    parts.push("SIGNATURE:\n" + context.parentSignature);
  }
  if (context.previousLines) {
    parts.push("SURROUNDING:\n" + context.previousLines);
  }
  parts.push(`CURRENT LINE:\n${context.currentLinePrefix}█${context.currentLineSuffix}`);
  return parts.join("\n\n");
}

export function autocompleteGroundingRules(context: ExtractedCodeContext): string {
  const lines = [
    "Use ONLY code supported by PREFIX, SUFFIX, IMPORTS, and SURROUNDING — no invented UI copy or assumptions.",
    "Do NOT invent string literals, toast messages, log text, or user-facing copy unless that exact literal already appears in context.",
    "Do NOT assume runtime state, user intent, or behavior not shown in the attached context.",
    "Do NOT copy or extend multi-line blocks from elsewhere in the file unless completing the current expression."
  ];
  if (context.afterDot) {
    lines.push(
      "After a dot: return ONLY the member identifier (optional `(`). No arguments, string literals, or semicolon."
    );
  }
  return lines.join(" ");
}

export function languageSpecificHints(context: ExtractedCodeContext): string {
  const id = context.languageId;
  if (id === "typescript" || id === "javascript" || id === "typescriptreact" || id === "javascriptreact") {
    if (context.afterDot) {
      return "Complete ONLY the member name after the dot (and optional opening paren). One line. No blocks, arguments, or new statements.";
    }
    return "Match TS/JS style from context only; do not invent messages or copy unrelated blocks.";
  }
  if (id === "python") {
    return "Respect indentation strictly; use 4-space blocks unless file uses otherwise.";
  }
  if (id === "java" || id === "csharp") {
    return "Include semicolons and respect access modifiers from signature.";
  }
  if (id === "sql") {
    return "Prefer JOIN/WHERE patterns; respect SQL dialect keywords in context.";
  }
  return "Match surrounding code style.";
}

function extractSuffixWindow(lines: string[], lineIndex: number, column: number): string {
  const currentLine = lines[lineIndex] ?? "";
  const onLine = currentLine.slice(column, column + MAX_LINE_SUFFIX_ON_LINE);
  const following = lines.slice(lineIndex + 1).join("\n");
  let window = onLine;
  if (following) {
    window += (onLine.length > 0 ? "\n" : "") + following;
  }
  if (window.length > MAX_SUFFIX_WINDOW_CHARS) {
    return window.slice(0, MAX_SUFFIX_WINDOW_CHARS);
  }
  return window;
}

function extractImports(lines: string[], languageId: string): string {
  const importLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (importLines.length > 0 && !isImportContinuation(languageId, trimmed)) {
        break;
      }
      continue;
    }
    if (isImportLine(languageId, trimmed)) {
      importLines.push(line);
    } else if (importLines.length > 0 && isImportContinuation(languageId, trimmed)) {
      importLines.push(line);
    } else if (importLines.length > 0) {
      break;
    }
  }
  return importLines.join("\n");
}

function isImportLine(languageId: string, trimmed: string): boolean {
  if (languageId === "python") {
    return trimmed.startsWith("import ") || trimmed.startsWith("from ");
  }
  return (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("from ") ||
    trimmed.startsWith("using ") ||
    trimmed.startsWith("#include")
  );
}

function isImportContinuation(languageId: string, trimmed: string): boolean {
  if (languageId === "python") {
    return trimmed.endsWith("\\") || trimmed.endsWith(",");
  }
  return trimmed.endsWith(",") || trimmed.endsWith("{");
}

function extractParentSignature(lines: string[], lineIndex: number, languageId: string): string {
  const signaturePatterns = [
    /^\s*(export\s+)?(async\s+)?function\s+\w+/,
    /^\s*(export\s+)?class\s+\w+/,
    /^\s*(public|private|protected).*\(.*\)\s*[:{]/,
    /^\s*def\s+\w+\s*\(/,
    /^\s*fun\s+\w+\s*\(/,
    /^\s*(export\s+)?interface\s+\w+/,
    /^\s*(export\s+)?type\s+\w+\s*=/
  ];

  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (signaturePatterns.some((pattern) => pattern.test(line))) {
      const block: string[] = [line];
      if (languageId === "python" && line.trim().endsWith(":")) {
        return block.join("\n");
      }
      if (!line.includes("{") && !line.includes(":")) {
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
          block.push(lines[j] ?? "");
          if ((lines[j] ?? "").includes("{")) {
            break;
          }
        }
      }
      return block.join("\n");
    }
  }
  return "";
}

function scanLexicalState(
  text: string,
  offset: number,
  languageId: string
): { inComment: boolean; inString: boolean } {
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | false = false;
  const lineComment = languageId === "python" ? "#" : "//";
  const blockOpen = "/*";
  const blockClose = "*/";

  for (let i = 0; i < offset && i < text.length; i += 1) {
    const rest = text.slice(i);
    if (inBlockComment) {
      if (rest.startsWith(blockClose)) {
        inBlockComment = false;
        i += blockClose.length - 1;
      }
      continue;
    }
    if (inString) {
      if (text[i] === "\\") {
        i += 1;
        continue;
      }
      if (text[i] === inString) {
        inString = false;
      }
      continue;
    }
    if (inLineComment) {
      if (text[i] === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (rest.startsWith(blockOpen)) {
      inBlockComment = true;
      i += blockOpen.length - 1;
      continue;
    }
    if (rest.startsWith(lineComment)) {
      inLineComment = true;
      i += lineComment.length - 1;
      continue;
    }
    if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
      inString = text[i];
    }
  }

  return { inComment: inLineComment || inBlockComment, inString: Boolean(inString) };
}

function endsWithPropertyAccess(prefix: string): boolean {
  return /\.[A-Za-z_$][\w$]*$/.test(prefix) || /\.\s*$/.test(prefix);
}

function hasUnbalancedBrackets(text: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let inString = false;
  let quote = "";

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === quote && text[i - 1] !== "\\") {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const expected = pairs[ch];
      if (stack.pop() !== expected) {
        return true;
      }
    }
  }
  return stack.length > 0;
}

function hashContext(parts: Record<string, string | number>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function wantsMultiLineCompletion(context: ExtractedCodeContext): boolean {
  const prefix = context.currentLinePrefix;
  if (/{\s*$/.test(prefix)) {
    return true;
  }
  if (/=>\s*$/.test(prefix)) {
    return true;
  }
  if (/[\(,]\s*$/.test(prefix)) {
    return true;
  }
  if (isEmptyLineInsideBlock(context)) {
    return true;
  }
  return false;
}

function isEmptyLineInsideBlock(context: ExtractedCodeContext): boolean {
  if (context.currentLinePrefix.trim() !== "") {
    return false;
  }
  if (context.currentLinePrefix.length === 0) {
    return false;
  }
  let braceDepth = 0;
  for (const ch of context.previousLines) {
    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
    }
  }
  if (braceDepth > 0) {
    return true;
  }
  const lines = context.previousLines.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (context.languageId === "python" && /:\s*$/.test(lastLine.trim())) {
    return true;
  }
  return false;
}

export function isFileEligible(document: vscode.TextDocument): boolean {
  const path = document.uri.fsPath;
  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return false;
  }
  if (path.includes("node_modules") || path.includes("/dist/") || path.includes("\\dist\\")) {
    return false;
  }
  if (document.languageId === "markdown" || document.languageId === "plaintext") {
    return false;
  }
  if (/\.test\.(ts|tsx|js|jsx)$/i.test(path)) {
    return true;
  }
  const sizeLimit = 10 * 1024 * 1024;
  if (document.getText().length > sizeLimit) {
    return false;
  }
  return true;
}
