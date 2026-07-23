import * as fs from "node:fs";
import * as vscode from "vscode";
import type { RepoContext } from "../chat/types";
import { collectOpenEditorFileRefs } from "./editorManifestContext";
import {
  normalizeRelativePath,
  readWorkspaceFileFromAbsolutePath,
  sliceFileContent,
  type LocalFileContextPayload
} from "./localFileContext";
import { readWorkspaceFileFromDisk } from "./localFileResolver";

import { pathsReferToSameFile, isRemoteTabAbsolutePath } from "./githubVfsUri";

/** Read open editor tabs (including background remote tabs) for chat attach. */
export async function readOpenTabFilesForChat(ctx: {
  file?: string;
  selectedLines?: [number, number];
  /**
   * When true (remote explorer / codehost provenance), only read remote URI tabs.
   * Never fall through to local disk or workspace clones.
   */
  remoteOnly?: boolean;
}): Promise<LocalFileContextPayload | undefined> {
  const lines = ctx.selectedLines
    ? { start: ctx.selectedLines[0], end: ctx.selectedLines[1] }
    : undefined;
  const wantedPath = ctx.file?.trim() ? normalizeRelativePath(ctx.file) : undefined;
  const openRefs = collectOpenEditorFileRefs();
  const preferred = wantedPath
    ? openRefs.filter((ref) => pathsReferToSameFile(ref.relativePath, wantedPath))
    : openRefs;
  const orderedRefs = wantedPath
    ? [...preferred, ...openRefs.filter((ref) => !preferred.includes(ref))]
    : openRefs;

  for (const ref of orderedRefs) {
    if (wantedPath && !pathsReferToSameFile(ref.relativePath, wantedPath)) {
      continue;
    }

    const relativePath = normalizeRelativePath(ref.relativePath);
    let raw: string | undefined;

    if (isRemoteTabAbsolutePath(ref.absolutePath)) {
      try {
        raw = (await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.absolutePath))).getText();
      } catch {
        continue;
      }
    } else if (ctx.remoteOnly) {
      // Remote provenance: ignore local clone / workspace tabs for the same path.
      continue;
    } else if (fs.existsSync(ref.absolutePath)) {
      try {
        raw = (await vscode.workspace.openTextDocument(vscode.Uri.file(ref.absolutePath))).getText();
      } catch {
        const fromDisk = readWorkspaceFileFromAbsolutePath(ref.absolutePath, relativePath, lines);
        if (fromDisk?.files.length) {
          return fromDisk;
        }
        continue;
      }
    } else {
      continue;
    }

    if (!raw?.trim()) {
      continue;
    }

    const sliced = sliceFileContent(raw, lines);
    return {
      source: ctx.remoteOnly ? "remote-codehost" : "local-workspace",
      activeFile: relativePath,
      files: [
        {
          path: relativePath,
          content: sliced.content,
          encoding: "utf8",
          ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
        }
      ],
      fallbackLevel: "partial"
    };
  }

  if (wantedPath && !ctx.remoteOnly) {
    return readWorkspaceFileFromDisk(wantedPath, lines);
  }

  return undefined;
}
