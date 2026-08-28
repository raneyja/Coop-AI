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
