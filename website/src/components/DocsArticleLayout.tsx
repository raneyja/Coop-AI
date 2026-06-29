import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { DocsMarkdown } from "@/components/DocsMarkdown";
import { DocsNextSteps } from "@/components/DocsNextSteps";
import { DocsSearch } from "@/components/DocsSearch";
import { DocsSidebar } from "@/components/DocsSidebar";
import type { DocsNavEntry, DocsSection } from "@/lib/docs.shared";

type DocsArticleLayoutProps = {
  title: string;
  description?: string;
  lastUpdated?: string;
  content: string;
  sections: DocsSection[];
  navPages: DocsNavEntry[];
  currentSlug: string;
  prev?: DocsNavEntry;
  next?: DocsNavEntry;
  nextStepLinks?: { href: string; label: string }[];
};

export function DocsArticleLayout({
  title,
  description,
  lastUpdated,
  content,
  sections,
  navPages,
  currentSlug,
  prev,
  next,
  nextStepLinks
}: DocsArticleLayoutProps) {
  return (
    <>
      <PageHeader eyebrow="Documentation" title={title} description={description} />

      <section className="pb-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8 max-w-md">
            <DocsSearch pages={navPages} />
          </div>

          <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
            <aside className="mb-8 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
              <DocsSidebar sections={sections} currentSlug={currentSlug} />
              <p className="mt-8 hidden text-xs text-coop-muted lg:block">
                Need a walkthrough? See the{" "}
                <Link href="/manual" className="text-coop-index hover:text-white">
                  Owner&apos;s Manual
                </Link>
              </p>
            </aside>

            <article className="min-w-0">
              {lastUpdated ? (
                <p className="mb-6 text-sm text-coop-muted">Last updated: {lastUpdated}</p>
              ) : null}
              <div className="prose prose-lg prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-coop-index prose-code:text-coop-index prose-p:text-coop-muted prose-li:text-coop-muted prose-strong:text-white max-w-none">
                <DocsMarkdown content={content} />
              </div>
              <DocsNextSteps prev={prev} next={next} links={nextStepLinks} />
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
