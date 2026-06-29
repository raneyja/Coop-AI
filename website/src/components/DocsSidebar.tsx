"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocsSection } from "@/lib/docs.shared";

type DocsSidebarProps = {
  sections: DocsSection[];
  currentSlug?: string;
};

export function DocsSidebar({ sections, currentSlug }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="space-y-8">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="coop-section-label mb-3">{section.title}</p>
          <ul className="space-y-1">
            {section.pages.map((page) => {
              const href = `/docs/${page.slug}`;
              const isActive = currentSlug === page.slug || pathname === href;

              return (
                <li key={page.slug}>
                  <Link
                    href={href}
                    className={`block py-1.5 text-sm leading-snug transition-colors ${
                      isActive
                        ? "font-medium text-coop-index"
                        : "text-coop-muted hover:text-white"
                    }`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
