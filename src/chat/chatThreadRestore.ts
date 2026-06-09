export function isChatSessionIdle(lastActiveAt: number, idleMs: number, now = Date.now()): boolean {
  if (idleMs <= 0) {
    return false;
  }
  return now - lastActiveAt > idleMs;
}

/**
 * When idle, open the landing screen on a new thread while keeping prior threads in history.
 */
export function shouldStartFreshThreadOnRestore(
  activeThread: { messages: unknown[] },
  lastActiveAt: number,
  idleMs: number,
  now = Date.now()
): boolean {
  if (activeThread.messages.length === 0) {
    return false;
  }
  return isChatSessionIdle(lastActiveAt, idleMs, now);
}

export function resolveLastActiveAt(stored: number | undefined, threads: Array<{ updatedAt: number }>): number {
  if (typeof stored === "number" && stored > 0) {
    return stored;
  }
  if (threads.length === 0) {
    return Date.now();
  }
  return Math.max(...threads.map((thread) => thread.updatedAt));
}
