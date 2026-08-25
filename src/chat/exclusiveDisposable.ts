/** Replace a VS Code event subscription, disposing the previous one first. */
export function replaceExclusiveDisposable<T extends { dispose(): void }>(
  previous: T | undefined,
  next: T
): T {
  previous?.dispose();
  return next;
}
