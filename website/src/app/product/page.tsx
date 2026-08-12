import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CTASection } from "@/components/CTASection";
import { ModelProviderLogos } from "@/components/ModelProviderLogos";
import { ProductShowcaseCarousel } from "@/components/ProductShowcaseCarousel";
import {
  ProductAskScene,
  ProductChangeScene,
  ProductIndexedScene
} from "@/components/ProductValueScenes";
import { buildPageMetadata } from "@/lib/pageMetadata";
import { siteConfig } from "@/lib/site.config";

export const metadata: Metadata = buildPageMetadata(
  "/product",
  siteConfig.seo.pages.product.title,
  siteConfig.seo.pages.product.description
);

export default function ProductPage() {
  return (
    <>
      <PageHeader
        eyebrow="Product"
        title="Context from your entire stack (not just your codebase)"
        description="CoopAI indexes your entire codebase and the tools that your team uses — then puts that context into every answer and every line you write."
      />

      <section className="border-b border-coop-border pb-16 pt-4 md:pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <ProductShowcaseCarousel />
        </div>
      </section>

      <section className="py-14 md:py-16">
        <div className="mx-auto max-w-6xl px-6">
          <ModelProviderLogos />
        </div>
      </section>

      <ProductAskScene />
      <ProductChangeScene />
      <ProductIndexedScene />

      <CTASection />
    </>
  );
}
