/**
 * Frame-coalesce string paints so rapid SSE deltas update the UI at most once
 * per animation frame, while still advancing during continuous streams.
 *
 * First non-empty value paints immediately (snappy TTFB). Empty clears sync.
 */
export type ProseFrameCoalescer = {
  push(content: string): void;
  dispose(): void;
};

export function createProseFrameCoalescer(
  paint: (content: string) => void,
  scheduleFrame: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id)
): ProseFrameCoalescer {
  let pending = "";
  let frameId: number | null = null;
  let hasPaintedContent = false;

  const cancelPendingFrame = () => {
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  };

  return {
    push(content: string) {
      pending = content;

      if (!content) {
        hasPaintedContent = false;
        cancelPendingFrame();
        paint("");
        return;
      }

      if (!hasPaintedContent) {
        hasPaintedContent = true;
        paint(content);
        return;
      }

      if (frameId !== null) {
        return;
      }

      frameId = scheduleFrame(() => {
        frameId = null;
        paint(pending);
      });
    },
    dispose() {
      cancelPendingFrame();
    }
  };
}
