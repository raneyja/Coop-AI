import * as vscode from "vscode";
import type { CodeHostProviderPreference } from "../chat/types";
import { parseGithubVfsUri } from "../context/githubVfsUri";
import { isOsAbsoluteDiskPath } from "../context/outsideWorkspaceFile";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import {
  listRememberedRemoteBuffers,
  rememberedRemoteBufferForUri,
  type RememberedRemoteBuffer
} from "./patchTarget";

export type UseRepoForEditorPr = {
  owner: string;
  repo: string;
  provider?: CodeHostProviderPreference;
  branch?: string;
};

export type CollectEditorPrDoc = {
  uriString: string;
  scheme: string;
  fsPath?: string;
  text: string;
  isDirty?: boolean;
};

export type EditorPrFile = {
  path: string;
  content: string;
  baseline?: string;
};

export type WorkingCopySnapshot = {
  path: string;
  uriString: string;
  baseline: string;
  owner?: string;
  repo?: string;
};

const snapshots = new Map<string, WorkingCopySnapshot>();

export function normalizeWorkingCopyText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function normalizePath(relativePath: string): string {
  return (toRepositoryRelativePath(relativePath) ?? relativePath).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function snapshotKey(path: string, identity?: { owner?: string; repo?: string }): string {
  const owner = identity?.owner?.trim().toLowerCase() ?? "";
  const repo = identity?.repo?.trim().toLowerCase() ?? "";
  return owner && repo ? `${owner}/${repo}:${path}` : path;
}

export function snapshotWorkingCopyIfAbsent(
  relativePath: string,
  uriString: string,
  baseline: string,
  identity?: { owner?: string; repo?: string }
): void {
  const path = normalizePath(relativePath);
  if (!path || isOsAbsoluteDiskPath(path)) {
    return;
  }
  const key = snapshotKey(path, identity);
  if (snapshots.has(key)) {
    return;
  }
  snapshots.set(key, {
    path,
    uriString,
    baseline,
    owner: identity?.owner?.trim() || undefined,
    repo: identity?.repo?.trim() || undefined
  });
}

export function clearWorkingCopySnapshotsForTests(): void {
  snapshots.clear();
}

export function listWorkingCopySnapshotsForTests(): WorkingCopySnapshot[] {
  return [...snapshots.values()];
}

function identityMatches(
  identity: { owner?: string; repo?: string } | undefined,
  useRepo: UseRepoForEditorPr
): boolean {
  if (!identity?.owner?.trim() || !identity?.repo?.trim()) {
    return true;
  }
  return (
    identity.owner.trim().toLowerCase() === useRepo.owner.trim().toLowerCase() &&
    identity.repo.trim().toLowerCase() === useRepo.repo.trim().toLowerCase()
  );
}

function lookupSnapshot(
  path: string,
  useRepo: UseRepoForEditorPr,
  uriString?: string
): WorkingCopySnapshot | undefined {
  const keyed = snapshots.get(snapshotKey(path, useRepo));
  if (keyed && identityMatches(keyed, useRepo)) {
    return keyed;
  }
  const loose = snapshots.get(path);
  if (loose && identityMatches(loose, useRepo)) {
    return loose;
  }
  for (const snap of snapshots.values()) {
    if (snap.path !== path) {
      continue;
    }
    if (uriString && snap.uriString === uriString) {
      return snap;
    }
    if (identityMatches(snap, useRepo)) {
      return snap;
    }
  }
  return undefined;
}

function mapDocumentToUseRepoPath(
  doc: CollectEditorPrDoc,
  useRepo: UseRepoForEditorPr,
  localDiskMatchesUseRepo: boolean
): { path: string; identity?: { owner: string; repo: string } } | undefined {
  const scheme = doc.scheme.toLowerCase();
  if (scheme === "vscode-vfs" || scheme === "github") {
    const parsed = parseGithubVfsUri(doc.uriString);
    if (!parsed?.file || !identityMatches(parsed, useRepo)) {
      return undefined;
    }
    return { path: normalizePath(parsed.file), identity: { owner: parsed.owner, repo: parsed.repo } };
  }
  if (scheme === "untitled") {
    return undefined;
  }
  if (scheme === "file") {
    if (!localDiskMatchesUseRepo) {
      return undefined;
    }
    const rel = toRepositoryRelativePath(doc.fsPath ?? doc.uriString);
    if (!rel || isOsAbsoluteDiskPath(rel)) {
      return undefined;
    }
    return { path: normalizePath(rel) };
  }
  return undefined;
}

const MAX_DIFF_CHARS = 4000;
const MAX_DIFF_LINES = 80;

export function compactWorkingCopyDiff(files: readonly EditorPrFile[]): string {
  const sections: string[] = [];
  for (const file of files) {
    if (file.baseline === undefined) {
      sections.push(`${file.path}\n(editor changes)`);
      continue;
    }
    const oldLines = normalizeWorkingCopyText(file.baseline).split("\n");
    const newLines = normalizeWorkingCopyText(file.content).split("\n");
    const lines: string[] = [];
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max && lines.length < MAX_DIFF_LINES; i++) {
      const previous = oldLines[i];
      const next = newLines[i];
      if (previous === next) {
        continue;
      }
      if (previous !== undefined) {
        lines.push(`- ${previous}`);
      }
      if (next !== undefined) {
        lines.push(`+ ${next}`);
      }
    }
    sections.push(lines.length ? `${file.path}\n${lines.join("\n")}` : `${file.path}\n(editor changes)`);
  }
  const joined = sections.join("\n\n").trim();
  if (joined.length <= MAX_DIFF_CHARS) {
    return joined;
  }
  return `${joined.slice(0, MAX_DIFF_CHARS - 1).trimEnd()}…`;
}

