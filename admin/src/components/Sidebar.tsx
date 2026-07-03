"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canAccessAdminPages, getStoredMe } from "@/lib/auth";
import { planCapabilities } from "@/lib/planCapabilities";
import { BrandMark } from "./BrandMark";

type NavItem = {
  href: string;
  label: string;
  proOnly?: boolean;
  hideWhen?: (plan: string) => boolean;
  indented?: boolean;
};

const MEMBER_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/feed", label: "Chat Feed" },
  { href: "/integrations", label: "Integrations" },
  { href: "/my-usage", label: "My Usage" },
  { href: "/my-activity", label: "My Activity" },
  { href: "/settings", label: "Settings" }
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/indexing", label: "Indexing" },
  {
    href: "/collections",
    label: "Collections",
    hideWhen: (plan) => !planCapabilities(plan).showCollections
  },
  { href: "/integrations", label: "Integrations" },
  { href: "/users", label: "Users" },
  { href: "/analytics", label: "Analytics" },
  { href: "/api-keys", label: "API Keys" },
  { href: "/billing", label: "Billing" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
  { href: "/feed", label: "Chat Feed", indented: true }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/feed") {
    return pathname === "/feed" || pathname.startsWith("/feed/");
  }
  return pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  const me = getStoredMe();
  const plan = me?.plan ?? "free";
  const isFreePlan = plan === "free";
  const isAdmin = me ? canAccessAdminPages(me) : false;
  const navItems = isAdmin ? ADMIN_NAV_ITEMS : MEMBER_NAV_ITEMS;
  const visibleItems = navItems.filter((item) => {
    if (item.hideWhen?.(plan)) {
      return false;
    }
    return true;
  });

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-coop-border bg-coop-dark">
      <div className="border-b border-coop-border px-4 py-4">
        <BrandMark size="sm" />
      </div>
      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const lockedForFree = Boolean(isFreePlan && item.proOnly);
            const href = lockedForFree ? "/billing" : item.href;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className={item.indented ? "mt-1 border-t border-coop-border/40 pt-2" : undefined}>
                <Link
                  href={href}
                  className={`block rounded-sm py-1.5 text-sm transition-colors ${
                    item.indented ? "pl-7 pr-3" : "px-3"
                  } ${
                    active
                      ? `border-l-2 border-l-white bg-white/[0.04] font-medium text-white ${
                          item.indented ? "pl-[26px]" : "pl-[10px]"
                        }`
                      : "border-l-2 border-l-transparent text-coop-muted hover:bg-white/[0.03] hover:text-white"
                  } ${item.indented ? "text-[13px]" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{item.label}</span>
                    {lockedForFree ? (
                      <span className="rounded-full border border-coop-index/40 bg-coop-index/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-coop-index">
                        Pro
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
