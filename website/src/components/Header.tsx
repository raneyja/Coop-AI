"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { InstallExtensionButton } from "@/components/Button";
import { siteConfig } from "@/lib/site.config";

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const dark = pathname === "/";
  const wide = pathname === "/pricing";
  const shellClass = wide
    ? "mx-auto flex h-16 w-full max-w-[100rem] items-center justify-between px-4 sm:px-6 lg:px-10"
    : "mx-auto flex h-16 max-w-6xl items-center justify-between px-6";

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <header
      className={
        dark
          ? "sticky top-0 z-50 border-b border-white/10 bg-neutral-950/80 backdrop-blur-xl"
          : "sticky top-0 z-50 border-b border-coop-border bg-white"
      }
    >
      <div className={shellClass}>
        <Link href="/" className="flex items-center gap-2.5" onClick={closeMobileMenu}>
          <BrandMark inverted={dark} />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {siteConfig.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                dark
                  ? "text-sm text-white/55 transition-colors hover:text-white"
                  : "text-sm text-coop-muted transition-colors hover:text-gray-900"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/demo"
            className={
              dark
                ? "hidden text-xs font-medium text-white/55 transition hover:text-white sm:inline-flex"
                : "hidden text-xs font-medium text-coop-muted transition hover:text-gray-900 sm:inline-flex"
            }
          >
            Book a demo
          </Link>
          <InstallExtensionButton
            variant={dark ? "inverse" : "primary"}
            size="sm"
            className="hidden sm:inline-flex"
          />
          <button
            type="button"
            className={
              dark
                ? "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 md:hidden"
                : "inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-900 transition hover:border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 md:hidden"
            }
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
        <div
          id="mobile-site-menu"
          className={
            dark
              ? "border-t border-white/10 bg-neutral-950 px-6 py-5 md:hidden"
              : "border-t border-coop-border bg-white px-6 py-5 shadow-lg md:hidden"
          }
        >
          <nav className="mx-auto flex max-w-6xl flex-col gap-1" aria-label="Mobile navigation">
            {siteConfig.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  dark
                    ? "rounded-2xl px-4 py-3 text-base font-medium text-white/60 transition hover:bg-white/5 hover:text-white"
                    : "rounded-2xl px-4 py-3 text-base font-medium text-coop-muted transition hover:bg-gray-50 hover:text-gray-900"
                }
                onClick={closeMobileMenu}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3" onClick={closeMobileMenu}>
              <InstallExtensionButton
                variant={dark ? "inverse" : "primary"}
                className="w-full rounded-full px-5 py-3 text-sm"
              />
            </div>
            <Link
              href="/demo"
              className={
                dark
                  ? "mt-2 inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                  : "mt-2 inline-flex items-center justify-center rounded-full border border-gray-300 px-5 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
              }
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
