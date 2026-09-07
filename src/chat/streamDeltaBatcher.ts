/**
 * Coalesce streamed chat tokens before postMessage.
 * Token-by-token webview posts on a long answer freeze the extension host.
 */

export const STREAM_DELTA_BATCH_MS = 32;

export type StreamDeltaBatcher = {
  push: (chunk: string) => void;
  flush: () => void;
  /** Flush leftover tokens, then ignore further push/flush. Call before chat:complete. */
  end: () => void;
  dispose: () => void;
};

export function createStreamDeltaBatcher(options: {
  publish: (chunk: string) => void;
  intervalMs?: number;
}): StreamDeltaBatcher {
  const intervalMs = options.intervalMs ?? STREAM_DELTA_BATCH_MS;
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let publishedFirst = false;
  let disposed = false;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!buffer || disposed) {
      return;
    }
    const chunk = buffer;
    buffer = "";
    options.publish(chunk);
  };

  return {
    push(chunk: string) {
      if (!chunk || disposed) {
        return;
      }
      if (!publishedFirst) {
        publishedFirst = true;
        options.publish(chunk);
        return;
      }
      buffer += chunk;
      if (timer === undefined) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    flush,
    end() {
      flush();
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      buffer = "";
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      buffer = "";
    }
  };
}
