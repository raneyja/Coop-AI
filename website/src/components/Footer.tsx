"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { siteConfig } from "@/lib/site.config";

export function Footer() {
  const dark = usePathname() === "/";
  const heading = dark ? "text-sm font-medium text-white" : "text-sm font-medium text-gray-900";
  const link = dark
    ? "text-sm text-white/50 hover:text-white"
    : "text-sm text-coop-muted hover:text-gray-900";

  return (
    <footer className={dark ? "border-t border-white/10 bg-neutral-950" : "border-t border-coop-border/80 bg-transparent"}>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <BrandMark size="sm" inverted={dark} />
            </Link>
            <p className={`mt-4 text-sm leading-relaxed ${dark ? "text-white/45" : "text-coop-muted"}`}>
              {siteConfig.seo.defaultDescription}
            </p>
          </div>

          <div>
            <h3 className={heading}>Product</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/product" className={link}>
                  Features
                </Link>
              </li>
              <li>
                <Link href="/integrations" className={link}>
                  Integrations
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={link}>
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/demo" className={link}>
                  Book a demo
                </Link>
              </li>
              <li>
                <Link href="/manual" className={link}>
                  Owner&apos;s Manual
                </Link>
              </li>
              <li>
                <Link href="/docs" className={link}>
                  Documentation
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className={heading}>Company</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/enterprise" className={link}>
                  Enterprise
                </Link>
              </li>
              <li>
                <Link href="/security" className={link}>
                  Security
                </Link>
              </li>
              <li>
                <Link href="/blog" className={link}>
                  Blog
                </Link>
              </li>
              <li>
                <a href={`mailto:${siteConfig.contactEmail}`} className={link}>
                  Contact
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className={heading}>Legal</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/privacy" className={link}>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className={link}>
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div
          className={`mt-12 flex flex-col items-start justify-between gap-4 pt-8 sm:flex-row sm:items-center ${
            dark ? "border-t border-white/10" : "border-t border-coop-border"
          }`}
        >
          <p className={`text-sm ${dark ? "text-white/40" : "text-coop-muted"}`}>
            © {new Date().getFullYear()} CoopAI. All rights reserved.
          </p>
          <p className={`text-xs ${dark ? "text-white/30" : "text-coop-muted/80"}`}>
            CoopAI is in active development. Features and availability may change.
          </p>
        </div>
      </div>
    </footer>
  );
}
