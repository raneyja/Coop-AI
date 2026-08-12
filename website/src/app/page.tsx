import { Hero } from "@/components/Hero";
import { HomePartnerLogos } from "@/components/HomePartnerLogos";
import { HomeStackContextSection } from "@/components/HomeStackContextSection";
import { Testimonial } from "@/components/Testimonial";
import { CTASection } from "@/components/CTASection";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";
import type { Metadata } from "next";

const homeTitle = `${siteConfig.name} — ${siteConfig.tagline}`;
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
    <>
      <Hero />

      <section className="border-t border-coop-border py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-6">
          <HomePartnerLogos />
        </div>
      </section>

      <HomeStackContextSection />

      <Testimonial />

      <CTASection />
    </>
  );
}
