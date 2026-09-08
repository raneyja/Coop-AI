import type { Metadata } from "next";
import Link from "next/link";
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
        description="VS Code code intelligence that Deep-Indexes your repos, pulls company Slack and Jira when you ask, and helps you find owners, check blast radius, and edit — without cloning the monorepo."
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

      <section className="border-t border-coop-border py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 sm:flex-row sm:items-center">
          <p className="text-sm text-coop-muted">
            Want the loop, not the feature tour? Index → query live → stay in the file.
          </p>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              How CoopAI works →
            </Link>
            <Link
              href="/docs/what-is-coopai"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              What is CoopAI? →
            </Link>
            <Link
              href="/docs/compare"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              Compare CoopAI →
            </Link>
            <Link
              href="/security"
              className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
            >
              Security →
            </Link>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
}
