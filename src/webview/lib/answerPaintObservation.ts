/** Observe actual rendered answer bodies after a paint opportunity. This is a
 * DOM/viewport observation, not proof of semantic usefulness or screen photons.
 * Heading-only, hidden and unmounted output has no eligible body. */
export function observePaintedAnswer(article: HTMLElement, onPaint: () => boolean | void): () => void {
  let frame = 0, nextFrame = 0, disposed = false, intersects = false;
  const observedBody = article.querySelector<HTMLElement>(".chat-message-body");
  if (!observedBody) return () => undefined;
  let dispose = () => { disposed = true; };
  const check = () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame);
    frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        if (disposed || !intersects || document.visibilityState !== "visible") return;
        const body = article.querySelector<HTMLElement>(".chat-message-body");
        if (!body?.innerText.trim() || !body.querySelector("p, pre, li, [data-code-surface], .coop-patch-file")) return;
        if (typeof body.checkVisibility === "function" && !body.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
        const rect = body.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return;
        if (onPaint()) dispose();
      });
    });
  };
  const observer = new IntersectionObserver(entries => {
    intersects = entries.some(entry => entry.target === observedBody && entry.isIntersecting &&
      entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    check();
  });
  observer.observe(observedBody);
  document.addEventListener("visibilitychange", check);
  check();
  dispose = () => {
    disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame);
    observer.disconnect(); document.removeEventListener("visibilitychange", check);
  };
  return dispose;
}
