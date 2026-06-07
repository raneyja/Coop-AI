import { useEffect, useState } from "react";

export function useDebouncedProse(content: string, delayMs = 75): string {
  const [debouncedContent, setDebouncedContent] = useState(content);

  useEffect(() => {
    if (!content) {
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
