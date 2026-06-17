"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/indexing", label: "Indexing" },
  { href: "/collections", label: "Collections" },
  { href: "/integrations", label: "Integrations" },
  { href: "/users", label: "Users" },
  { href: "/analytics", label: "Analytics" },
  { href: "/api-keys", label: "API Keys" },
  { href: "/billing", label: "Billing" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-coop-border bg-coop-dark">
      <div className="border-b border-coop-border px-4 py-4">
        <BrandMark size="sm" />
      </div>
      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-sm px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-l-2 border-l-white bg-white/[0.04] pl-[10px] font-medium text-white"
                      : "border-l-2 border-l-transparent text-coop-muted hover:bg-white/[0.03] hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
