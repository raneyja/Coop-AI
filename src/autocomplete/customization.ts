import * as vscode from "vscode";
import type { ExtractedCodeContext, RankedCompletion } from "./types";

export type ProjectStyleProfile = {
  prefersAsyncAwait: boolean;
  commonImports: string[];
  commonIdentifiers: string[];
};

const profileCache = new Map<string, { profile: ProjectStyleProfile; at: number }>();
const PROFILE_TTL_MS = 5 * 60_000;

export function getProjectStyleProfile(folder: vscode.WorkspaceFolder | undefined): ProjectStyleProfile {
  const key = folder?.uri.fsPath ?? "__global__";
  const cached = profileCache.get(key);
  if (cached && Date.now() - cached.at < PROFILE_TTL_MS) {
    return cached.profile;
  }
  const profile = buildProfileFromWorkspace(folder);
  profileCache.set(key, { profile, at: Date.now() });
  return profile;
}

export function biasCompletionsWithProjectStyle(
  completions: RankedCompletion[],
  context: ExtractedCodeContext,
  profile: ProjectStyleProfile
): RankedCompletion[] {
  return completions
    .map((item) => {
      let score = item.score;
      if (profile.prefersAsyncAwait && /\bawait\b/.test(item.text)) {
        score += 0.05;
      }
      if (!profile.prefersAsyncAwait && /\.then\s*\(/.test(item.text)) {
        score -= 0.05;
      }
      for (const id of profile.commonIdentifiers) {
        if (item.text.includes(id)) {
          score += 0.03;
        }
      }
      for (const imp of profile.commonImports) {
        if (context.importsBlock.includes(imp) && item.text.includes(imp.split("/").pop() ?? imp)) {
          score += 0.04;
        }
      }
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function resolveImportHint(context: ExtractedCodeContext, identifier: string): string | undefined {
  const lines = context.importsBlock.split("\n");
  for (const line of lines) {
    if (line.includes(identifier)) {
      return line.trim();
    }
  }
  return undefined;
}

function buildProfileFromWorkspace(folder: vscode.WorkspaceFolder | undefined): ProjectStyleProfile {
  const commonImports: string[] = [];
  const commonIdentifiers: string[] = [];
  let asyncCount = 0;
  let thenCount = 0;

  if (!folder) {
    return { prefersAsyncAwait: true, commonImports, commonIdentifiers };
  }

  const config = vscode.workspace.getConfiguration("coopAI.autocomplete", folder.uri);
  const extraImports = config.get<string[]>("projectImports", []);
  commonImports.push(...extraImports);

  const editors = vscode.window.visibleTextEditors.filter(
    (editor) => editor.document.uri.fsPath.startsWith(folder.uri.fsPath)
  );

  for (const editor of editors.slice(0, 3)) {
    const text = editor.document.getText().slice(0, 8000);
    asyncCount += (text.match(/\bawait\b/g) ?? []).length;
    thenCount += (text.match(/\.then\s*\(/g) ?? []).length;
    extractImportPaths(text).forEach((value) => {
      if (!commonImports.includes(value)) {
        commonImports.push(value);
      }
    });
    extractCommonIdentifiers(text).forEach((value) => {
      if (!commonIdentifiers.includes(value)) {
        commonIdentifiers.push(value);
      }
    });
  }

  return {
    prefersAsyncAwait: asyncCount >= thenCount,
    commonImports: commonImports.slice(0, 20),
    commonIdentifiers: commonIdentifiers.slice(0, 30)
  };
}

function extractImportPaths(text: string): string[] {
  const paths: string[] = [];
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(text)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

function extractCommonIdentifiers(text: string): string[] {
  const counts = new Map<string, number>();
  const idRegex = /\b([a-z][a-zA-Z0-9]{2,})\b/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(text)) !== null) {
    const id = match[1];
    if (["const", "return", "async", "await", "function", "class"].includes(id)) {
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
}

export function invalidateProjectProfile(folder?: vscode.WorkspaceFolder): void {
  const key = folder?.uri.fsPath ?? "__global__";
  profileCache.delete(key);
}
