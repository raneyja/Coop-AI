import { extractAgentSearchQuery } from "../api/agent/searchQuery";
import {
  LOCAL_FILE_MAX_FILES,
  normalizeRelativePath,
  type LocalFileContextPayload,
  type LocalFileSnippet
} from "../context/localFileContext";

const TEST_SUFFIX = /\.(test|spec)\.([^.]+)$/i;
const PY_TEST_SUFFIX = /_test\.([^.]+)$/i;

/** True when the open/chip path is a unit-test file, not the implementation. */
export function isTestSourcePath(filePath: string): boolean {
  const path = normalizeRelativePath(filePath);
  if (!path) {
    return false;
  }
  return TEST_SUFFIX.test(path) || PY_TEST_SUFFIX.test(path);
}

/**
 * authMiddleware.test.ts → authMiddleware.ts
 * foo.spec.tsx → foo.tsx
 * bar_test.py → bar.py
 */
export function siblingImplementationPath(testPath: string): string | undefined {
  const path = normalizeRelativePath(testPath);
  if (!path) {
    return undefined;
  }
  const fromDot = path.replace(TEST_SUFFIX, ".$2");
  if (fromDot !== path) {
    return fromDot;
  }
  const fromUnderscore = path.replace(PY_TEST_SUFFIX, ".$1");
  if (fromUnderscore !== path) {
    return fromUnderscore;
  }
  return undefined;
}

/** Sibling to fetch on /edit when the chip is a test file. */
export function sutPathForEditAsk(openFile: string | undefined): string | undefined {
  if (!openFile || !isTestSourcePath(openFile)) {
    return undefined;
  }
  return siblingImplementationPath(openFile);
}

/** Callee named in the ask (extractBearerToken), if any. */
export function namedCalleeForEditAsk(ask: string): string | undefined {
  const name = extractAgentSearchQuery(ask).trim();
  if (!name || /\s/.test(name)) {
    return undefined;
  }
  return name;
}

