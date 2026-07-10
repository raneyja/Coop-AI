"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSession,
  getStoredMe,
  getToken,
  restoreSessionFromCookie,
  roleLabel,
  signOutRemote
} from "@/lib/auth";
import { BrandMark } from "./BrandMark";

type OpsShellProps = {
  children: React.ReactNode;
};

const NAV_ITEMS = [
  { href: "/", label: "Attention queue" },
  { href: "/customers", label: "Customers" },
  { href: "/customers/new", label: "Provision" },
  { href: "/activity", label: "Activity" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/customers") {
    return pathname === "/customers" || (pathname.startsWith("/customers/") && !pathname.startsWith("/customers/new"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OpsShell({ children }: OpsShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const me = getStoredMe();

  useEffect(() => {
    async function guard() {
      let token = getToken();
      if (!token) {
        const restored = await restoreSessionFromCookie();
        if (!restored) {
          router.replace("/login");
          return;
        }
        token = getToken();
      }
      setReady(true);
    }
    void guard();
  }, [router, pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOutRemote();
    clearSession();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-coop-dark text-coop-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-coop-border bg-coop-dark">
        <div className="border-b border-coop-border px-4 py-4">
          <BrandMark size="sm" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-coop-muted">Ops Portal</p>
        </div>
        <nav className="flex-1 px-2 py-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 font-mono text-sm transition-colors ${
                    isActive(pathname, item.href)
                      ? "bg-white/[0.06] text-white"
                      : "text-coop-muted hover:bg-white/[0.03] hover:text-white/90"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-coop-border px-4 py-4">
          {me ? (
            <div className="space-y-2">
              <p className="truncate text-xs text-white/90">{me.email}</p>
              <span className="admin-chip admin-chip--muted">{roleLabel(me.role)}</span>
            </div>
          ) : null}
          <button
            type="button"
            className="admin-btn-secondary mt-3 w-full text-xs"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-coop-border px-6 py-3">
          <p className="text-sm text-coop-muted">Cross-org customer management</p>
          {me ? (
            <span className="font-mono text-xs text-coop-muted">{roleLabel(me.role)} access</span>
          ) : null}
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