export type CollectEditorPrFilesFromDocsOptions = {
  useRepo: UseRepoForEditorPr;
  documents: readonly CollectEditorPrDoc[];
  remembered?: ReadonlyArray<{ path: string } & RememberedRemoteBuffer>;
  localDiskMatchesUseRepo?: boolean;
  remoteBaselines?: Readonly<Record<string, string>>;
};

export type CollectEditorPrFilesFromDocsResult = {
  files: EditorPrFile[];
  needsRemote: string[];
};

function considerFile(
  byPath: Map<string, EditorPrFile>,
  needsRemote: Set<string>,
  params: {
    path: string;
    content: string;
    baseline?: string;
    isDirty?: boolean;
    identity?: { owner?: string; repo?: string };
    useRepo: UseRepoForEditorPr;
  }
): void {
  const path = normalizePath(params.path);
  if (!path || !params.content.length || isOsAbsoluteDiskPath(path)) {
    return;
  }
  if (!identityMatches(params.identity, params.useRepo)) {
    return;
  }
  if (params.baseline !== undefined) {
    if (normalizeWorkingCopyText(params.content) === normalizeWorkingCopyText(params.baseline)) {
      return;
    }
    byPath.set(path, { path, content: params.content, baseline: params.baseline });
    return;
  }
  if (params.isDirty) {
    byPath.set(path, { path, content: params.content });
    return;
  }
  needsRemote.add(path);
}

export function collectEditorPrFilesFromDocs(
  options: CollectEditorPrFilesFromDocsOptions
): CollectEditorPrFilesFromDocsResult {
  const byPath = new Map<string, EditorPrFile>();
  const needsRemote = new Set<string>();
  const localDiskMatchesUseRepo = options.localDiskMatchesUseRepo === true;
  const remoteBaselines = options.remoteBaselines ?? {};
  const remembered = options.remembered ?? [];

  for (const entry of remembered) {
    const live = options.documents.find((doc) => doc.uriString === entry.uriString);
    if (!live) {
      continue;
    }
    const path = normalizePath(entry.path);
    const snap = lookupSnapshot(path, options.useRepo, entry.uriString);
    considerFile(byPath, needsRemote, {
      path,
      content: live.text,
      baseline: snap?.baseline ?? remoteBaselines[path] ?? entry.content,
      isDirty: live.isDirty,
      identity: { owner: entry.owner, repo: entry.repo },
      useRepo: options.useRepo
    });
  }

  for (const doc of options.documents) {
    const mapped = mapDocumentToUseRepoPath(doc, options.useRepo, localDiskMatchesUseRepo);
    if (!mapped) {
      continue;
    }
    const snap = lookupSnapshot(mapped.path, options.useRepo, doc.uriString);
    considerFile(byPath, needsRemote, {
      path: mapped.path,
      content: doc.text,
      baseline: snap?.baseline ?? remoteBaselines[mapped.path],
      isDirty: doc.isDirty,
      identity: mapped.identity,
      useRepo: options.useRepo
    });
  }

  return { files: [...byPath.values()], needsRemote: [...needsRemote] };
}

