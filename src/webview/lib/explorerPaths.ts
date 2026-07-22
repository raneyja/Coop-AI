/** Normalize a repository-relative directory path for explorer navigation. */
export function normalizeExplorerPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Parent directory of a repo-relative path, or "" at the repository root. */
export function parentExplorerPath(path: string): string {
  const normalized = normalizeExplorerPath(path);
  if (!normalized) {
    return "";
  }
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? "" : normalized.slice(0, idx);
}

/** Clamp explorer list height between min and max (px). */
export function clampExplorerListHeight(height: number, min: number, max: number): number {
  if (!Number.isFinite(height)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(height)));
}

export const EXPLORER_LIST_HEIGHT_DEFAULT = 208;
export const EXPLORER_LIST_HEIGHT_MIN = 96;
export const EXPLORER_LIST_HEIGHT_STORAGE_KEY = "coop.remoteExplorer.listHeight";

export function maxExplorerListHeight(viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800): number {
  return Math.max(EXPLORER_LIST_HEIGHT_MIN, Math.floor(viewportHeight * 0.65));
}

export function readStoredExplorerListHeight(): number {
  try {
    const raw = sessionStorage.getItem(EXPLORER_LIST_HEIGHT_STORAGE_KEY);
    const parsed = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return clampExplorerListHeight(parsed, EXPLORER_LIST_HEIGHT_MIN, maxExplorerListHeight());
    }
  } catch {
    // sessionStorage unavailable (tests / restricted webview)
  }
  return EXPLORER_LIST_HEIGHT_DEFAULT;
}

export function storeExplorerListHeight(height: number): void {
  try {
    sessionStorage.setItem(EXPLORER_LIST_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // ignore quota / privacy mode
  }
}
