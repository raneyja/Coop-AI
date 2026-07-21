import { useEffect, useRef, useState } from "react";
import { createProseFrameCoalescer } from "./proseFrameCoalescer";

/**
 * Coalesce rapid stream updates to at most one paint per animation frame.
 *
 * Unlike a trailing debounce (which only paints after tokens pause), this keeps
 * the visible text advancing while the model streams — closer to a normal
 * token feed, without re-parsing markdown on every SSE chunk.
 */
export function useCoalescedProse(content: string): string {
  const [display, setDisplay] = useState(content);
  const coalescerRef = useRef<ReturnType<typeof createProseFrameCoalescer> | null>(null);

  useEffect(() => {
    if (!coalescerRef.current) {
      coalescerRef.current = createProseFrameCoalescer(setDisplay);
    }
    coalescerRef.current.push(content);
  }, [content]);

  useEffect(() => {
    return () => {
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
    };
  }, []);

  return display;
}

/** @deprecated Prefer useCoalescedProse — kept for older imports. */
export const useDebouncedProse = useCoalescedProse;
