"use client";

import { EXTENSION_MARKETPLACE_URL } from "@/lib/extension";

import {
  clearSession,
  displayOrgName,
  getStoredMe,
  isAdminRole,
  ORG_NAME_UPDATED_EVENT,
  signOutRemote
} from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UpgradeRequestNotifier } from "./UpgradeRequestNotifier";

export function TopBar() {
  const router = useRouter();
  const me = getStoredMe();
  const [orgLabel, setOrgLabel] = useState(() => displayOrgName(me));
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const refresh = () => setOrgLabel(displayOrgName(getStoredMe()));
    refresh();
    window.addEventListener(ORG_NAME_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(ORG_NAME_UPDATED_EVENT, refresh);
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    const signedOut = await signOutRemote();
    setSigningOut(false);
    if (!signedOut) {
      setSignOutError("Could not sign out. Please try again.");
      return;
    }
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-coop-border bg-coop-dark/90 px-6 backdrop-blur-xs">
      <div className="flex items-baseline gap-2">
        <p className="text-sm text-white/90">{orgLabel}</p>
        {me ? (
          <span className="text-xs text-coop-muted">
            {isAdminRole(me) ? "Admin console" : "Member workspace"}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <UpgradeRequestNotifier />
        <a
          href={EXTENSION_MARKETPLACE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-btn-secondary whitespace-nowrap text-xs"
        >
          Install in VS Code
        </a>
        {signOutError ? <span role="alert" className="text-xs text-red-300">{signOutError}</span> : null}
        <button type="button" onClick={() => void signOut()} disabled={signingOut} className="admin-btn-secondary text-xs">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}
