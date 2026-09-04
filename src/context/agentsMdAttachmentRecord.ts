/** Per-account personal AGENTS.md pointer. Use-repo files are not stored here. */

export const ATTACHED_AGENTS_MD_BY_ACCOUNT_KEY = "coopAI.attachedAgentsMdByAccount";
/** Pre-account-scoped pointer. Never migrate onto a new login — that was the bleed. */
export const LEGACY_ATTACHED_AGENTS_MD_PATH_KEY = "coopAI.attachedAgentsMdPath";

export type AgentsMdAttachmentStateStore = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void;
};

export function normalizeAgentsMdAccountKey(
  userEmail?: string,
  isSignedIn?: boolean
): string | undefined {
  if (!isSignedIn) {
    return undefined;
  }
  const email = userEmail?.trim().toLowerCase();
  return email || undefined;
}

export function attachedAgentsMdLabel(fsPath: string | undefined): string | undefined {
  if (!fsPath?.trim()) {
    return undefined;
  }
  const parts = fsPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || undefined;
}

function isPathMap(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readAttachedAgentsMdMap(
  store: AgentsMdAttachmentStateStore
): Record<string, string> {
  const raw = store.get<unknown>(ATTACHED_AGENTS_MD_BY_ACCOUNT_KEY);
  if (!isPathMap(raw)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const account = key.trim().toLowerCase();
    const fsPath = typeof value === "string" ? value.trim() : "";
    if (!account || !fsPath) {
      continue;
    }
    map[account] = fsPath;
  }
  return map;
}

export function discardLegacyAttachedAgentsMdPath(store: AgentsMdAttachmentStateStore): void {
  if (store.get(LEGACY_ATTACHED_AGENTS_MD_PATH_KEY) === undefined) {
    return;
  }
  void Promise.resolve(store.update(LEGACY_ATTACHED_AGENTS_MD_PATH_KEY, undefined));
}

export function readAttachedAgentsMdPath(
  store: AgentsMdAttachmentStateStore,
  accountKey?: string
): string | undefined {
  discardLegacyAttachedAgentsMdPath(store);
  if (!accountKey) {
    return undefined;
  }
  const path = readAttachedAgentsMdMap(store)[accountKey]?.trim();
  return path || undefined;
}

export async function writeAttachedAgentsMdPath(
  store: AgentsMdAttachmentStateStore,
  accountKey: string | undefined,
  fsPath: string | undefined
): Promise<void> {
  discardLegacyAttachedAgentsMdPath(store);
  if (!accountKey) {
    return;
  }
  const map = readAttachedAgentsMdMap(store);
  const next = fsPath?.trim();
  if (!next) {
    delete map[accountKey];
  } else {
    map[accountKey] = next;
  }
  await store.update(ATTACHED_AGENTS_MD_BY_ACCOUNT_KEY, map);
}
