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

/** Unavailable verification must not masquerade as a confirmed account change. */
export function shouldRebindAccountThreads(
  boundIdentity: string,
  verifiedIdentity: string,
  storedToken: string | undefined,
  lastVerifiedToken: string | undefined
): boolean {
  if (!verifiedIdentity && storedToken && storedToken === lastVerifiedToken) {
    return false;
  }
  return boundIdentity !== verifiedIdentity;
}
