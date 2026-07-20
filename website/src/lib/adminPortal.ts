function getAdminPortalBase(): string {
  const base = process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";
  return base.replace(/\/+$/, "").replace(/\/login$/, "").replace(/\/auth\/callback$/, "");
}

/** Base admin portal URL from env → sign-in page (forces logout of any prior session). */
export function getAdminPortalLoginUrl(): string {
  return `${getAdminPortalBase()}/login?signedOut=1`;
}

/** OAuth / website session handoff target (hash receives coopToken + coopRefresh). */
export function getAdminPortalAuthCallbackUrl(): string {
  return `${getAdminPortalBase()}/auth/callback`;
}
