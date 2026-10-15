import fs from "node:fs";

export type BoundedCloneFile =
  | { kind: "read"; source: string }
  | { kind: "skip"; reason: "unavailable" | "oversize" };

/** Read one regular clone file from one descriptor, never following its final symlink. */
export function readBoundedCloneFile(filePath: string, maxBytes: number): BoundedCloneFile {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || typeof fs.constants.O_NOFOLLOW !== "number") {
    return { kind: "skip", reason: "unavailable" };
  }

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) {
      return { kind: "skip", reason: "oversize" };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) return { kind: "skip", reason: "oversize" };
      chunks.push(chunk.subarray(0, count));
    }
    return { kind: "read", source: Buffer.concat(chunks, total).toString("utf8") };
  } catch {
    return { kind: "skip", reason: "unavailable" };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
