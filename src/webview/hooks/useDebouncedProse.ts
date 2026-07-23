import { useEffect, useRef, useState } from "react";

/**
 * Coalesce rapid stream buffer updates to at most one React paint per animation
 * frame. First non-empty content paints immediately so the reply doesn't feel
 * delayed; clears flush synchronously when the buffer resets.
 */
export function useStreamDisplayText(content: string): string {
  const [display, setDisplay] = useState(content);
  const latestRef = useRef(content);
  const frameRef = useRef<number | null>(null);
  const hasPaintedRef = useRef(Boolean(content));

  latestRef.current = content;

  useEffect(() => {
    if (!content) {
      hasPaintedRef.current = false;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setDisplay("");
      return;
    }

    // First visible token: paint immediately (Cursor-like start).
    if (!hasPaintedRef.current) {
      hasPaintedRef.current = true;
      setDisplay(content);
      return;
    }

    if (frameRef.current != null) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDisplay(latestRef.current);
    });
  }, [content]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return display;
}

/** @deprecated Prefer useStreamDisplayText — kept for existing call sites. */
export function useDebouncedProse(content: string, _delayMs = 75): string {
  return useStreamDisplayText(content);
}