export function snippetDefinesSymbol(content: string, symbol: string | undefined): boolean {
  if (!symbol?.trim()) {
    return true;
  }
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^A-Za-z0-9_])(export\\s+)?(async\\s+)?(function|class|const|let|def|fn|func)\\s+${escaped}\\b`
  ).test(content);
}

export function mergeSutFile(
  payload: LocalFileContextPayload,
  sut: LocalFileSnippet
): LocalFileContextPayload {
  const sutPath = normalizeRelativePath(sut.path);
  if (payload.files.some((file) => normalizeRelativePath(file.path) === sutPath)) {
    return payload;
  }
  const files = [...payload.files, sut].slice(0, LOCAL_FILE_MAX_FILES);
  return { ...payload, files };
}

function parseExportedNumericConstants(source: string): Map<string, number> {
  const constants = new Map<string, number>();
  for (const match of source.matchAll(/export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9_]+)/g)) {
    const value = Number(match[2]?.replace(/_/g, ""));
    if (match[1] && Number.isFinite(value)) {
      constants.set(match[1], value);
    }
  }
  return constants;
}

function extractFunctionSignature(
  source: string,
  name: string
): { body: string; defaults: Map<string, string> } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`(?:export\\s+)?function\\s+${escaped}\\s*\\(`);
  const start = startRe.exec(source);
  if (!start || start.index === undefined) {
    return undefined;
  }
  let i = start.index + start[0].length;
  let depth = 1;
  let params = "";
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      depth += 1;
      params += ch;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
      params += ch;
      continue;
    }
    params += ch;
  }
  while (i < source.length && source[i] !== "{") {
    i += 1;
  }
  if (source[i] !== "{") {
    return undefined;
  }
  i += 1;
  const defaults = new Map<string, string>();
  for (const part of params.split(",")) {
    const def = part.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
    if (def?.[1] && def[2]) {
      defaults.set(def[1], def[2]);
    }
  }
  const bodyStart = i;
  depth = 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(bodyStart, i), defaults };
      }
    }
  }
  return undefined;
}

function evalRestrictedArithmetic(expr: string): number | undefined {
  const cleaned = expr.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 240) {
    return undefined;
  }
  if (!/^[0-9+\-*/()., Mathminax]+$/.test(cleaned)) {
    return undefined;
  }
  try {
    const value = Function(`"use strict"; return (${cleaned});`)();
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const MATH_CALLEES = new Set(["Math", "max", "min", "abs", "floor", "ceil", "round"]);

/**
 * Replace innermost `foo(args)` first so a nested helper inside Math.max
 * is not swallowed by the first close-paren.
 */
function replaceInnermostNamedCalls(
  expr: string,
  source: string,
  functionName: string,
  elapsedMs: number,
  depth: number
): string {
  const innermost = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g;
  let next = expr;
  for (let guard = 0; guard < 8; guard++) {
    let replaced = false;
    next = next.replace(innermost, (full, callee: string) => {
      if (MATH_CALLEES.has(callee) || callee.startsWith("Math") || callee === functionName) {
        return full;
      }
      const nested = evaluateNamedFunctionAtElapsedMs(source, callee, elapsedMs, depth + 1);
      if (nested === undefined) {
        return full;
      }
      replaced = true;
      return String(nested);
    });
    if (!replaced) {
      break;
    }
  }
  return next;
}

/**
 * Evaluate a named function in attached source at an elapsed time.
 * Substitutes exported numeric constants and `(now - startedAt)` — not a
 * one-function special case.
 */
export function evaluateNamedFunctionAtElapsedMs(
  source: string,
  functionName: string,
  elapsedMs: number,
  depth = 0
): number | undefined {
  if (depth > 4 || !functionName.trim()) {
    return undefined;
  }
  const parsed = extractFunctionSignature(source, functionName);
  if (!parsed) {
    return undefined;
  }
  const constants = parseExportedNumericConstants(source);
  let expr = parsed.body;
  for (const [param, ident] of parsed.defaults) {
    const value = constants.get(ident);
    if (value !== undefined) {
      expr = expr.replace(new RegExp(`\\b${param}\\b`, "g"), String(value));
    }
  }
  expr = expr.replace(/\(?\s*now\s*-\s*startedAt\s*\)?/g, String(elapsedMs));
  expr = expr.replace(/\(?\s*now\s*-\s*started\s*\)?/g, String(elapsedMs));
  expr = replaceInnermostNamedCalls(expr, source, functionName, elapsedMs, depth);
  for (const [name, value] of constants) {
    expr = expr.replace(new RegExp(`\\b${name}\\b`, "g"), String(value));
  }
  const maxZero = expr.match(/return\s+Math\.max\(\s*0\s*,\s*([^;]+?)\)\s*;?\s*$/s);
  if (maxZero?.[1]) {
    return evalRestrictedArithmetic(`Math.max(0, ${maxZero[1]})`);
  }
  const ret = expr.match(/return\s+([^;]+);/);
  if (ret?.[1]) {
    return evalRestrictedArithmetic(ret[1]);
  }
  return undefined;
}

function parseElapsedMsFromAsk(ask: string): number | undefined {
  const afterStart = ask.match(/(\d+)\s*seconds?\s+after\s+start/i);
  if (afterStart?.[1]) {
    return Number(afterStart[1]) * 1000;
  }
  const afterN = ask.match(/after\s+(\d+)\s*seconds?/i);
  if (afterN?.[1]) {
    return Number(afterN[1]) * 1000;
  }
  return undefined;
}

function sutSourceFromFiles(files: Array<{ path?: string; content?: string }>): string {
  return files
    .filter((file) => file.path && !isTestSourcePath(file.path) && file.content)
    .map((file) => file.content ?? "")
    .join("\n");
}

function functionNameForSutAsk(ask: string, sutBody: string): string | undefined {
  const named = namedCalleeForEditAsk(ask);
  if (named && sutBody.includes(named)) {
    return named;
  }
  const camel = ask.match(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/);
  if (camel?.[1] && sutBody.includes(camel[1])) {
    return camel[1];
  }
  return undefined;
}

/**
 * When /edit asks to assert a named function after N seconds, encode the
 * attached implementation — not the user's English number.
 */
export function sutAssertionGrounding(
  ask: string,
  files: Array<{ path?: string; content?: string }>
): string | undefined {
  const elapsedMs = parseElapsedMsFromAsk(ask);
  const sutBody = sutSourceFromFiles(files);
  const fn = functionNameForSutAsk(ask, sutBody);
  if (elapsedMs === undefined || !fn || !sutBody.includes(fn)) {
    return undefined;
  }
  const actual = evaluateNamedFunctionAtElapsedMs(sutBody, fn, elapsedMs);
  if (actual === undefined) {
    return undefined;
  }
  const claimsGtZero = /greater than zero|still\s*>\s*0|still positive/i.test(ask);
  return [
    `Attached SUT: ${fn} at elapsed ${elapsedMs}ms returns ${actual}.`,
    `Assert that number.`,
    claimsGtZero && actual === 0
      ? `If it is 0, do not copy “greater than zero” from the user ask.`
      : `If the user stated a different number, follow the attached implementation.`
  ].join(" ");
}

export type SutNumericExpectation = {
  functionName: string;
  elapsedMs: number;
  actual: number;
};

export function sutNumericExpectation(
  ask: string,
  files: Array<{ path?: string; content?: string }>
): SutNumericExpectation | undefined {
  const elapsedMs = parseElapsedMsFromAsk(ask);
  const sutBody = sutSourceFromFiles(files);
  const fn = functionNameForSutAsk(ask, sutBody);
  if (elapsedMs === undefined || !fn) {
    return undefined;
  }
  const actual = evaluateNamedFunctionAtElapsedMs(sutBody, fn, elapsedMs);
  if (actual === undefined) {
    return undefined;
  }
  return { functionName: fn, elapsedMs, actual };
}

/**
 * Rewrite a test REPLACE so assertions match the attached SUT.
 * Catches models that copy “greater than zero” when the implementation is 0.
 */
export function rewriteTestReplaceToMatchSut(replace: string, actual: number): string {
  let next = replace;
  if (actual === 0) {
    next = next.replace(
      /assert\.ok\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*>\s*0\s*\)/g,
      "assert.equal($1, 0)"
    );
    next = next.replace(
      /assert\.equal\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*>\s*0\s*,\s*true\s*\)/g,
      "assert.equal($1, 0)"
    );
  }
  next = next.replace(
    /assert\.equal\(\s*([^,]+?)\s*,\s*[A-Z][A-Z0-9_]*\s*-\s*[A-Z][A-Z0-9_]*\s*\)/g,
    (_full, expr: string) => `assert.equal(${expr.trim()}, ${actual})`
  );
  next = next.replace(
    /assert\.equal\(\s*(gather|left|remaining|budget)\s*,\s*[^)]+\)/gi,
    (_full, ident: string) => `assert.equal(${ident}, ${actual})`
  );
  next = next.replace(
    /assert\.equal\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*\d+\s*\)/g,
    (_full, ident: string) => `assert.equal(${ident}, ${actual})`
  );
  return next;
}

export function rewritePatchSetToMatchSut<
  T extends { files: Array<{ relativePath: string; hunks: Array<{ search: string; replace: string }> }> }
>(patches: T, actual: number): T {
  return {
    ...patches,
    files: patches.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        replace: isTestSourcePath(file.relativePath)
          ? rewriteTestReplaceToMatchSut(hunk.replace, actual)
          : hunk.replace
      }))
    }))
  };
}
