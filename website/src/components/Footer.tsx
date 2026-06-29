import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { siteConfig } from "@/lib/site.config";

export function Footer() {
  return (
    <footer className="border-t border-coop-border bg-coop-dark">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <BrandMark size="sm" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-coop-muted">
              Your codebase, finally explained
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white">Product</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/product" className="text-sm text-coop-muted hover:text-white">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-sm text-coop-muted hover:text-white">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/demo" className="text-sm text-coop-muted hover:text-white">
                  Book a demo
                </Link>
              </li>
              <li>
                <Link href="/manual" className="text-sm text-coop-muted hover:text-white">
                  Owner&apos;s Manual
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-sm text-coop-muted hover:text-white">
                  Documentation
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white">Company</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/enterprise" className="text-sm text-coop-muted hover:text-white">
                  Enterprise
                </Link>
              </li>
              <li>
                <Link href="/security" className="text-sm text-coop-muted hover:text-white">
                  Security
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-sm text-coop-muted hover:text-white">
                  Blog
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${siteConfig.contactEmail}`}
                  className="text-sm text-coop-muted hover:text-white"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white">Legal</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/privacy" className="text-sm text-coop-muted hover:text-white">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm text-coop-muted hover:text-white">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-coop-border pt-8 sm:flex-row sm:items-center">
          <p className="text-sm text-coop-muted">
            © {new Date().getFullYear()} CoopAI. All rights reserved.
          </p>
          <p className="text-xs text-coop-muted/80">
            CoopAI is in active development. Features and availability may change.
          </p>
        </div>
      </div>
    </footer>
  );
}
