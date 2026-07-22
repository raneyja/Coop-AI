import type { TextEditor } from "vscode";
import type { RepoContext, UserPreferences } from "../chat/types";
import { resolveEditorFile, type EditorFileSource } from "./editorFileContext";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

export type ActiveEditorIdentity = {
  file?: string;
  fileSource?: EditorFileSource;
  scope?: "file" | "repo";
  owner?: string;
  repo?: string;
  warning?: string;
  languageId?: string;
  selectedLines?: [number, number];
};

type IdentityPrefs = Pick<
  UserPreferences,
  "includeActiveFile" | "includeSelection" | "owner" | "repo" | "branch"
>;

/**
 * Single source of truth for the active editor's file identity.
 * Absolute paths for outside-workspace disk files are never stripped.
 */
export function resolveActiveEditorIdentity(
  editor: TextEditor | undefined,
  prefs: IdentityPrefs,
  previous: RepoContext = {}
): ActiveEditorIdentity {
  if (!editor) {
    return {
      owner: prefs.owner || previous.owner || undefined,
      repo: prefs.repo || previous.repo || undefined
    };
  }

  const identity: ActiveEditorIdentity = {
    owner: prefs.owner || previous.owner || undefined,
    repo: prefs.repo || previous.repo || undefined,
    languageId: editor.document.languageId
  };

  if (prefs.includeActiveFile) {
    const resolved = resolveEditorFile(editor);
    identity.file = preserveEditorFilePath(resolved.file, resolved.fileSource);
    identity.fileSource = resolved.fileSource;
    identity.warning = resolved.warning;
    if (resolved.owner && resolved.repo) {
      identity.owner = resolved.owner;
      identity.repo = resolved.repo;
    }
    if (identity.file?.trim()) {
      identity.scope = "file";
    }
  }

  if (prefs.includeSelection) {
    const selection = editor.selection;
    identity.selectedLines = selection.isEmpty
      ? undefined
      : [selection.start.line + 1, selection.end.line + 1];
  }

  return identity;
}

/** Keep absolute disk paths intact; leave repo-relative paths as resolved. */
export function preserveEditorFilePath(
  file: string | undefined,
  fileSource?: EditorFileSource
): string | undefined {
  const trimmed = file?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  if (fileSource === "external" || isOsAbsoluteDiskPath(normalized)) {
    if (/^Users\/|^home\//i.test(normalized)) {
      return `/${normalized}`;
    }
    return normalized;
  }
  return normalized.replace(/^\/+/, "");
}

export function isLocalEditorIdentity(fileSource: EditorFileSource | undefined): boolean {
  return (
    fileSource === "workspace" ||
    fileSource === "git" ||
    fileSource === "external" ||
    fileSource === undefined
  );
}

export function isRemoteEditorIdentity(fileSource: EditorFileSource | undefined): boolean {
  return fileSource === "remote";
}

/** Convert identity into RepoContext fields for merge / postContext. */
export function activeEditorIdentityToRepoContext(identity: ActiveEditorIdentity): RepoContext {
  return {
    owner: identity.owner,
    repo: identity.repo,
    file: identity.file,
    fileSource: identity.fileSource,
    contextWarning: identity.warning,
    languageId: identity.languageId,
    selectedLines: identity.selectedLines,
    scope: identity.scope
  };
}
