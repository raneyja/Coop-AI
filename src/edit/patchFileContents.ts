import { pathsReferToSameFile } from "../context/githubVfsUri";

/** Resolve a patch path against captured file bodies (suffix / alias tolerant). */
export function lookupPatchFileContent(
  relativePath: string,
  fileContents?: Readonly<Record<string, string>>
): string | undefined {
  if (!fileContents) {
    return undefined;
  }
  const direct = fileContents[relativePath];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  const directNormalized = fileContents[normalized];
  if (typeof directNormalized === "string" && directNormalized.length > 0) {
    return directNormalized;
  }
  for (const [key, value] of Object.entries(fileContents)) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    if (pathsReferToSameFile(key, relativePath) || pathsReferToSameFile(key, normalized)) {
      return value;
    }
  }
  return undefined;
}

export function indexPatchFileContent(
  path: string,
  body: string,
  into: Record<string, string>
): void {
  const trimmed = path.trim();
  if (!trimmed || !body) {
    return;
  }
  into[trimmed] = body;
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (normalized && normalized !== trimmed) {
    into[normalized] = body;
  }
}
