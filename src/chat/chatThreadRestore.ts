export function isChatSessionIdle(lastActiveAt: number, idleMs: number, now = Date.now()): boolean {
  if (idleMs <= 0) {
    return false;
  }
  return now - lastActiveAt > idleMs;
}

/**
 * Cold start / extension activate: always land on a blank thread when the previous
 * active thread has messages. Prior threads stay in history for explicit switch.
 * Empty active threads are reused so we do not spam New Chat rows on every reload.
 */
export function shouldStartFreshThreadOnRestore(activeThread: { messages: unknown[] }): boolean {
  return activeThread.messages.length > 0;
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
