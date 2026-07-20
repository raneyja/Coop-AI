/**
 * Module-level org-suspension flag so late subscribers (e.g. AdminShell
 * mounting after a page fetch) still learn the org is suspended.
 * Cleared on sign-out / successful auth for a different org.
 */

type Listener = (suspended: boolean) => void;

let orgSuspended = false;
const listeners = new Set<Listener>();

export function markOrgSuspended(): void {
  if (orgSuspended) return;
  orgSuspended = true;
  for (const listener of listeners) {
    listener(true);
  }
}

export function clearOrgSuspended(): void {
  if (!orgSuspended) return;
  orgSuspended = false;
  for (const listener of listeners) {
    listener(false);
  }
}

export function isOrgMarkedSuspended(): boolean {
  return orgSuspended;
}

/** Subscribe; if already suspended, listener is called immediately. */
export function subscribeOrgSuspended(listener: Listener): () => void {
  listeners.add(listener);
  if (orgSuspended) {
    listener(true);
  }
  return () => {
    listeners.delete(listener);
  };
}
