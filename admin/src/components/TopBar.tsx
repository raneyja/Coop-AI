"use client";

import {
  clearSession,
  displayOrgName,
  getStoredMe,
  isAdminRole,
  signOutRemote
} from "@/lib/auth";
import { useRouter } from "next/navigation";

export function TopBar() {
  const router = useRouter();
  const me = getStoredMe();

  async function signOut() {
    await signOutRemote();
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-coop-border bg-coop-dark/90 px-6 backdrop-blur-sm">
      <div className="flex items-baseline gap-2">
        <p className="text-sm text-white/90">{displayOrgName(me)}</p>
        {me ? (
          <span className="text-xs text-coop-muted">
            {isAdminRole(me) ? "Admin console" : "Member workspace"}
          </span>
        ) : null}
      </div>
      <button type="button" onClick={() => void signOut()} className="admin-btn-secondary text-xs">
        Sign out
      </button>
    </header>
  );
}
