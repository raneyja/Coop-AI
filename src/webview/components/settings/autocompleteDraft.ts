/** Keep a just-saved autocomplete value until a matching settings:state arrives. */
export function reconcileAutocompletePref(
  incomingEnabled: boolean,
  pendingEnabled: boolean | null
): { enabled: boolean; pending: boolean | null } {
  if (pendingEnabled === null) {
    return { enabled: incomingEnabled, pending: null };
  }
  if (incomingEnabled === pendingEnabled) {
    return { enabled: incomingEnabled, pending: null };
  }
  return { enabled: pendingEnabled, pending: pendingEnabled };
}

/**
 * After Save, keep the draft the user just saved instead of copying stale prefs
 * back onto the checkbox.
 */
export function nextAutocompleteDraft(
  prefsEnabled: boolean,
  dirty: boolean,
  pendingEnabled: boolean | null
): boolean | "keep" {
  if (dirty) {
    return "keep";
  }
  if (pendingEnabled !== null && pendingEnabled !== prefsEnabled) {
    return pendingEnabled;
  }
  return prefsEnabled;
}
