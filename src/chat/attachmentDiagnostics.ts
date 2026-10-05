import { createHash } from "node:crypto";
import { localFilesFromContextData } from "../context/localFileContext";

type FileBody = { path?: string; content?: string };
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Metadata only. Callers must gate collection on agentDiagnostics. */
export function attachmentBodyMetadata(payload?: { files?: FileBody[] }) {
  const files = payload?.files ?? [];
  return {
    fileCount: files.length,
    bodyChars: files.reduce((total, file) => total + (file.content?.length ?? 0), 0),
    files: files.map((file) => ({
      path: file.path,
      bodyChars: file.content?.length ?? 0,
      bodyHash: hash(file.content ?? "")
    }))
  };
}

export function attachmentBundleMetadata(bundle: Array<{ data?: unknown }>) {
  return attachmentBodyMetadata({ files: bundle.flatMap((entry) => localFilesFromContextData(entry.data)) });
}

export function attachmentSerializedMetadata(message: string) {
  const bodies = [...message.matchAll(/<file_content\b[^>]*>([\s\S]*?)<\/file_content>/g)];
  return {
    messageChars: message.length,
    messageHash: hash(message),
    localFilesBlockCount: (message.match(/<local_files>/g) ?? []).length,
    fileContentBlockCount: bodies.length,
    serializedBodyChars: bodies.reduce((sum, match) => sum + match[1].length, 0),
    serializedBodyHashes: bodies.map((match) => hash(match[1]))
  };
}
