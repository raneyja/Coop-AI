"use client";

import { useEffect, useRef } from "react";

/** Keeps a chat thread scrolled to the latest message (bottom-anchored). */
export function useChatScrollAnchor(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };

    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies scroll triggers
  }, deps);

  return ref;
}
