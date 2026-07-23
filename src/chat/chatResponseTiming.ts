/**
 * Configurable floor between user send and first visible assistant text output.
 * Production default is 0 — Coop no longer buffers real output behind an artificial
 * delay. Callers may still pass an explicit `minVisibleMs` (e.g. for tests), but no
 * hot-path call site should rely on this default being non-zero.
 */
export const MIN_CHAT_RESPONSE_VISIBLE_MS = 0;

export function remainingMinResponseDelayMs(
  startedAt: number,
  now = Date.now(),
  minVisibleMs = MIN_CHAT_RESPONSE_VISIBLE_MS
): number {
  return Math.max(0, minVisibleMs - (now - startedAt));
}

export function delayUntilMinResponseVisible(
  startedAt: number,
  now = Date.now(),
  minVisibleMs = MIN_CHAT_RESPONSE_VISIBLE_MS
): Promise<void> {
  const remaining = remainingMinResponseDelayMs(startedAt, now, minVisibleMs);
  if (remaining <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

/** Buffer streamed chunks until the minimum response delay elapses. */
export function createChatOutputGate(options: {
  startedAt: number;
  isCancelled: () => boolean;
  onChunk: (chunk: string) => void;
  minVisibleMs?: number;
}): {
  push: (chunk: string) => void;
  waitUntilOpen: () => Promise<void>;
} {
  const remaining = remainingMinResponseDelayMs(
    options.startedAt,
    Date.now(),
    options.minVisibleMs ?? MIN_CHAT_RESPONSE_VISIBLE_MS
  );
  let open = remaining <= 0;
  const queue: string[] = [];
  const gate =
    remaining <= 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => setTimeout(resolve, remaining)).then(() => {
          if (options.isCancelled()) {
            return;
          }
          open = true;
          for (const chunk of queue) {
            options.onChunk(chunk);
          }
          queue.length = 0;
        });

  return {
    push(chunk: string) {
      if (options.isCancelled()) {
        return;
      }
      if (open) {
        options.onChunk(chunk);
        return;
      }
      queue.push(chunk);
    },
    async waitUntilOpen() {
      await gate;
      if (!open && !options.isCancelled()) {
        open = true;
        for (const chunk of queue) {
          options.onChunk(chunk);
        }
        queue.length = 0;
      }
    }
  };
}

/**
 * Coalesce high-frequency SSE deltas into ~one webview postMessage per frame.
 * Partial text in the host (full buffer / threadRuns) should still append immediately;
 * only the UI notification is batched.
 */
export function createChatDeltaCoalescer(options: {
  onFlush: (chunk: string) => void;
  isCancelled?: () => boolean;
  /** Default ~1 frame at 60Hz. */
  maxWaitMs?: number;
}): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  const maxWaitMs = options.maxWaitMs ?? 16;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending) {
      return;
    }
    if (options.isCancelled?.()) {
      pending = "";
      return;
    }
    const chunk = pending;
    pending = "";
    options.onFlush(chunk);
  };

  return {
    push(chunk: string) {
      if (!chunk || options.isCancelled?.()) {
        return;
      }
      pending += chunk;
      if (timer === undefined) {
        timer = setTimeout(flush, maxWaitMs);
      }
    },
    flush
  };
}
