"use client";

import { displayOrgName, getStoredMe, clearSession } from "@/lib/auth";
import { useRouter } from "next/navigation";

export function TopBar() {
  const router = useRouter();
  const me = getStoredMe();

  function signOut() {
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-coop-border bg-coop-dark/90 px-6 backdrop-blur-sm">
      <p className="text-sm text-white/90">{displayOrgName(me)}</p>
      <button type="button" onClick={signOut} className="admin-btn-secondary text-xs">
        Sign out
      </button>
    </header>
  );
}
