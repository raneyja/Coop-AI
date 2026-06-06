"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type ChatScrollAnchorRefs = {
  containerRef: RefObject<HTMLDivElement | null>;
  anchorRef: RefObject<HTMLDivElement | null>;
};

/** Keeps a chat thread scrolled to the latest message (bottom-anchored). */
export function useChatScrollAnchor(deps: unknown[]): ChatScrollAnchorRefs {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollToLatest = () => {
      anchorRef.current?.scrollIntoView({ block: "end" });
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    };

    scrollToLatest();
    const raf = requestAnimationFrame(scrollToLatest);

    const observeTarget = containerRef.current?.firstElementChild ?? containerRef.current;
    if (!observeTarget) {
      return () => cancelAnimationFrame(raf);
    }

    const ro = new ResizeObserver(scrollToLatest);
    ro.observe(observeTarget);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies scroll triggers
  }, deps);

  return { containerRef, anchorRef };
}
