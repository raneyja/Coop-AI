/** Stable key for the signed-in Coop account, or empty when signed out. */
export function authIdentityKey(prefs: {
  isSignedIn?: boolean;
  hasApiKey?: boolean;
  userEmail?: string;
}): string {
  if (!(prefs.isSignedIn ?? prefs.hasApiKey)) {
    return "";
  }
  return (prefs.userEmail ?? "").trim().toLowerCase() || "signed-in";
}
