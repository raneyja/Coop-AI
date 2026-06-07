"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { siteConfig } from "@/lib/site.config";

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-coop-dark/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={closeMobileMenu}>
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {siteConfig.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-coop-muted transition-colors hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/demo"
            className="hidden rounded-full bg-white px-4 py-2 text-sm font-medium text-coop-dark transition hover:bg-white/90 sm:inline-flex"
          >
            Book a demo
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-white/20 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 md:hidden"
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-controls="mobile-site-menu"
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {isMobileMenuOpen ? (
        <div id="mobile-site-menu" className="border-t border-white/5 bg-coop-dark/95 px-6 py-5 shadow-2xl md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1" aria-label="Mobile navigation">
            {siteConfig.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl px-4 py-3 text-base font-medium text-coop-muted transition hover:bg-white/5 hover:text-white"
                onClick={closeMobileMenu}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/demo"
              className="mt-3 inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-coop-dark transition hover:bg-white/90"
              onClick={closeMobileMenu}
            >
              Book a demo
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
