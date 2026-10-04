/** All startup callers await the same local preferences/thread hydration. */
export function createSharedInitialization(initialize: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (!pending) {
      pending = initialize().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}
