import * as vscode from "vscode";
import { resolveEditorFile } from "./editorFileContext";
import { toRepositoryRelativePath } from "./repoFilePath";
import type { EditorContext } from "../manifest/types";
import type { RepoContext } from "../chat/types";

export function collectOpenEditorPaths(): string[] {
  const paths = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        const relative = vscode.workspace.asRelativePath(input.uri);
        if (relative && !relative.startsWith("..")) {
          paths.add(toRepositoryRelativePath(relative));
        }
      }
    }
  }
  return [...paths];
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
  if (editor && !next.file) {
    const resolved = resolveEditorFile(editor);
    if (resolved.file) {
      next.file = resolved.file;
      next.fileSource = resolved.fileSource;
    }
  }
  return next;
}
