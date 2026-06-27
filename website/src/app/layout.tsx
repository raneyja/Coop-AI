import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { TawkChat } from "@/components/TawkChat";
import { siteConfig } from "@/lib/site.config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`
  },
  description:
    "CoopAI: Organizational context for code intelligence. Zero-clone. Enterprise-ready. For teams.",
  openGraph: {
    title: siteConfig.name,
    description:
      "Your codebase, finally explained. Context from Slack, Jira, code graph—for teams.",
    url: siteConfig.url,
    siteName: siteConfig.name,
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description:
      "Your codebase, finally explained. Context from Slack, Jira, code graph—for teams."
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-coop-dark font-sans antialiased`}>
        <Header />
        <main>{children}</main>
        <Footer />
        <SiteAnalytics />
        <TawkChat />
      </body>
    </html>
  );
}
