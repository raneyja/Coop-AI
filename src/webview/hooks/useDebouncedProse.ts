import { useEffect, useRef, useState } from "react";

export function useDebouncedProse(content: string, delayMs = 75): string {
  const [debouncedContent, setDebouncedContent] = useState(content);
  const hasContentRef = useRef(Boolean(content));

  useEffect(() => {
    if (!content) {
      hasContentRef.current = false;
      setDebouncedContent(content);
      return;
    }

    // Show the first visible token immediately — only throttle the rapid follow-up
    // re-renders once a stream is already flowing, so markdown isn't re-parsed on
    // every SSE chunk.
    if (!hasContentRef.current) {
      hasContentRef.current = true;
      setDebouncedContent(content);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedContent(content);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [content, delayMs]);

  return debouncedContent;
}