function documentToCollectDoc(doc: vscode.TextDocument): CollectEditorPrDoc {
  return {
    uriString: doc.uri.toString(),
    scheme: doc.uri.scheme,
    fsPath: doc.uri.scheme === "file" ? doc.uri.fsPath : undefined,
    text: doc.getText(),
    isDirty: doc.isDirty
  };
}

/** Snapshot first Coop sight of a Use-repo document. Skip dirty buffers so typed-before-activate still ships. */
export function snapshotOpenDocument(doc: vscode.TextDocument): void {
  if (doc.isDirty) {
    return;
  }
  const scheme = doc.uri.scheme;
  const uriString = doc.uri.toString();
  if (scheme === "vscode-vfs" || scheme === "github") {
    const parsed = parseGithubVfsUri(uriString);
    if (!parsed?.file) {
      return;
    }
    snapshotWorkingCopyIfAbsent(parsed.file, uriString, doc.getText(), {
      owner: parsed.owner,
      repo: parsed.repo
    });
    return;
  }
  if (scheme === "file") {
    const rel = toRepositoryRelativePath(doc.uri.fsPath);
    if (!rel || isOsAbsoluteDiskPath(rel)) {
      return;
    }
    snapshotWorkingCopyIfAbsent(rel, uriString, doc.getText());
    return;
  }
  if (scheme === "untitled") {
    const remembered = rememberedRemoteBufferForUri(uriString);
    if (!remembered) {
      return;
    }
    snapshotWorkingCopyIfAbsent(remembered.path, uriString, remembered.content, {
      owner: remembered.owner,
      repo: remembered.repo
    });
  }
}

export function snapshotAlreadyOpenDocuments(): void {
  for (const doc of vscode.workspace.textDocuments) {
    snapshotOpenDocument(doc);
  }
}

export async function collectEditorPrFiles(
  useRepo: UseRepoForEditorPr,
  options?: {
    localDiskMatchesUseRepo?: boolean;
    readRemoteBaseline?: (path: string) => Promise<string | undefined>;
  }
): Promise<{ files: EditorPrFile[]; diff: string }> {
  const documents = vscode.workspace.textDocuments.map(documentToCollectDoc);
  const remembered = listRememberedRemoteBuffers();
  const first = collectEditorPrFilesFromDocs({
    useRepo,
    documents,
    remembered,
    localDiskMatchesUseRepo: options?.localDiskMatchesUseRepo
  });
  const remoteBaselines: Record<string, string> = {};
  if (first.needsRemote.length > 0 && options?.readRemoteBaseline) {
    await Promise.all(
      first.needsRemote.map(async (path) => {
        try {
          const content = await options.readRemoteBaseline?.(path);
          if (typeof content === "string") {
            remoteBaselines[path] = content;
          }
        } catch {
          /* skip — no baseline */
        }
      })
    );
  }
  const collected =
    Object.keys(remoteBaselines).length > 0
      ? collectEditorPrFilesFromDocs({
          useRepo,
          documents,
          remembered,
          localDiskMatchesUseRepo: options?.localDiskMatchesUseRepo,
          remoteBaselines
        })
      : first;
  return { files: collected.files, diff: compactWorkingCopyDiff(collected.files) };
}
