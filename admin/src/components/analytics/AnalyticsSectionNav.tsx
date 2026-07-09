"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AnalyticsSectionNavProps = {
  showOrganization: boolean;
};

const SECTIONS = [
  { href: "/analytics", label: "Organization", adminOnly: true },
  { href: "/analytics/my", label: "My Analytics", adminOnly: false }
] as const;

function isSectionActive(pathname: string, href: string): boolean {
  if (href === "/analytics") {
    return pathname === "/analytics";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AnalyticsSectionNav({ showOrganization }: AnalyticsSectionNavProps): React.ReactElement | null {
  const pathname = usePathname();
  const visible = SECTIONS.filter((section) => !section.adminOnly || showOrganization);

  if (visible.length <= 1) {
    return null;
  }

  return (
    <nav
      className="-mt-1 mb-2 flex flex-wrap gap-1 border-b border-coop-border"
      aria-label="Analytics views"
    >
      {visible.map((section) => {
        const active = isSectionActive(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            className={`admin-btn border-b-2 px-4 py-2 text-sm ${
              active
                ? "border-coop-index text-white"
                : "border-transparent text-coop-muted hover:text-white"
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
