import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { siteConfig } from "@/lib/site.config";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-coop-dark/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
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
        </div>
      </div>
    </header>
  );
}
