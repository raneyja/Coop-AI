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
      <div className="flex min-h-screen flex-col md:flex-row items-center justify-center bg-coop-dark text-coop-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-coop-border/40 bg-coop-dark md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="border-b border-coop-border/40 px-6 py-6">
          <BrandMark size="sm" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-coop-muted">Ops Portal</p>
        </div>
        <nav className="flex-1 px-3 py-4">
          <ul className="flex flex-wrap gap-1 md:block md:space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive(pathname, item.href)
                      ? "bg-coop-index/10 text-coop-index"
                      : "text-coop-muted hover:bg-white/[0.03] hover:text-white/90"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-coop-border/40 px-5 py-5">
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
        <header className="flex items-center justify-between gap-3 border-b border-coop-border/40 px-6 py-4 lg:px-8">
          <p className="text-sm text-coop-muted">Cross-org customer management</p>
          {me ? (
            <span className="text-xs text-coop-muted">{roleLabel(me.role)} access</span>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
