import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { SiteSchema } from "@/components/SiteSchema";
import { TawkChat } from "@/components/TawkChat";
import { siteConfig } from "@/lib/site.config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

const defaultOgImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: siteConfig.seo.ogImageAlt
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`
  },
  description: siteConfig.seo.defaultDescription,
  alternates: {
    canonical: siteConfig.url
  },
  openGraph: {
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.seo.defaultDescription,
    url: siteConfig.url,
    siteName: siteConfig.name,
    type: "website",
    images: [defaultOgImage]
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.seo.defaultDescription,
    images: ["/opengraph-image"]
  },
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {})
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistMono.variable} min-h-screen bg-white font-sans text-coop-foreground antialiased`}
      >
        <SiteSchema />
        <Header />
        <main>{children}</main>
        <Footer />
        <SiteAnalytics />
        <TawkChat />
      </body>
    </html>
  );
}
