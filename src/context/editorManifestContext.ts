import * as vscode from "vscode";
import { resolveEditorFile } from "./editorFileContext";
import { toRepositoryRelativePath } from "./repoFilePath";
import { parseGithubVfsUri } from "./githubVfsUri";
import type { EditorContext } from "../manifest/types";
import type { RepoContext } from "../chat/types";

export function collectOpenEditorPaths(): string[] {
  return collectOpenEditorFileRefs().map((ref) => ref.relativePath);
}

export type OpenEditorFileRef = {
  relativePath: string;
  absolutePath: string;
};

function mentionPathFromAbsolute(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath.replace(/\\/g, "/");
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      const suffix = normalized.slice(root.length).replace(/^\//, "");
      return `${folder.name}/${suffix}`;
    }
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-4).join("/");
}

/** Open text editor tabs with repo-relative paths (local disk and GitHub remote). */
export function collectOpenEditorFileRefs(): OpenEditorFileRef[] {
  const refs: OpenEditorFileRef[] = [];
  const seen = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) {
        continue;
      }

      if (input.uri.scheme === "file") {
        let relative = vscode.workspace.asRelativePath(input.uri);
        const absolutePath = input.uri.fsPath;
        if (!relative || relative.startsWith("..")) {
          relative = mentionPathFromAbsolute(absolutePath);
        }
        const relativePath = toRepositoryRelativePath(relative);
        if (seen.has(relativePath)) {
          continue;
        }
        seen.add(relativePath);
        refs.push({ relativePath, absolutePath: input.uri.fsPath });
        continue;
      }

      if (input.uri.scheme === "github" || input.uri.scheme === "vscode-vfs") {
        const remote = parseGithubVfsUri(input.uri.toString());
        if (!remote) {
          continue;
        }
        const relativePath = toRepositoryRelativePath(remote.file);
        if (seen.has(relativePath)) {
          continue;
        }
        seen.add(relativePath);
        refs.push({ relativePath, absolutePath: input.uri.toString() });
      }
    }
  }
  return refs;
}

export function selectedSymbolFromEditor(editor: vscode.TextEditor | undefined): string | undefined {
  if (!editor) {
    return undefined;
  }
  const document = editor.document;
  const position = editor.selection.active;
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/);
  if (!range || range.isEmpty) {
    return undefined;
  }
  return document.getText(range).trim() || undefined;
}

export function editorContextFromRepoContext(context: RepoContext): EditorContext {
  return {
    activeFile: context.file,
    openEditors: context.openEditors,
    selectedSymbol: context.selectedSymbol,
    selectedLines: context.selectedLines,
    languageId: context.languageId
  };
}

export function enrichRepoContextWithEditorState(
  context: RepoContext,
  editor: vscode.TextEditor | undefined
): RepoContext {
  const openEditors = collectOpenEditorPaths();
  const selectedSymbol = selectedSymbolFromEditor(editor);
  const next: RepoContext = {
    ...context,
    openEditors: openEditors.length ? openEditors : context.openEditors
  };
  if (selectedSymbol) {
    next.selectedSymbol = selectedSymbol;
  }
  return next;
}
