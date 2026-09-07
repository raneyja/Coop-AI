import { Hero } from "@/components/Hero";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { HomeStackContextSection } from "@/components/HomeStackContextSection";
import { HomeCloseSection } from "@/components/HomeCloseSection";
import { HomePageTheme } from "@/components/HomePageTheme";
import { Testimonial } from "@/components/Testimonial";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";
import type { Metadata } from "next";

const homeTitle = `${siteConfig.name} | ${siteConfig.tagline}`;
const homeMetadata = buildPageMetadata("/", siteConfig.name, siteConfig.seo.defaultDescription);

export const metadata: Metadata = {
  ...homeMetadata,
  title: {
    absolute: homeTitle
  },
  openGraph: {
    ...homeMetadata.openGraph,
    title: homeTitle
  },
  twitter: {
    ...homeMetadata.twitter,
    title: homeTitle
  }
};

export default function HomePage() {
  return (
    <HomePageTheme>
      <Hero />
      <HomeStackContextSection tone="dark" />

      <section className="border-t border-white/10 py-10 md:py-12">
        <div className="mx-auto max-w-6xl px-6">
          <HomePartnerLogos tone="dark" />
        </div>
      </section>

      <Testimonial tone="dark" />
      <HomeCloseSection />
    </HomePageTheme>
  );
}
