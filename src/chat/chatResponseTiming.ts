/** Minimum time from user send to first visible assistant text output. */
export const MIN_CHAT_RESPONSE_VISIBLE_MS = 3000;

export function remainingMinResponseDelayMs(
  startedAt: number,
  now = Date.now()
): number {
  return Math.max(0, MIN_CHAT_RESPONSE_VISIBLE_MS - (now - startedAt));
}

export function delayUntilMinResponseVisible(
  startedAt: number,
  now = Date.now()
): Promise<void> {
  const remaining = remainingMinResponseDelayMs(startedAt, now);
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
}): {
  push: (chunk: string) => void;
  waitUntilOpen: () => Promise<void>;
} {
  let open = false;
  const queue: string[] = [];
  const gate = delayUntilMinResponseVisible(options.startedAt).then(() => {
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
