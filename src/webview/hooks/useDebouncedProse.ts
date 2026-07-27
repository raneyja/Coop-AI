import { useEffect, useRef, useState } from "react";

/** Base reveal speed — close to ChatGPT's visible token flow. */
const BASE_CHARS_PER_SEC = 110;
/** Hard cap per frame so a huge backlog still animates instead of dumping. */
const MAX_CHARS_PER_FRAME = 22;

/**
 * How many characters to reveal this frame given backlog and elapsed time.
 * Exported for unit tests.
 */
export function streamRevealStep(backlog: number, dtSec: number): number {
  if (backlog <= 0) {
    return 0;
  }
  // Accelerate when far behind (large SSE burst or final enriched content),
  // but never jump the whole backlog in one paint.
  const rate =
    backlog > 600
      ? BASE_CHARS_PER_SEC * 4.5
      : backlog > 220
        ? BASE_CHARS_PER_SEC * 2.8
        : backlog > 64
          ? BASE_CHARS_PER_SEC * 1.7
          : BASE_CHARS_PER_SEC;
  const dt = Math.min(0.05, Math.max(0, dtSec));
  return Math.max(1, Math.min(MAX_CHARS_PER_FRAME, Math.ceil(rate * dt)));
}

/**
 * ChatGPT-style streaming: tokens accumulate in `target`, and the visible
 * string catches up at a steady character rate so large SSE bursts still read
 * as a continuous flow instead of one dump.
 */
export function useSmoothStreamText(target: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState("");
  const displayedLenRef = useRef(0);
  const targetRef = useRef(target);
  const streamingRef = useRef(isStreaming);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  targetRef.current = target;
  streamingRef.current = isStreaming;

  useEffect(() => {
    const stopLoop = (): void => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
    };

    // Buffer cleared (complete/error/reset).
    if (!target) {
      stopLoop();
      displayedLenRef.current = 0;
      setDisplayed("");
      return;
    }

    // Caller stopped streaming with text still on screen (error path) — keep
    // whatever was revealed; ChatPanel clears the buffer separately.
    if (!isStreaming) {
      stopLoop();
      return;
    }

    const tick = (ts: number): void => {
      const goal = targetRef.current;
      if (!goal) {
        rafRef.current = null;
        lastTsRef.current = null;
        return;
      }
      if (!streamingRef.current) {
        rafRef.current = null;
        lastTsRef.current = null;
        return;
      }

      let len = displayedLenRef.current;
      if (len > goal.length) {
        // Target shrank (thread switch) — snap down.
        len = goal.length;
        displayedLenRef.current = len;
        setDisplayed(goal.slice(0, len));
      } else if (len < goal.length) {
        const last = lastTsRef.current ?? ts;
        const step = streamRevealStep(goal.length - len, (ts - last) / 1000);
        len = Math.min(goal.length, len + step);
        displayedLenRef.current = len;
        setDisplayed(goal.slice(0, len));
      }

      lastTsRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [target, isStreaming]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return displayed;
}

/** @deprecated Prefer useSmoothStreamText. */
export function useStreamDisplayText(content: string): string {
  return useSmoothStreamText(content, Boolean(content));
}

/** @deprecated Prefer useSmoothStreamText. */
export function useDebouncedProse(content: string, _delayMs = 75): string {
  return useSmoothStreamText(content, Boolean(content));
}
