/** Yield so timers (job timeout, stale reclaim) can run during CPU-heavy indexing. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
